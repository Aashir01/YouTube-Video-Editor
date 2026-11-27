#!/usr/bin/env python3
"""
Convert MediaPipe's selfie segmentation models (TFLite, Apache-2.0) to ONNX for onnxruntime.

The models ship in the @mediapipe/selfie_segmentation npm package. General converters stop at
their custom upsampling op (Convolution2DTransposeBias), so this handles exactly their small op
set: float16 weights (DEQUANTIZE), CONV_2D, DEPTHWISE_CONV_2D, RELU, HARD_SWISH, LOGISTIC, ADD,
MUL, AVERAGE_POOL_2D, MEAN, RESIZE_BILINEAR and the custom transposed convolution.

The ONNX graph takes the same input as the original (NHWC RGB in 0..1) and returns the person
mask as [1, 1, H, W] (0..1).

  pip install tflite onnx numpy
  python scripts/convert-selfie-segmentation.py <model.tflite> <out.onnx>
"""
import struct
import sys

import numpy as np
import onnx
import tflite
from onnx import TensorProto, helper, numpy_helper

OPS = {v: k for k, v in tflite.BuiltinOperator.__dict__.items() if not k.startswith('_')}
NP_TYPES = {tflite.TensorType.FLOAT32: np.float32, tflite.TensorType.FLOAT16: np.float16, tflite.TensorType.INT32: np.int32}


def main(src: str, dst: str) -> None:
    buf = open(src, 'rb').read()
    model = tflite.Model.GetRootAsModel(buf, 0)
    g = model.Subgraphs(0)

    def tensor(i):
        return g.Tensors(i)

    def tname(i):
        return f't{i}'

    def shape(i):
        return [int(x) for x in tensor(i).ShapeAsNumpy()]

    def const(i):
        t = tensor(i)
        data = model.Buffers(t.Buffer()).DataAsNumpy()
        if isinstance(data, int) or data.size == 0:
            return None
        return np.frombuffer(data.tobytes(), dtype=NP_TYPES[t.Type()]).reshape(shape(i) or [])

    nodes, inits = [], {}
    consts = {}  # tensor index -> numpy value (weights, after dequantizing)
    uid = [0]

    def fresh(prefix):
        uid[0] += 1
        return f'{prefix}_{uid[0]}'

    def add_init(name, value):
        inits[name] = numpy_helper.from_array(np.ascontiguousarray(value), name)
        return name

    def activation(fused, out_name):
        """Fused activation after an op: returns the name the op itself must write to."""
        if fused == tflite.ActivationFunctionType.NONE:
            return out_name
        inner = fresh('pre_act')
        if fused == tflite.ActivationFunctionType.RELU:
            nodes.append(helper.make_node('Relu', [inner], [out_name]))
        elif fused == tflite.ActivationFunctionType.RELU6:
            nodes.append(helper.make_node('Clip', [inner, add_init(fresh('zero'), np.array(0, np.float32)), add_init(fresh('six'), np.array(6, np.float32))], [out_name]))
        else:
            raise SystemExit(f'unsupported fused activation {fused}')
        return inner

    def same_pads(in_hw, k_hw, s_hw, d_hw=(1, 1)):
        pads_begin, pads_end = [], []
        for size, k, s, d in zip(in_hw, k_hw, s_hw, d_hw):
            out = -(-size // s)
            total = max((out - 1) * s + (k - 1) * d + 1 - size, 0)
            pads_begin.append(total // 2)
            pads_end.append(total - total // 2)
        return pads_begin + pads_end

    def nchw_const(value):
        """A broadcast constant laid out for NHWC ([C] or [1,1,1,C]) re-laid out for NCHW."""
        v = np.asarray(value, np.float32)
        if v.ndim == 4:
            return v.transpose(0, 3, 1, 2)
        if v.ndim == 1 and v.size > 1:
            return v.reshape(1, -1, 1, 1)
        return v

    def operand(i):
        if i in consts:
            return add_init(fresh('c'), nchw_const(consts[i]))
        return tname(i)

    inp = g.Inputs(0)
    in_shape = shape(inp)
    nodes.append(helper.make_node('Transpose', ['input'], [tname(inp)], perm=[0, 3, 1, 2]))

    for oi in range(g.OperatorsLength()):
        op = g.Operators(oi)
        code = model.OperatorCodes(op.OpcodeIndex())
        kind = OPS.get(max(code.BuiltinCode(), code.DeprecatedBuiltinCode()))
        ins = [int(x) for x in op.InputsAsNumpy()]
        outs = [int(x) for x in op.OutputsAsNumpy()]
        opts = op.BuiltinOptions()

        if kind == 'DEQUANTIZE':
            consts[outs[0]] = const(ins[0]).astype(np.float32)
            continue

        def weight(i):
            v = consts.get(i)
            if v is None:
                v = const(i)
            return np.asarray(v, np.float32)

        if kind in ('CONV_2D', 'DEPTHWISE_CONV_2D'):
            o = tflite.Conv2DOptions() if kind == 'CONV_2D' else tflite.DepthwiseConv2DOptions()
            o.Init(opts.Bytes, opts.Pos)
            w = weight(ins[1])
            b = weight(ins[2]) if len(ins) > 2 and ins[2] >= 0 else None
            if kind == 'CONV_2D':
                w_onnx = w.transpose(0, 3, 1, 2)  # OHWI -> OIHW
                group = 1
            else:
                w_onnx = w.transpose(3, 0, 1, 2)  # 1HW(C*m) -> (C*m)1HW
                group = shape(ins[0])[3]
            kh, kw = w.shape[1], w.shape[2]
            s = (o.StrideH(), o.StrideW())
            d = (o.DilationHFactor() or 1, o.DilationWFactor() or 1)
            pads = same_pads(shape(ins[0])[1:3], (kh, kw), s, d) if o.Padding() == tflite.Padding.SAME else [0, 0, 0, 0]
            target = activation(o.FusedActivationFunction(), tname(outs[0]))
            inputs = [tname(ins[0]), add_init(fresh('w'), w_onnx)] + ([add_init(fresh('b'), b)] if b is not None else [])
            nodes.append(helper.make_node('Conv', inputs, [target], kernel_shape=[kh, kw], strides=list(s), dilations=list(d), pads=pads, group=group))
        elif kind in ('RELU', 'HARD_SWISH', 'LOGISTIC'):
            nodes.append(helper.make_node({'RELU': 'Relu', 'HARD_SWISH': 'HardSwish', 'LOGISTIC': 'Sigmoid'}[kind], [tname(ins[0])], [tname(outs[0])]))
        elif kind in ('ADD', 'MUL'):
            o = tflite.AddOptions() if kind == 'ADD' else tflite.MulOptions()
            o.Init(opts.Bytes, opts.Pos)
            target = activation(o.FusedActivationFunction(), tname(outs[0]))
            nodes.append(helper.make_node('Add' if kind == 'ADD' else 'Mul', [operand(ins[0]), operand(ins[1])], [target]))
        elif kind == 'AVERAGE_POOL_2D':
            o = tflite.Pool2DOptions()
            o.Init(opts.Bytes, opts.Pos)
            ih, iw = shape(ins[0])[1:3]
            fh, fw = o.FilterHeight(), o.FilterWidth()
            target = activation(o.FusedActivationFunction(), tname(outs[0]))
            if (fh, fw) == (ih, iw):
                nodes.append(helper.make_node('GlobalAveragePool', [tname(ins[0])], [target]))
            else:
                s = (o.StrideH(), o.StrideW())
                pads = same_pads((ih, iw), (fh, fw), s) if o.Padding() == tflite.Padding.SAME else [0, 0, 0, 0]
                nodes.append(helper.make_node('AveragePool', [tname(ins[0])], [target], kernel_shape=[fh, fw], strides=list(s), pads=pads))
        elif kind == 'MEAN':
            o = tflite.ReducerOptions()
            o.Init(opts.Bytes, opts.Pos)
            axes = [int(a) for a in np.atleast_1d(const(ins[1]))]
            nchw = {0: 0, 1: 2, 2: 3, 3: 1}
            nodes.append(helper.make_node('ReduceMean', [tname(ins[0])], [tname(outs[0])], axes=[nchw[a] for a in axes], keepdims=1 if o.KeepDims() else 0))
        elif kind == 'RESIZE_BILINEAR':
            o = tflite.ResizeBilinearOptions()
            o.Init(opts.Bytes, opts.Pos)
            n, _, _, c = shape(ins[0])
            new_h, new_w = [int(x) for x in const(ins[1])]
            mode = 'align_corners' if o.AlignCorners() else 'half_pixel' if o.HalfPixelCenters() else 'asymmetric'
            sizes = add_init(fresh('sizes'), np.array([n, c, new_h, new_w], np.int64))
            nodes.append(helper.make_node('Resize', [tname(ins[0]), '', '', sizes], [tname(outs[0])], mode='linear', coordinate_transformation_mode=mode))
        elif kind == 'CUSTOM' and code.CustomCode() == b'Convolution2DTransposeBias':
            padding, stride_w, stride_h = struct.unpack('<iii', bytes(op.CustomOptionsAsNumpy())[:12])
            w = weight(ins[1])  # OHWI
            b = weight(ins[2])
            kh, kw = w.shape[1], w.shape[2]
            ih, iw = shape(ins[0])[1:3]
            oh, ow = shape(outs[0])[1:3]
            # pads that give exactly the TFLite output size
            ph = (ih - 1) * stride_h + kh - oh
            pw = (iw - 1) * stride_w + kw - ow
            pads = [ph // 2, pw // 2, ph - ph // 2, pw - pw // 2]
            nodes.append(
                helper.make_node('ConvTranspose', [tname(ins[0]), add_init(fresh('w'), w.transpose(3, 0, 1, 2)), add_init(fresh('b'), b)], [tname(outs[0])], kernel_shape=[kh, kw], strides=[stride_h, stride_w], pads=pads)
            )
        else:
            raise SystemExit(f'unsupported op {kind} {code.CustomCode()}')

    out = g.Outputs(0)
    oh, ow = shape(out)[1:3]
    nodes.append(helper.make_node('Identity', [tname(out)], ['mask']))
    graph = helper.make_graph(
        nodes,
        'selfie_segmentation',
        [helper.make_tensor_value_info('input', TensorProto.FLOAT, in_shape)],
        [helper.make_tensor_value_info('mask', TensorProto.FLOAT, [1, 1, oh, ow])],
        initializer=list(inits.values()),
    )
    m = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 17)], producer_name='cutroom-convert-selfie-segmentation')
    m.ir_version = 8
    onnx.checker.check_model(m)
    # weights are stored as float16 in the source; keep the file small the same way (cast at load)
    onnx.save(m, dst)
    print(f'{dst}: {len(nodes)} nodes, input {in_shape} NHWC, mask [1, 1, {oh}, {ow}]')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

/**
 * Person segmentation for "Remove background": MediaPipe's selfie segmentation (bundled ONNX
 * models, ~440 KB each) run with onnxruntime-node. The landscape model suits wide footage, the
 * square one portrait or square footage. Everything runs locally.
 */
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from '../config';
import { importOptional } from '../optional';

interface OrtTensor {
  data: Float32Array;
}
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
interface OrtModule {
  InferenceSession: { create(file: string, opts?: Record<string, unknown>): Promise<OrtSession> };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
}

export type SegmenterKind = 'landscape' | 'square';
const MODELS: Record<SegmenterKind, { file: string; width: number; height: number }> = {
  landscape: { file: 'selfie_segmentation_landscape.onnx', width: 256, height: 144 },
  square: { file: 'selfie_segmentation.onnx', width: 256, height: 256 },
};

export interface Segmenter {
  width: number;
  height: number;
  /** person probability per pixel (width×height, 0..1) for an NHWC RGB input in 0..1 */
  mask: (input: Float32Array) => Promise<Float32Array>;
}

const sessions = new Map<SegmenterKind, Promise<Segmenter | null>>();

export const loadSegmenter = (kind: SegmenterKind): Promise<Segmenter | null> => {
  let s = sessions.get(kind);
  if (!s) {
    s = (async () => {
      const m = MODELS[kind];
      const file = path.join(APP_ROOT, 'assets', 'models', m.file);
      try {
        if (!fs.existsSync(file)) return null;
        const ort = await importOptional<OrtModule>('onnxruntime-node');
        const session = await ort.InferenceSession.create(file, { logSeverityLevel: 3, intraOpNumThreads: 2 });
        return {
          width: m.width,
          height: m.height,
          mask: async (input: Float32Array) => (await session.run({ input: new ort.Tensor('float32', input, [1, m.height, m.width, 3]) })).mask!.data,
        };
      } catch (err) {
        console.warn('[segment] person segmentation unavailable:', err instanceof Error ? err.message : err);
        return null;
      }
    })();
    sessions.set(kind, s);
  }
  return s;
};

/** Pick the model for footage of this shape. */
export const segmenterFor = (width: number, height: number): SegmenterKind => (width / height > 1.2 ? 'landscape' : 'square');

export const segmentationAvailable = async () => Boolean(await loadSegmenter('landscape'));

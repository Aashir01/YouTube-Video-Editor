/**
 * Face detection for smart reframing: YuNet (bundled ONNX model, ~230 KB) run with onnxruntime-node
 * on frames that FFmpeg streams out of the footage. Everything runs locally; when the optional
 * runtime is missing the caller simply keeps the current crop.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_ROOT } from '../config';
import { importOptional } from '../optional';
import type { FaceBox, FaceSample } from '../../shared/reframe';
import { ff } from './ffmpeg';

const MODEL = path.join(APP_ROOT, 'assets', 'models', 'face_detection_yunet_2023mar.onnx');
/** the model's fixed input: frames are letterboxed into a 640×640 square */
const SIZE = 640;
const STRIDES = [8, 16, 32] as const;

// the few onnxruntime types we use (it is an optional dependency, so no static import)
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

let detector: Promise<{ ort: OrtModule; session: OrtSession } | null> | null = null;
const loadDetector = () =>
  (detector ??= (async () => {
    try {
      if (!fs.existsSync(MODEL)) return null;
      const ort = await importOptional<OrtModule>('onnxruntime-node');
      const session = await ort.InferenceSession.create(MODEL, { logSeverityLevel: 3, intraOpNumThreads: 2 });
      return { ort, session };
    } catch (err) {
      console.warn('[faces] face detection unavailable:', err instanceof Error ? err.message : err);
      return null;
    }
  })());

export const faceDetectionAvailable = async (): Promise<boolean> => Boolean(await loadDetector());

const iou = (a: FaceBox, b: FaceBox) => {
  const x1 = Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
  const y1 = Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
  const x2 = Math.min(a.cx + a.w / 2, b.cx + b.w / 2);
  const y2 = Math.min(a.cy + a.h / 2, b.cy + b.h / 2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Faces in one BGR frame of w×h pixels (w, h ≤ 640), as fractions of that frame. */
const detectFrame = async (d: { ort: OrtModule; session: OrtSession }, frame: Uint8Array, w: number, h: number, threshold: number): Promise<FaceBox[]> => {
  // HWC bytes -> CHW floats (BGR, 0-255, as OpenCV feeds YuNet); the rest of the square stays black
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < h; y++) {
    let si = y * w * 3;
    let di = y * SIZE;
    for (let x = 0; x < w; x++, si += 3, di++) {
      input[di] = frame[si]!;
      input[plane + di] = frame[si + 1]!;
      input[2 * plane + di] = frame[si + 2]!;
    }
  }
  const out = await d.session.run({ input: new d.ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const found: FaceBox[] = [];
  for (const stride of STRIDES) {
    const cls = out[`cls_${stride}`]!.data;
    const obj = out[`obj_${stride}`]!.data;
    const bbox = out[`bbox_${stride}`]!.data;
    const cols = SIZE / stride;
    for (let i = 0; i < cols * cols; i++) {
      const score = Math.sqrt(clamp01(cls[i]!) * clamp01(obj[i]!));
      if (score < threshold) continue;
      const cx = ((i % cols) + bbox[i * 4]!) * stride;
      const cy = (Math.floor(i / cols) + bbox[i * 4 + 1]!) * stride;
      const bw = Math.exp(bbox[i * 4 + 2]!) * stride;
      const bh = Math.exp(bbox[i * 4 + 3]!) * stride;
      if (cx < 0 || cy < 0 || cx > w || cy > h) continue; // in the letterbox padding
      found.push({ cx: cx / w, cy: cy / h, w: bw / w, h: bh / h, score });
    }
  }
  // non-maximum suppression
  found.sort((a, b) => b.score - a.score);
  const keep: FaceBox[] = [];
  for (const f of found) if (keep.every((k) => iou(k, f) < 0.3)) keep.push(f);
  return keep.map((f) => ({ cx: round4(f.cx), cy: round4(f.cy), w: round4(f.w), h: round4(f.h), score: round4(f.score) }));
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export interface DetectOptions {
  /** samples per second of source time (default 2) */
  fps?: number;
  threshold?: number;
  signal?: AbortSignal;
}

/**
 * Detect faces in [from, to) seconds of a video (or in a still image when `to` is undefined).
 * Returns samples with source times, or null when face detection is unavailable.
 */
export const detectFaces = async (file: string, size: { width: number; height: number }, from = 0, to?: number, opts: DetectOptions = {}): Promise<FaceSample[] | null> => {
  const d = await loadDetector();
  if (!d) return null;
  const fps = opts.fps ?? 2;
  const threshold = opts.threshold ?? 0.6;
  const k = SIZE / Math.max(size.width, size.height);
  const w = Math.max(2, Math.floor((size.width * k) / 2) * 2);
  const h = Math.max(2, Math.floor((size.height * k) / 2) * 2);
  const frameBytes = w * h * 3;
  const still = to === undefined;
  const input = still ? ['-i', file, '-frames:v', '1'] : ['-ss', Math.max(0, from).toFixed(3), '-t', Math.max(0.05, to - from).toFixed(3), '-i', file, '-an', '-sn'];
  const vf = `${still ? '' : `fps=${fps},`}scale=${w}:${h}:flags=bilinear`;
  const b = ff();
  return new Promise((resolve, reject) => {
    const child = spawn(b.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...input, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1'], {
      cwd: b.cwd,
      env: b.env,
      windowsHide: true,
    });
    const samples: FaceSample[] = [];
    const queue: { t: number; frame: Uint8Array }[] = [];
    let pending: Buffer | null = null;
    let index = 0;
    let working = false;
    let closed = false;
    let failed = false;
    let stderr = '';
    const fail = (err: unknown) => {
      if (failed) return;
      failed = true;
      child.kill('SIGKILL');
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const finish = () => {
      if (failed) return;
      samples.sort((a, b) => a.t - b.t);
      resolve(samples);
    };
    const pump = async () => {
      if (working) return;
      working = true;
      try {
        while (queue.length) {
          const item = queue.shift()!;
          samples.push({ t: item.t, faces: await detectFrame(d, item.frame, w, h, threshold) });
          if (queue.length < 2 && child.stdout.isPaused()) child.stdout.resume();
        }
      } catch (err) {
        return fail(err);
      } finally {
        working = false;
      }
      if (closed) finish();
    };
    child.stdout.on('data', (chunk: Buffer) => {
      let buf = pending ? Buffer.concat([pending, chunk]) : chunk;
      while (buf.length >= frameBytes) {
        queue.push({ t: Math.round((from + index++ / fps) * 1000) / 1000, frame: new Uint8Array(buf.subarray(0, frameBytes)) });
        buf = buf.subarray(frameBytes);
      }
      pending = buf.length ? Buffer.from(buf) : null;
      if (queue.length > 4) child.stdout.pause();
      void pump();
    });
    child.stderr.on('data', (s: Buffer) => {
      if (stderr.length < 4000) stderr += s.toString();
    });
    child.on('error', fail);
    child.on('close', (code) => {
      closed = true;
      if (code !== 0 && !failed) return fail(new Error(`ffmpeg could not read frames (${code}): ${stderr.trim().split('\n').slice(-2).join(' ')}`));
      if (!working && !queue.length) finish();
    });
    opts.signal?.addEventListener('abort', () => fail(new Error('Cancelled')), { once: true });
  });
};

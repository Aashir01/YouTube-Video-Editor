/**
 * Face detection for smart reframing: YuNet (bundled ONNX model, ~230 KB) run with onnxruntime-node
 * on frames that FFmpeg streams out of the footage. Everything runs locally; when the optional
 * runtime is missing the caller simply keeps the current crop. `analyzeTalking` also measures how
 * much each person's mouth moves, to tell who is speaking.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_ROOT } from '../config';
import { importOptional } from '../optional';
import type { FaceBox, FaceSample, TalkTrack } from '../../shared/reframe';
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

/** Faces in one BGR frame of w×h pixels (w, h ≤ 640), as fractions of that frame, with the mouth position. */
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
    const kps = out[`kps_${stride}`]!.data;
    const cols = SIZE / stride;
    for (let i = 0; i < cols * cols; i++) {
      const score = Math.sqrt(clamp01(cls[i]!) * clamp01(obj[i]!));
      if (score < threshold) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = (col + bbox[i * 4]!) * stride;
      const cy = (row + bbox[i * 4 + 1]!) * stride;
      const bw = Math.exp(bbox[i * 4 + 2]!) * stride;
      const bh = Math.exp(bbox[i * 4 + 3]!) * stride;
      if (cx < 0 || cy < 0 || cx > w || cy > h) continue; // in the letterbox padding
      // landmarks: right eye, left eye, nose tip, right mouth corner, left mouth corner
      const rmx = (kps[i * 10 + 6]! + col) * stride;
      const rmy = (kps[i * 10 + 7]! + row) * stride;
      const lmx = (kps[i * 10 + 8]! + col) * stride;
      const lmy = (kps[i * 10 + 9]! + row) * stride;
      found.push({ cx: cx / w, cy: cy / h, w: bw / w, h: bh / h, score, mouth: { x: (rmx + lmx) / 2 / w, y: (rmy + lmy) / 2 / h, w: Math.hypot(lmx - rmx, lmy - rmy) / w } });
    }
  }
  // non-maximum suppression
  found.sort((a, b) => b.score - a.score);
  const keep: FaceBox[] = [];
  for (const f of found) if (keep.every((k) => iou(k, f) < 0.3)) keep.push(f);
  return keep.map((f) => ({
    cx: round4(f.cx),
    cy: round4(f.cy),
    w: round4(f.w),
    h: round4(f.h),
    score: round4(f.score),
    ...(f.mouth ? { mouth: { x: round4(f.mouth.x), y: round4(f.mouth.y), w: round4(f.mouth.w) } } : {}),
  }));
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Frame size for the detector: the picture scaled to fit 640 px, even dimensions. */
export const frameSize = (size: { width: number; height: number }) => {
  const k = SIZE / Math.max(size.width, size.height);
  return { w: Math.max(2, Math.floor((size.width * k) / 2) * 2), h: Math.max(2, Math.floor((size.height * k) / 2) * 2) };
};

/**
 * Stream BGR frames of [from, to) seconds at `fps` (or the single frame of a still image when `to` is
 * undefined) and hand them to `onFrame` one at a time; FFmpeg is paused while `onFrame` catches up.
 */
export const readFrames = (file: string, w: number, h: number, from: number, to: number | undefined, fps: number, onFrame: (t: number, frame: Uint8Array) => Promise<void>, signal?: AbortSignal): Promise<void> => {
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
    const pump = async () => {
      if (working) return;
      working = true;
      try {
        while (queue.length) {
          const item = queue.shift()!;
          await onFrame(item.t, item.frame);
          if (queue.length < 2 && child.stdout.isPaused()) child.stdout.resume();
        }
      } catch (err) {
        return fail(err);
      } finally {
        working = false;
      }
      if (closed && !failed) resolve();
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
      if (!working && !queue.length && !failed) resolve();
    });
    signal?.addEventListener('abort', () => fail(new Error('Cancelled')), { once: true });
  });
};

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
  const { w, h } = frameSize(size);
  const samples: FaceSample[] = [];
  await readFrames(file, w, h, from, to, opts.fps ?? 2, async (t, frame) => void samples.push({ t, faces: await detectFrame(d, frame, w, h, opts.threshold ?? 0.6) }), opts.signal);
  return samples.sort((a, b) => a.t - b.t);
};

// ---------------------------------------------------------------------------
// Who is talking: faces tracked over time plus how much each mouth moves
// ---------------------------------------------------------------------------

export const toGray = (frame: Uint8Array, w: number, h: number): Uint8Array => {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 3) g[i] = (frame[j]! * 29 + frame[j + 1]! * 150 + frame[j + 2]! * 77) >> 8;
  return g;
};

/** Mean absolute change of a rectangle (center and size in pixels) between two gray frames. */
const roiChange = (a: Uint8Array, b: Uint8Array, w: number, h: number, cx: number, cy: number, rw: number, rh: number): number => {
  const x0 = Math.max(0, Math.round(cx - rw / 2));
  const x1 = Math.min(w, Math.round(cx + rw / 2));
  const y0 = Math.max(0, Math.round(cy - rh / 2));
  const y1 = Math.min(h, Math.round(cy + rh / 2));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
      sum += Math.abs(a[i]! - b[i]!);
      n++;
    }
  }
  return n ? sum / n : 0;
};

export interface TalkOptions {
  /** analysis frames per second (default 10); faces are detected on every `detectEvery`-th one (default 5) */
  fps?: number;
  detectEvery?: number;
  threshold?: number;
  signal?: AbortSignal;
}

/**
 * Track the faces in [from, to) seconds of a video and measure, frame by frame, how much each
 * person's mouth moves (minus how much their forehead moves, so a nodding head is not talking).
 * Returns the plain face samples too (for the single-person planner), or null when unavailable.
 */
export const analyzeTalking = async (file: string, size: { width: number; height: number }, from: number, to: number, opts: TalkOptions = {}): Promise<{ samples: FaceSample[]; tracks: TalkTrack[] } | null> => {
  const d = await loadDetector();
  if (!d) return null;
  const fps = opts.fps ?? 10;
  const every = opts.detectEvery ?? 5;
  const { w, h } = frameSize(size);
  const samples: FaceSample[] = [];
  const tracks: (TalkTrack & { last: FaceBox; lastT: number })[] = [];
  let prev: Uint8Array | null = null;
  let n = 0;
  let nextId = 1;
  await readFrames(
    file,
    w,
    h,
    from,
    to,
    fps,
    async (t, frame) => {
      const gray = toGray(frame, w, h);
      if (n % every === 0) {
        const faces = await detectFrame(d, frame, w, h, opts.threshold ?? 0.6);
        samples.push({ t, faces });
        // link detections to tracks: closest pairs first, one detection per track
        const pairs: { fi: number; ti: number; dist: number }[] = [];
        faces.forEach((f, fi) =>
          tracks.forEach((tr, ti) => {
            if (t - tr.lastT > 2.5) return;
            const dist = Math.hypot(f.cx - tr.last.cx, f.cy - tr.last.cy);
            if (dist < Math.max(0.12, tr.last.w)) pairs.push({ fi, ti, dist });
          }),
        );
        pairs.sort((a, b) => a.dist - b.dist);
        const usedF = new Set<number>();
        const usedT = new Set<number>();
        for (const p of pairs) {
          if (usedF.has(p.fi) || usedT.has(p.ti)) continue;
          usedF.add(p.fi);
          usedT.add(p.ti);
          const tr = tracks[p.ti]!;
          tr.last = faces[p.fi]!;
          tr.lastT = t;
          tr.faces.push({ t, face: faces[p.fi]! });
        }
        faces.forEach((f, fi) => {
          if (!usedF.has(fi)) tracks.push({ id: nextId++, faces: [{ t, face: f }], energy: [], last: f, lastT: t });
        });
      }
      // a cut or flash changes the whole picture: that is not anyone talking
      let global = 0;
      if (prev) {
        let sum = 0;
        let cnt = 0;
        for (let i = 0; i < gray.length; i += 7) {
          sum += Math.abs(gray[i]! - prev[i]!);
          cnt++;
        }
        global = cnt ? sum / cnt : 0;
      }
      if (prev && global < 25) {
        for (const tr of tracks) {
          if (t - tr.lastT > 1.5) continue;
          const f = tr.last;
          const mw = Math.max(f.mouth?.w ?? 0, f.w * 0.3) * w;
          const mouth = roiChange(gray, prev, w, h, (f.mouth?.x ?? f.cx) * w, (f.mouth?.y ?? f.cy + f.h * 0.28) * h, mw * 1.4, mw * 0.9);
          const forehead = roiChange(gray, prev, w, h, f.cx * w, (f.cy - f.h * 0.3) * h, f.w * w * 0.5, f.h * h * 0.18);
          tr.energy.push({ t, e: Math.round(Math.max(0, mouth - forehead) * 1000) / 1000 });
        }
      }
      prev = gray;
      n++;
    },
    opts.signal,
  );
  return { samples: samples.sort((a, b) => a.t - b.t), tracks: tracks.map(({ id, faces, energy }) => ({ id, faces, energy })) };
};

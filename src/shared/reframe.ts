/**
 * Smart reframing: turn face detections into a calm "virtual camera" path for a clip's crop.
 *
 * The crop of a video/image clip is controlled by its focus point (see mediaFrameStyle in the
 * composition): with fit "cover" the media overflows the frame on one axis and the focus decides
 * which part stays visible; a static zoom (`scale`) magnifies around the same point. Given where the
 * subject's face is in each sampled frame, we solve for the focus that puts it at a pleasant spot in
 * the frame, then smooth and simplify that into a few eased keyframes (or one static focus).
 */
import type { Keyframe } from './schema';

export interface FaceBox {
  /** center and size as fractions of the media frame */
  cx: number;
  cy: number;
  w: number;
  h: number;
  score: number;
}

export interface FaceSample {
  /** clip time in seconds */
  t: number;
  faces: FaceBox[];
}

/** How the media sits in its frame after a "cover" fit, and the static zoom. */
export interface CropGeometry {
  /** displayed media size relative to the frame, per axis (≥ 1; > 1 = overflow you can pan across) */
  kx: number;
  ky: number;
  scale: number;
}

export const coverGeometry = (mediaW: number, mediaH: number, frameW: number, frameH: number, scale = 1): CropGeometry => {
  const am = mediaW / mediaH;
  const af = frameW / frameH;
  return { kx: am > af ? am / af : 1, ky: am < af ? af / am : 1, scale };
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** How far the crop can travel on an axis, in frame sizes (0 = nothing to pan). */
export const panRange = (k: number, scale: number) => Math.max(0, scale * k - 1);

/**
 * The focus value that shows media position `c` (0-1) at frame position `target` (0-1).
 * Derivation: cover places media point c at p = c·k − f·(k − 1); the zoom maps p to f + s·(p − f).
 * Setting that equal to target gives f = (s·c·k − target) / (s·k − 1).
 */
export const focusFor = (c: number, k: number, scale: number, target: number): number | null => {
  const g = panRange(k, scale);
  if (g < 0.02) return null;
  return clamp01((scale * c * k - target) / g);
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Ramer–Douglas–Peucker on (t, v) with vertical error: the fewest points that stay within tol. */
const simplify = (pts: { t: number; v: number }[], tol: number): { t: number; v: number }[] => {
  if (pts.length <= 2) return pts;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  let worst = -1;
  let idx = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const lerp = b.t === a.t ? a.v : a.v + ((b.v - a.v) * (p.t - a.t)) / (b.t - a.t);
    const d = Math.abs(p.v - lerp);
    if (d > worst) {
      worst = d;
      idx = i;
    }
  }
  if (worst <= tol) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
};

export interface ReframeOptions {
  /** how far (in frame sizes) the subject may drift before the camera follows */
  tolerance?: number;
  /** where the face should sit in the frame */
  targetX?: number;
  targetY?: number;
  /** clip times of hard cuts in the footage: the camera cuts there instead of panning */
  cuts?: number[];
}

export interface ReframePlan {
  /** samples with a usable face, of all samples */
  found: number;
  total: number;
  /** typical number of faces per frame */
  people: number;
  focus?: { x: number; y: number };
  keyframes?: { 'focus.x'?: Keyframe[]; 'focus.y'?: Keyframe[] };
  /** number of camera moves in the path */
  moves: number;
}

/** Pick the subject in each sample: the biggest face, but stay with the current one while it is comparable. */
const followSubject = (samples: FaceSample[]): (FaceBox | null)[] => {
  let prev: FaceBox | null = null;
  return samples.map((s) => {
    if (!s.faces.length) return null;
    const size = (f: FaceBox) => f.w * f.h * f.score;
    const biggest = s.faces.reduce((m, f) => (size(f) > size(m) ? f : m));
    let pick = biggest;
    if (prev) {
      const p: FaceBox = prev;
      const near = s.faces.filter((f) => Math.hypot(f.cx - p.cx, f.cy - p.cy) < 0.15).sort((a, b) => size(b) - size(a))[0];
      if (near && size(near) >= 0.6 * size(biggest)) pick = near;
    }
    prev = pick;
    return pick;
  });
};

/**
 * Plan the crop for a clip from face samples. Returns null when there are no samples; a plan
 * without focus/keyframes when too few frames show a face (the caller keeps the current crop).
 */
export const planReframe = (samples: FaceSample[], g: CropGeometry, duration: number, opts: ReframeOptions = {}): ReframePlan | null => {
  if (!samples.length) return null;
  const { tolerance = 0.05, targetX = 0.5, targetY = 0.42, cuts = [] } = opts;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const subject = followSubject(sorted);
  const found = subject.filter(Boolean).length;
  const people = Math.round(median(sorted.map((s) => s.faces.length)));
  if (found < Math.max(1, Math.ceil(sorted.length * 0.2))) return { found, total: sorted.length, people, moves: 0 };

  // hold the last known position through frames where the face is lost (the first known before that)
  const firstKnown = subject.find(Boolean)!;
  let last = firstKnown;
  const filled = subject.map((f) => (f ? (last = f) : last));
  const times = sorted.map((s) => s.t);

  const gx = panRange(g.kx, g.scale);
  const gy = panRange(g.ky, g.scale);
  const plan: ReframePlan = { found, total: sorted.length, people, moves: 0 };
  const focus = { x: 0.5, y: 0.5 };
  const keyframes: { 'focus.x'?: Keyframe[]; 'focus.y'?: Keyframe[] } = {};

  const axis = (ch: 'focus.x' | 'focus.y', gain: number, k: number, pick: (f: FaceBox) => number, target: number) => {
    const raw = filled.map((f) => focusFor(pick(f), k, g.scale, target));
    if (raw.some((v) => v === null)) return; // this axis cannot pan
    const vals = raw as number[];
    // remove detector spikes (a median keeps real jumps sharp)
    const med = vals.map((_, i) => median(vals.slice(Math.max(0, i - 2), i + 3)));
    const tol = tolerance / gain;
    const key = ch === 'focus.x' ? 'x' : 'y';
    if (Math.max(...med) - Math.min(...med) <= tol * 2) {
      focus[key] = r4(median(med));
      return;
    }
    // a big jump between neighbouring samples is a cut in the footage: each shot is planned on its own
    const bounds = [0];
    for (let i = 1; i < med.length; i++) if (Math.abs(med[i]! - med[i - 1]!) * gain > 0.25) bounds.push(i);
    bounds.push(med.length);
    const out: Keyframe[] = [];
    for (let b = 0; b < bounds.length - 1; b++) {
      const s0 = bounds[b]!;
      const seg = med.slice(s0, bounds[b + 1]!);
      const pts = seg.map((_, i) => {
        const w = seg.slice(Math.max(0, i - 1), i + 2);
        return { t: times[s0 + i]!, v: w.reduce((a, x) => a + x, 0) / w.length };
      });
      if (b > 0) {
        // cut with the footage: at the detected scene cut when there is one, else at the first new sample
        pts[0] = { ...pts[0]!, t: cuts.find((c) => c > times[s0 - 1]! && c <= times[s0]!) ?? times[s0]! };
        if (out.length) out[out.length - 1] = { ...out[out.length - 1]!, ease: 'hold' };
      }
      // the simplified path is a piecewise-linear fit of the motion, so it plays back linearly
      for (const p of simplify(pts, tol)) out.push({ t: r3(p.t), v: r4(clamp01(p.v)), ease: 'linear' });
    }
    // keyframes from the first frame to the last
    if (out[0] && out[0].t > 0) out[0] = { ...out[0], t: 0 };
    const tail = out.at(-1);
    if (tail && tail.t < duration) out.push({ t: r3(duration), v: tail.v, ease: 'linear' });
    // drop repeats (a held value needs no extra keys)
    const compact = out.filter((k, i) => i === 0 || i === out.length - 1 || k.v !== out[i - 1]!.v || k.ease === 'hold' || out[i + 1]!.v !== k.v);
    keyframes[ch] = compact;
    plan.moves += compact.filter((k, i) => i > 0 && Math.abs(k.v - compact[i - 1]!.v) * gain > tolerance).length;
  };

  axis('focus.x', gx, g.kx, (f) => f.cx, targetX);
  axis('focus.y', gy, g.ky, (f) => f.cy, targetY);
  plan.focus = focus;
  if (keyframes['focus.x'] || keyframes['focus.y']) plan.keyframes = keyframes;
  return plan;
};

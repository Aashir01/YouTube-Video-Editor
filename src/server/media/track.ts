/**
 * Follow a region of a video (an object, a licence plate, a screen…) by template matching:
 * normalized cross-correlation around the last position, on a downscaled gray frame so that
 * a template is at most ~48 px. Pure JS on frames streamed by FFmpeg; no model needed.
 */
import { frameSize, readFrames, toGray } from './faces';

export interface TrackedPoint {
  /** source time in seconds */
  t: number;
  /** region center, fractions of the picture */
  cx: number;
  cy: number;
  /** match quality 0-1 (1 = identical) */
  score: number;
}

/** Downscale a gray frame by an integer factor (box filter). */
const shrink = (g: Uint8Array, w: number, h: number, k: number): { g: Float32Array; w: number; h: number } => {
  const W = Math.floor(w / k);
  const H = Math.floor(h / k);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0, i = (y * k + dy) * w + x * k; dx < k; dx++, i++) s += g[i]!;
      out[y * W + x] = s / (k * k);
    }
  }
  return { g: out, w: W, h: H };
};

/** Summed-area tables of values and squares, for O(1) window mean/variance. */
const integrals = (g: Float32Array, w: number, h: number) => {
  const S = new Float64Array((w + 1) * (h + 1));
  const Q = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    let rq = 0;
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x]!;
      rs += v;
      rq += v * v;
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1]! + rs;
      Q[(y + 1) * (w + 1) + x + 1] = Q[y * (w + 1) + x + 1]! + rq;
    }
  }
  const box = (T: Float64Array, x: number, y: number, bw: number, bh: number) => T[(y + bh) * (w + 1) + x + bw]! - T[y * (w + 1) + x + bw]! - T[(y + bh) * (w + 1) + x]! + T[y * (w + 1) + x]!;
  return { sum: (x: number, y: number, bw: number, bh: number) => box(S, x, y, bw, bh), sq: (x: number, y: number, bw: number, bh: number) => box(Q, x, y, bw, bh) };
};

export interface TrackOptions {
  /** frames per second to follow at (default 10) */
  fps?: number;
  signal?: AbortSignal;
}

/**
 * Follow `region` (center and size as fractions of the picture, as it looks at `from`) through
 * [from, to) seconds. When the match gets too poor the region is considered lost and the last good
 * position is held.
 */
export const trackRegion = async (file: string, size: { width: number; height: number }, from: number, to: number, region: { cx: number; cy: number; w: number; h: number }, opts: TrackOptions = {}): Promise<TrackedPoint[]> => {
  const fps = opts.fps ?? 10;
  const { w: FW, h: FH } = frameSize(size);
  // work at a scale where the template is at most ~48 px
  const k = Math.max(1, Math.ceil(Math.max(region.w * FW, region.h * FH) / 48));
  const out: TrackedPoint[] = [];
  let tpl: Float32Array | null = null;
  let tw = 0;
  let th = 0;
  let px = 0;
  let py = 0;
  let lost = false;
  await readFrames(
    file,
    FW,
    FH,
    from,
    to,
    fps,
    async (t, frame) => {
      const { g, w, h } = shrink(toGray(frame, FW, FH), FW, FH, k);
      const at = (score: number) => out.push({ t, cx: Math.round(((px + tw / 2) / w) * 10000) / 10000, cy: Math.round(((py + th / 2) / h) * 10000) / 10000, score: Math.round(score * 1000) / 1000 });
      if (!tpl) {
        tw = Math.max(6, Math.min(w - 2, Math.round(region.w * w)));
        th = Math.max(6, Math.min(h - 2, Math.round(region.h * h)));
        px = Math.max(0, Math.min(w - tw, Math.round(region.cx * w - tw / 2)));
        py = Math.max(0, Math.min(h - th, Math.round(region.cy * h - th / 2)));
        tpl = new Float32Array(tw * th);
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) tpl[y * tw + x] = g[(py + y) * w + px + x]!;
        at(1);
        return;
      }
      if (lost) return void at(0);
      // template, zero-mean
      const n = tw * th;
      let m = 0;
      for (let i = 0; i < n; i++) m += tpl[i]!;
      m /= n;
      const T = new Float32Array(n);
      let tv = 0;
      for (let i = 0; i < n; i++) {
        T[i] = tpl[i]! - m;
        tv += T[i]! * T[i]!;
      }
      const tsd = Math.sqrt(tv / n) || 1;
      const I = integrals(g, w, h);
      const ncc = (x: number, y: number) => {
        const mean = I.sum(x, y, tw, th) / n;
        const sd = Math.sqrt(Math.max(1e-6, I.sq(x, y, tw, th) / n - mean * mean));
        let c = 0;
        for (let yy = 0; yy < th; yy++) for (let xx = 0, i = (y + yy) * w + x, j = yy * tw; xx < tw; xx++, i++, j++) c += T[j]! * g[i]!;
        return c / (n * tsd * sd);
      };
      // coarse search around the last position, then refine
      const R = Math.max(4, Math.round(0.6 * Math.max(tw, th)));
      let best = -2;
      let bx = px;
      let by = py;
      for (let y = Math.max(0, py - R); y <= Math.min(h - th, py + R); y += 2) {
        for (let x = Math.max(0, px - R); x <= Math.min(w - tw, px + R); x += 2) {
          const s = ncc(x, y);
          if (s > best) {
            best = s;
            bx = x;
            by = y;
          }
        }
      }
      const cx0 = bx;
      const cy0 = by;
      for (let y = Math.max(0, cy0 - 1); y <= Math.min(h - th, cy0 + 1); y++) {
        for (let x = Math.max(0, cx0 - 1); x <= Math.min(w - tw, cx0 + 1); x++) {
          const s = ncc(x, y);
          if (s > best) {
            best = s;
            bx = x;
            by = y;
          }
        }
      }
      if (best < 0.35) {
        lost = true;
        return void at(0);
      }
      px = bx;
      py = by;
      // let the template drift slowly with the object's look (light, angle)
      if (best > 0.7) for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) tpl[y * tw + x] = 0.9 * tpl[y * tw + x]! + 0.1 * g[(py + y) * w + px + x]!;
      at(best);
    },
    opts.signal,
  );
  return out;
};

/**
 * Pixel helpers for removing a background: preparing a frame for the person-segmentation model,
 * turning its low-resolution mask into a soft alpha channel, steadying it from frame to frame,
 * and finding the color of a green or blue screen. Frames are 8-bit BGR, as FFmpeg streams them.
 */

/** Bilinear-sample a BGR frame (w×h) into the model's input: NHWC RGB in 0..1 (mw×mh). */
export const toModelInput = (bgr: Uint8Array, w: number, h: number, mw: number, mh: number, out = new Float32Array(mw * mh * 3)): Float32Array => {
  const sx = w / mw;
  const sy = h / mh;
  for (let y = 0; y < mh; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < mw; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const o = (y * mw + x) * 3;
      for (let c = 0; c < 3; c++) {
        // BGR in, RGB out
        const ch = 2 - c;
        const a = bgr[(y0 * w + x0) * 3 + ch]!;
        const b = bgr[(y0 * w + x1) * 3 + ch]!;
        const d = bgr[(y1 * w + x0) * 3 + ch]!;
        const e = bgr[(y1 * w + x1) * 3 + ch]!;
        out[o + c] = ((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty) / 255;
      }
    }
  }
  return out;
};

/** Blend the new mask with the previous frame's (in place) so edges do not flicker. */
export const steadyMask = (mask: Float32Array, prev: Float32Array | null, keep = 0.35): Float32Array => {
  if (prev && prev.length === mask.length) for (let i = 0; i < mask.length; i++) mask[i] = mask[i]! * (1 - keep) + prev[i]! * keep;
  return mask;
};

/**
 * The model's mask (mw×mh, 0..1) as an alpha channel at full size (w×h, 0..255): bilinear upscaling,
 * then a smoothstep between `lo` and `hi` so the edge is soft but the person stays solid.
 */
export const maskToAlpha = (mask: Float32Array, mw: number, mh: number, w: number, h: number, lo = 0.35, hi = 0.65, out = new Uint8Array(w * h)): Uint8Array => {
  const sx = mw / w;
  const sy = mh / h;
  const span = Math.max(1e-6, hi - lo);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(mh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(mh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(mw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(mw - 1, x0 + 1);
      const tx = fx - x0;
      const m = (mask[y0 * mw + x0]! * (1 - tx) + mask[y0 * mw + x1]! * tx) * (1 - ty) + (mask[y1 * mw + x0]! * (1 - tx) + mask[y1 * mw + x1]! * tx) * ty;
      const t = Math.min(1, Math.max(0, (m - lo) / span));
      out[y * w + x] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }
  return out;
};

/** Interleave a BGR frame and an alpha channel into RGBA (what the encoder takes). */
export const toRgba = (bgr: Uint8Array, alpha: Uint8Array, out = new Uint8Array(alpha.length * 4)): Uint8Array => {
  for (let i = 0, j = 0, k = 0; k < alpha.length; i += 3, j += 4, k++) {
    out[j] = bgr[i + 2]!;
    out[j + 1] = bgr[i + 1]!;
    out[j + 2] = bgr[i]!;
    out[j + 3] = alpha[k]!;
  }
  return out;
};

/** The color of a green or blue screen: the median of the pixels along the frame's border (RGB). */
export const screenColor = (bgr: Uint8Array, w: number, h: number): [number, number, number] => {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    bs.push(bgr[i]!);
    gs.push(bgr[i + 1]!);
    rs.push(bgr[i + 2]!);
  };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  for (let x = 0; x < w; x += step) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    take(0, y);
    take(w - 1, y);
  }
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  return [median(rs), median(gs), median(bs)];
};

export const hex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

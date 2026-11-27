/**
 * Small signal-processing kit: an FFT, loudness-onset features and the offset search that lines
 * up recordings of the same event (multicam sync). Pure functions on plain arrays.
 */

export const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/** In-place iterative radix-2 FFT (length must be a power of two). `inverse` also divides by n. */
export const fft = (re: Float64Array, im: Float64Array, inverse = false): void => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const br = re[b]! * cr - im[b]! * ci;
        const bi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - br;
        im[b] = im[a]! - bi;
        re[a] = re[a]! + br;
        im[a] = im[a]! + bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
};

/** Log energy per frame of `hop` samples. */
export const logEnergy = (samples: ArrayLike<number>, hop: number): Float32Array => {
  const n = Math.floor(samples.length / hop);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let k = i * hop, end = k + hop; k < end; k++) e += samples[k]! * samples[k]!;
    out[i] = Math.log(1e-9 + e / hop);
  }
  return out;
};

/**
 * How sharply the loudness rises in each frame (half-wave rectified change of log energy).
 * It ignores the overall level, so recordings from different microphones still match.
 */
export const onsets = (logE: ArrayLike<number>): Float32Array => {
  const out = new Float32Array(logE.length);
  for (let i = 1; i < logE.length; i++) out[i] = Math.max(0, logE[i]! - logE[i - 1]!);
  // a light 3-tap smoothing keeps peaks a frame wide or so
  const sm = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) sm[i] = 0.25 * (out[i - 1] ?? 0) + 0.5 * out[i]! + 0.25 * (out[i + 1] ?? 0);
  return sm;
};

export interface Alignment {
  /** seconds: `b` at its time 0 matches `a` at this time (negative: `b` started earlier) */
  offset: number;
  /** normalized correlation at the match, -1..1 */
  score: number;
  /** how far the match stands out from all other offsets (z-score; above ~8 is a clear match) */
  confidence: number;
}

/**
 * Find the offset that lines `b` up with `a` (both sampled at `rate` per second), by normalized
 * cross-correlation over every offset that leaves at least `minOverlap` seconds in common.
 */
export const align = (a: ArrayLike<number>, b: ArrayLike<number>, rate: number, minOverlap = 5): Alignment | null => {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return null;
  const mean = (x: ArrayLike<number>) => {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i]!;
    return s / x.length;
  };
  const ma = mean(a);
  const mb = mean(b);
  const n = nextPow2(na + nb);
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  for (let i = 0; i < na; i++) ar[i] = a[i]! - ma;
  for (let i = 0; i < nb; i++) br[i] = b[i]! - mb;
  // prefix sums of squares, to normalize by the energy inside each overlap
  const pa = new Float64Array(na + 1);
  const pb = new Float64Array(nb + 1);
  for (let i = 0; i < na; i++) pa[i + 1] = pa[i]! + ar[i]! * ar[i]!;
  for (let i = 0; i < nb; i++) pb[i + 1] = pb[i]! + br[i]! * br[i]!;
  fft(ar, ai);
  fft(br, bi);
  // A · conj(B)
  for (let i = 0; i < n; i++) {
    const r = ar[i]! * br[i]! + ai[i]! * bi[i]!;
    const im = ai[i]! * br[i]! - ar[i]! * bi[i]!;
    ar[i] = r;
    ai[i] = im;
  }
  fft(ar, ai, true);
  // lag k: sum over t of a[t + k] · b[t], for k in [-(nb-1), na-1]
  const minLen = Math.max(2, Math.round(minOverlap * rate));
  const ks: number[] = [];
  const vals: number[] = [];
  for (let k = -(nb - 1); k <= na - 1; k++) {
    const t0 = Math.max(0, -k);
    const t1 = Math.min(nb, na - k);
    if (t1 - t0 < minLen) continue;
    const ea = pa[t1 + k]! - pa[t0 + k]!;
    const eb = pb[t1]! - pb[t0]!;
    const c = ar[k >= 0 ? k : n + k]!;
    ks.push(k);
    vals.push(ea > 0 && eb > 0 ? c / Math.sqrt(ea * eb) : 0);
  }
  if (!vals.length) return null;
  let best = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i]! > vals[best]!) best = i;
  let avg = 0;
  for (const v of vals) avg += v;
  avg /= vals.length;
  let sd = 0;
  for (const v of vals) sd += (v - avg) ** 2;
  sd = Math.sqrt(sd / vals.length) || 1e-9;
  // sub-frame peak position (parabola through the neighbors)
  let frac = 0;
  if (best > 0 && best < vals.length - 1 && ks[best - 1] === ks[best]! - 1 && ks[best + 1] === ks[best]! + 1) {
    const y0 = vals[best - 1]!;
    const y1 = vals[best]!;
    const y2 = vals[best + 1]!;
    const d = y0 - 2 * y1 + y2;
    if (d < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d));
  }
  return { offset: (ks[best]! + frac) / rate, score: vals[best]!, confidence: (vals[best]! - avg) / sd };
};

/** Average `values` (sampled at `rate`) into bins of `bin` seconds. */
export const binned = (values: ArrayLike<number>, rate: number, bin: number, count: number, from = 0): Float64Array => {
  const out = new Float64Array(count);
  const cnt = new Float64Array(count);
  for (let i = 0; i < values.length; i++) {
    const b = Math.floor((from + i / rate) / bin);
    if (b < 0 || b >= count) continue;
    out[b] += values[i]!;
    cnt[b]++;
  }
  for (let b = 0; b < count; b++) out[b] = cnt[b] ? out[b]! / cnt[b]! : NaN;
  return out;
};

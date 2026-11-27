/**
 * Beats of a music track and cutting to them. The tempo comes from the autocorrelation of the
 * loudness onsets (60–180 BPM, with a mild preference around 120), the beats from dynamic
 * programming that follows the onsets while keeping to the tempo (Ellis, 2007). Pure functions.
 */
import type { AudioClip } from './schema';

export interface BeatAnalysis {
  /** beats per minute */
  tempo: number;
  /** beat times in seconds of the source */
  beats: number[];
  /** how clearly the music has a beat (autocorrelation peak above its average, in standard deviations) */
  confidence: number;
}

const normalize = (xs: ArrayLike<number>): Float64Array => {
  const n = xs.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += xs[i]!;
  mean /= Math.max(1, n);
  let sd = 0;
  for (let i = 0; i < n; i++) sd += (xs[i]! - mean) ** 2;
  sd = Math.sqrt(sd / Math.max(1, n)) || 1;
  return Float64Array.from(xs, (v) => (v - mean) / sd);
};

/** Track the beats of a loudness-onset envelope sampled at `rate` per second. */
export const trackBeats = (onset: ArrayLike<number>, rate: number, opts: { minBpm?: number; maxBpm?: number } = {}): BeatAnalysis | null => {
  const o = normalize(onset);
  const n = o.length;
  if (n < rate * 4) return null;
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 180;
  const lagMin = Math.max(1, Math.floor((60 * rate) / maxBpm));
  const lagMax = Math.min(n - 1, Math.ceil((60 * rate) / minBpm));
  // 1) tempo: autocorrelation, weighted by a log-normal prior around 120 BPM
  const ac: number[] = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let t = 0; t + lag < n; t++) s += o[t]! * o[t + lag]!;
    ac.push(s / (n - lag));
  }
  const weight = (lag: number) => Math.exp(-0.5 * (Math.log2((60 * rate) / lag / 120) / 0.9) ** 2);
  let best = 0;
  for (let i = 1; i < ac.length; i++) if (ac[i]! * weight(i + lagMin) > ac[best]! * weight(best + lagMin)) best = i;
  let frac = 0;
  if (best > 0 && best < ac.length - 1) {
    const [y0, y1, y2] = [ac[best - 1]!, ac[best]!, ac[best + 1]!];
    const d = y0 - 2 * y1 + y2;
    if (d < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d));
  }
  const period = best + lagMin + frac;
  const mean = ac.reduce((a, b) => a + b, 0) / ac.length;
  const sd = Math.sqrt(ac.reduce((a, b) => a + (b - mean) ** 2, 0) / ac.length) || 1e-9;
  const confidence = (ac[best]! - mean) / sd;

  // 2) beats: the best path through the onsets with steps close to the period
  const score = new Float64Array(n);
  const from = new Int32Array(n).fill(-1);
  const tight = 100;
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bestPrev = -1;
    let bestScore = 0;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const s = score[p]! - tight * Math.log((t - p) / period) ** 2;
      if (bestPrev < 0 || s > bestScore) {
        bestScore = s;
        bestPrev = p;
      }
    }
    // no clamping: a quiet break does not cut the path, so the beats run from start to end
    score[t] = o[t]! + (bestPrev >= 0 ? bestScore : 0);
    from[t] = bestPrev;
  }
  // end on the best-scoring frame within the last period
  let end = n - 1;
  for (let t = Math.max(0, n - Math.ceil(period)); t < n; t++) if (score[t]! > score[end]!) end = t;
  const frames: number[] = [];
  for (let t = end; t >= 0; t = from[t]!) {
    frames.push(t);
    if (from[t]! < 0) break;
  }
  frames.reverse();
  return { tempo: Math.round(((60 * rate) / period) * 10) / 10, beats: frames.map((f) => Math.round((f / rate) * 1000) / 1000), confidence: Math.round(confidence * 10) / 10 };
};

/** Where the beats of a music clip land on the timeline. */
export const timelineBeats = (clip: Pick<AudioClip, 'start' | 'duration' | 'trimStart' | 'speed' | 'loop'>, beats: number[], sourceLength?: number): number[] => {
  const out: number[] = [];
  const end = clip.start + clip.duration;
  const loops = clip.loop && sourceLength ? Math.ceil((clip.duration * clip.speed + clip.trimStart) / sourceLength) : 1;
  for (let k = 0; k < loops; k++) {
    for (const b of beats) {
      const src = b + k * (sourceLength ?? 0);
      const t = clip.start + (src - clip.trimStart) / clip.speed;
      if (t >= clip.start - 1e-6 && t <= end + 1e-6) out.push(Math.round(t * 1000) / 1000);
    }
  }
  return out;
};

export interface BeatCutClip {
  id: string;
  start: number;
  duration: number;
  /** the longest it can be (video: what is left of its source) */
  maxDuration?: number;
}

/**
 * Re-time clips (in their order) so each one starts on a beat and lasts whole beats: about as long
 * as before, or exactly `every` beats; back to back from the beat nearest the first clip's start.
 */
export const planBeatCuts = (clips: BeatCutClip[], beats: number[], opts: { every?: number } = {}): { id: string; start: number; duration: number }[] => {
  if (beats.length < 2 || !clips.length) return clips.map(({ id, start, duration }) => ({ id, start, duration }));
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const gaps = beats.slice(1).map((b, i) => b - beats[i]!).sort((a, b) => a - b);
  const beat = gaps[Math.floor(gaps.length / 2)]!;
  // beat i's time, continuing the grid past the last detected beat
  const at = (i: number) => (i < beats.length ? beats[i]! : beats[beats.length - 1]! + (i - beats.length + 1) * beat);
  let idx = 0;
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i]! - sorted[0]!.start) < Math.abs(beats[idx]! - sorted[0]!.start)) idx = i;
  const out: { id: string; start: number; duration: number }[] = [];
  for (const c of sorted) {
    let k = opts.every ?? Math.max(1, Math.round(c.duration / beat));
    while (k > 1 && c.maxDuration !== undefined && at(idx + k) - at(idx) > c.maxDuration + 1e-6) k--;
    const start = at(idx);
    const duration = Math.min(at(idx + k) - start, c.maxDuration ?? Infinity);
    out.push({ id: c.id, start: Math.round(start * 1000) / 1000, duration: Math.round(duration * 1000) / 1000 });
    idx += k;
  }
  return out;
};

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
  /** mouth center and width (fractions of the frame), from the detector's landmarks */
  mouth?: { x: number; y: number; w: number };
}

/** One person over time: where their face is and how much their mouth moves (for who-is-talking). */
export interface TalkTrack {
  id: number;
  /** detections (media fractions), clip or source time */
  faces: { t: number; face: FaceBox }[];
  /** mouth movement per analysis frame (higher = more likely talking) */
  energy: { t: number; e: number }[];
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
  /** single: follow one face; speakers: cut to whoever talks; group: everyone fits, framed together */
  mode?: 'single' | 'speakers' | 'group';
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
  const plan: ReframePlan = { found, total: sorted.length, people, moves: 0, mode: 'single' };
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

// ---------------------------------------------------------------------------
// Several people: cut to whoever is talking
// ---------------------------------------------------------------------------

export interface SpeakerOptions extends ReframeOptions {
  /** clip-time intervals with speech (from the audio); everything counts as speech when omitted */
  speech?: [number, number][];
  /** decision step in seconds (default 0.5) */
  bin?: number;
  /** a new speaker must lead this long before the camera switches (default 1 s) */
  minLead?: number;
  /** shortest shot in seconds (default 2) */
  minShot?: number;
}

const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0;
};

/**
 * Plan a multicam-style crop for two or more people: the camera holds on whoever is talking and
 * cuts when someone else takes over (or frames everyone when they all fit). Returns null when
 * this does not apply: fewer than two people, or no mouth movement to tell who is talking
 * (then use planReframe).
 */
export const planSpeakerReframe = (tracks: TalkTrack[], g: CropGeometry, duration: number, opts: SpeakerOptions = {}): ReframePlan | null => {
  const bin = opts.bin ?? 0.5;
  const nb = Math.max(1, Math.ceil(duration / bin - 1e-9));
  const detTimes = [...new Set(tracks.flatMap((tr) => tr.faces.map((f) => f.t)))];
  if (!detTimes.length) return null;
  const people = tracks.filter((tr) => tr.faces.length >= Math.max(2, 0.3 * detTimes.length));
  if (people.length < 2) return null;
  // people who never share the frame are one person across shots (or a cut): not a conversation
  const together = detTimes.filter((t) => people.filter((tr) => tr.faces.some((f) => Math.abs(f.t - t) < 1e-6)).length >= 2).length;
  if (together < 0.3 * detTimes.length) return null;
  const base: Omit<ReframePlan, 'moves'> = { found: detTimes.length, total: detTimes.length, people: people.length };

  /** where a person's face typically is between t0 and t1 */
  const posNear = (tr: TalkTrack, t0: number, t1: number): FaceBox | null => {
    const fs = tr.faces.filter((f) => f.t >= t0 - 0.75 && f.t <= t1 + 0.75).map((f) => f.face);
    if (!fs.length) return null;
    return { cx: median(fs.map((f) => f.cx)), cy: median(fs.map((f) => f.cy)), w: median(fs.map((f) => f.w)), h: median(fs.map((f) => f.h)), score: 1 };
  };
  const all = people.map((tr) => posNear(tr, 0, duration)!);
  const targetX = opts.targetX ?? 0.5;
  const targetY = opts.targetY ?? 0.42;

  // everyone fits in the crop: frame them together and never cut
  const visX = 1 / (g.scale * g.kx);
  const visY = 1 / (g.scale * g.ky);
  const left = Math.min(...all.map((p) => p.cx - p.w * 0.75));
  const right = Math.max(...all.map((p) => p.cx + p.w * 0.75));
  const top = Math.min(...all.map((p) => p.cy - p.h * 0.75));
  const bottom = Math.max(...all.map((p) => p.cy + p.h * 0.75));
  if (right - left <= visX * 0.95 && bottom - top <= visY * 0.95) {
    const fx = focusFor((left + right) / 2, g.kx, g.scale, 0.5);
    const fy = focusFor((top + bottom) / 2, g.ky, g.scale, 0.45);
    return { ...base, focus: { x: r4(fx ?? 0.5), y: r4(fy ?? 0.5) }, moves: 0, mode: 'group' };
  }

  // mouth activity per person and time step, above that person's resting level (their quietest
  // moments; capped near the quietest person's level, so someone who hardly stops talking still counts)
  const means = people.map((tr) => {
    const sum = new Float64Array(nb);
    const cnt = new Float64Array(nb);
    for (const { t, e } of tr.energy) {
      const b = Math.min(nb - 1, Math.max(0, Math.floor(t / bin)));
      sum[b] += e;
      cnt[b]++;
    }
    return Array.from(sum, (v, i) => (cnt[i] ? v / cnt[i]! : 0));
  });
  const quiet = means.map((m) => percentile(m, 0.1));
  const idle = Math.min(...quiet);
  const act = means.map((m, i) => {
    const rest = Math.min(quiet[i]!, idle * 3 + 1);
    return m.map((v) => Math.max(0, v - rest));
  });
  const peak = Math.max(...act.flat());
  if (!(peak > 0)) return null; // nobody's mouth moves: cannot tell who talks
  const floor = peak * 0.15;
  const speechOverlap = (b: number) => !opts.speech || opts.speech.some(([a, z]) => Math.min(z, (b + 1) * bin) - Math.max(a, b * bin) >= bin * 0.4);

  // who clearly talks in each step (-1 = nobody clearly: silence, or too close to call)
  const raw = Array.from({ length: nb }, (_, b) => {
    if (!speechOverlap(b)) return -1;
    const order = act.map((a, i) => ({ i, v: a[b]! })).sort((x, y) => y.v - x.v);
    const first = order[0]!;
    const second = order[1]?.v ?? 0;
    return first.v > floor && first.v >= 1.4 * second ? first.i : -1;
  });
  const opener = raw.find((r) => r >= 0);
  if (opener === undefined) return null;

  // shots: a new speaker has to lead for a moment, and every shot lasts a minimum time
  const lead = Math.max(1, Math.round((opts.minLead ?? 1) / bin));
  const minShot = Math.max(1, Math.round((opts.minShot ?? 2) / bin));
  const shots: { who: number; start: number }[] = [{ who: opener, start: 0 }];
  let runWho = -1;
  let run = 0;
  let runStart = 0;
  for (let b = 0; b < nb; b++) {
    const r = raw[b]!;
    const cur = shots[shots.length - 1]!;
    if (r < 0) continue; // a pause neither confirms nor breaks a turn
    if (r === cur.who) {
      runWho = -1;
      run = 0;
      continue;
    }
    if (r !== runWho) {
      runWho = r;
      run = 0;
      runStart = b;
    }
    run++;
    const cutAt = Math.max(runStart, cur.start + minShot);
    if (run >= lead && b >= cutAt) {
      shots.push({ who: r, start: cutAt });
      runWho = -1;
      run = 0;
    }
  }

  // cut where the new speaker starts (offline, so the cut can go back to that moment), snapped to
  // the start of their sentence or a cut in the footage when one is close
  const anchors = [...(opts.cuts ?? []), ...(opts.speech ?? []).map(([a]) => a)];
  const keysX: Keyframe[] = [];
  const keysY: Keyframe[] = [];
  shots.forEach((shot, i) => {
    let t0 = shot.start * bin;
    if (i > 0) {
      const near = anchors.filter((a) => Math.abs(a - t0) <= 0.6).sort((a, b) => Math.abs(a - t0) - Math.abs(b - t0))[0];
      if (near !== undefined) t0 = near;
      t0 = Math.max(t0, (keysX.at(-1)?.t ?? keysY.at(-1)?.t ?? 0) + 0.1);
    } else t0 = 0;
    const t1 = i < shots.length - 1 ? shots[i + 1]!.start * bin : duration;
    const p = posNear(people[shot.who]!, t0, t1) ?? all[shot.who]!;
    const fx = focusFor(p.cx, g.kx, g.scale, targetX);
    const fy = focusFor(p.cy, g.ky, g.scale, targetY);
    if (fx !== null) keysX.push({ t: r3(t0), v: r4(fx), ease: 'hold' });
    if (fy !== null) keysY.push({ t: r3(t0), v: r4(fy), ease: 'hold' });
  });
  const finish = (keys: Keyframe[]) => (keys.length ? [...keys, { t: r3(duration), v: keys.at(-1)!.v }] : undefined);
  const kx = finish(keysX);
  const ky = keysY.length && new Set(keysY.map((k) => k.v)).size > 1 ? finish(keysY) : undefined;
  return {
    ...base,
    focus: { x: keysX[0]?.v ?? 0.5, y: keysY[0]?.v ?? 0.5 },
    ...(kx || ky ? { keyframes: { ...(kx ? { 'focus.x': kx } : {}), ...(ky ? { 'focus.y': ky } : {}) } } : {}),
    moves: shots.length - 1,
    mode: 'speakers',
  };
};

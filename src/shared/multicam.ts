/**
 * Multicam: cameras and microphones of one recording, lined up on a shared clock by their sound
 * (server/multicam.ts). Camera cuts are ordinary video clips tied to their group, so switching a
 * cut to another camera only changes which file it shows and where in that file, keeping the moment.
 */
import type { MulticamGroup, Project, VideoClip } from './schema';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const groupOf = (p: Project, clip: { multicam?: string }) => (clip.multicam ? p.multicam.find((g) => g.id === clip.multicam) : undefined);

/** Which camera of its group a cut shows (index into angles), or -1. */
export const angleOf = (group: MulticamGroup, clip: { assetId: string }) => group.angles.findIndex((a) => a.assetId === clip.assetId);

/** When each camera was recording, on the shared clock. */
export const angleCoverage = (p: Project, group: MulticamGroup): { start: number; end: number }[] =>
  group.angles.map((a) => {
    const d = p.assets.find((x) => x.id === a.assetId)?.meta.duration ?? 0;
    return { start: a.offset, end: a.offset + d };
  });

/** The patch that makes a camera cut show camera `angle` at the same moment. */
export const switchAnglePatch = (p: Project, clip: VideoClip, angle: number): { assetId: string; trimStart: number } => {
  const group = groupOf(p, clip);
  if (!group) throw new Error('This clip is not part of a multicam recording');
  const from = group.angles[angleOf(group, clip)];
  if (!from) throw new Error('This clip shows a file that is not one of the multicam cameras');
  const to = group.angles[angle];
  if (!to) throw new Error(`There is no camera ${angle + 1} in "${group.name}" (it has ${group.angles.length})`);
  const trimStart = r3(from.offset + clip.trimStart - to.offset);
  const target = p.assets.find((a) => a.id === to.assetId);
  if (!target) throw new Error(`Camera ${angle + 1}'s file is not in this project`);
  const length = target.meta.duration;
  if (trimStart < -0.05 || (length !== undefined && trimStart + clip.duration * clip.speed > length + 0.05)) {
    throw new Error(`Camera ${angle + 1} was not recording during this part`);
  }
  return { assetId: to.assetId, trimStart: Math.max(0, trimStart) };
};

const quantile = (xs: number[], q: number) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))]!;
};

/** Pearson correlation of two series, skipping unknown (NaN) samples. */
const correlation = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (!Number.isFinite(a[i]!) || !Number.isFinite(b[i]!)) continue;
    n++;
    sa += a[i]!;
    sb += b[i]!;
  }
  if (n < 3) return 0;
  const ma = sa / n;
  const mb = sb / n;
  let cab = 0;
  let caa = 0;
  let cbb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (!Number.isFinite(a[i]!) || !Number.isFinite(b[i]!)) continue;
    cab += (a[i]! - ma) * (b[i]! - mb);
    caa += (a[i]! - ma) ** 2;
    cbb += (b[i]! - mb) ** 2;
  }
  return caa > 0 && cbb > 0 ? cab / Math.sqrt(caa * cbb) : 0;
};

/** Pair each microphone with the close-up whose mouth movement follows it best (-1 when none is left). */
export const matchMics = (mics: ArrayLike<number>[], mouths: ArrayLike<number>[]): number[] => {
  const pairs = mics.flatMap((m, i) => mouths.map((f, j) => ({ i, j, c: correlation(m, f) })));
  pairs.sort((x, y) => y.c - x.c);
  const out = mics.map(() => -1);
  const used = new Set<number>();
  for (const { i, j, c } of pairs) {
    if (out[i] !== -1 || used.has(j) || c <= 0.05) continue;
    out[i] = j;
    used.add(j);
  }
  return out;
};

export interface CameraPlanInput {
  /** per person: how much they are talking in each bin (NaN = unknown) */
  activity: ArrayLike<number>[];
  /** the camera that shows each person (-1: none) */
  personAngle: number[];
  /** the camera that shows everyone */
  wide?: number;
  /** bin length in seconds */
  bin: number;
  bins: number;
  /** someone is speaking in this bin (default: always) */
  speech?: ArrayLike<boolean>;
  /** is camera `angle` recording during bin `b` */
  available: (angle: number, b: number) => boolean;
  /** times (seconds from bin 0) to put cuts on when close, e.g. sentence starts */
  anchors?: number[];
  /** a new speaker has to lead this long before the camera follows (default 1 s) */
  lead?: number;
  /** shortest shot (default 2 s) */
  minShot?: number;
  /** longest stretch on one close-up before a short cutaway to the wide shot (default 20 s; 0 = never) */
  maxShot?: number;
  /** length of those cutaways (default 3 s) */
  cutaway?: number;
}

export interface CameraShot {
  angle: number;
  /** seconds from bin 0 */
  start: number;
  end: number;
}

/**
 * Cut between cameras like a live multicam director: the close-up of whoever is talking, the wide
 * shot when several people talk at once, hysteresis so the picture does not flicker, cuts placed
 * back at the moment the new speaker started, and an occasional cutaway in long monologues.
 */
export const planCameraCuts = (input: CameraPlanInput): CameraShot[] => {
  const { bin, bins } = input;
  const total = r3(bins * bin);
  const fallback = input.wide ?? input.personAngle.find((a) => a >= 0) ?? 0;
  const lead = Math.max(1, Math.round((input.lead ?? 1) / bin));
  const minShot = Math.max(1, Math.round((input.minShot ?? 2) / bin));

  // each person's talking level above their resting level (their quietest moments, capped near the
  // quietest person's, so someone who hardly stops talking still counts), scaled so "talking" is about 1
  const series = input.activity.map((a) => Array.from({ length: bins }, (_, b) => a[b] ?? NaN));
  const quiet = series.map((xs) => quantile(xs, 0.1));
  const idle = Math.min(...quiet);
  const loud = Math.max(...series.map((xs) => quantile(xs, 0.95)));
  const raised = series.map((xs, i) => {
    const rest = Math.min(quiet[i]!, idle + 0.2 * (loud - idle));
    return xs.map((v) => (Number.isFinite(v) ? Math.max(0, v - rest) : NaN));
  });
  const p95 = raised.map((xs) => quantile(xs, 0.95));
  const top = Math.max(...p95, 1e-9);
  const act = raised.map((xs, i) => xs.map((v) => v / Math.max(p95[i]!, top * 0.25)));

  // who clearly talks in each bin: a person, -2 for several at once, -1 for nobody / unclear / pause
  const raw = Array.from({ length: bins }, (_, b) => {
    if (input.speech && !input.speech[b]) return -1;
    const order = act.map((a, i) => ({ i, v: Number.isFinite(a[b]!) ? a[b]! : 0 })).sort((x, y) => y.v - x.v);
    const [first, second] = order;
    if (!first || first.v < 0.3) return -1;
    if (second && second.v >= 0.3 && first.v < 1.5 * second.v) return -2;
    return first.i;
  });
  const want = raw.map((r) => (r >= 0 ? (input.personAngle[r] ?? -1) : r === -2 ? (input.wide ?? -1) : -1));

  // shots with hysteresis (a pause neither confirms nor breaks a turn)
  const opener = want.find((w) => w >= 0) ?? fallback;
  const shots: { angle: number; start: number }[] = [{ angle: opener, start: 0 }];
  let runAngle = -1;
  let run = 0;
  let runStart = 0;
  for (let b = 0; b < bins; b++) {
    const w = want[b]!;
    const cur = shots[shots.length - 1]!;
    if (w < 0) continue;
    if (w === cur.angle) {
      runAngle = -1;
      run = 0;
      continue;
    }
    if (w !== runAngle) {
      runAngle = w;
      run = 0;
      runStart = b;
    }
    run++;
    const cutAt = Math.max(runStart, cur.start + minShot);
    if (run >= lead && b >= cutAt) {
      shots.push({ angle: w, start: cutAt });
      runAngle = -1;
      run = 0;
    }
  }

  // seconds; each cut snapped to a nearby sentence start
  const anchors = input.anchors ?? [];
  let timed: CameraShot[] = shots.map((s, i) => {
    let start = s.start * bin;
    if (i > 0) {
      const near = anchors.filter((a) => Math.abs(a - start) <= 0.6).sort((a, b) => Math.abs(a - start) - Math.abs(b - start))[0];
      if (near !== undefined) start = near;
    }
    return { angle: s.angle, start: i === 0 ? 0 : start, end: 0 };
  });
  timed = timed.filter((s, i) => i === 0 || s.start > timed[i - 1]!.start + 0.1);
  timed.forEach((s, i) => (s.end = i < timed.length - 1 ? timed[i + 1]!.start : total));

  // long close-ups get a short look at the wide shot now and then
  const maxShot = input.maxShot ?? 20;
  const cutaway = input.cutaway ?? 3;
  if (input.wide !== undefined && maxShot > 0) {
    const out: CameraShot[] = [];
    for (const s of timed) {
      if (s.angle === input.wide || s.end - s.start <= maxShot) {
        out.push(s);
        continue;
      }
      let t = s.start;
      while (s.end - t > maxShot) {
        let at = t + maxShot * 0.7;
        const near = anchors.filter((a) => Math.abs(a - at) <= 1.5).sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0];
        if (near !== undefined) at = near;
        if (s.end - (at + cutaway) < (input.minShot ?? 2)) break;
        out.push({ angle: s.angle, start: t, end: at }, { angle: input.wide, start: at, end: at + cutaway });
        t = at + cutaway;
      }
      out.push({ angle: s.angle, start: t, end: s.end });
    }
    timed = out;
  }

  // a camera that was not recording hands over to the wide shot (or any camera that was)
  const fixed: CameraShot[] = [];
  const push = (angle: number, start: number, end: number) => {
    const last = fixed[fixed.length - 1];
    if (last && last.angle === angle && Math.abs(last.end - start) < 1e-6) last.end = end;
    else if (end - start > 1e-6) fixed.push({ angle, start, end });
  };
  for (const s of timed) {
    let t = s.start;
    while (t < s.end - 1e-6) {
      const b = Math.min(bins - 1, Math.floor(t / bin + 1e-9));
      const stepEnd = Math.min(s.end, (b + 1) * bin);
      const order = [s.angle, ...(input.wide !== undefined ? [input.wide] : []), ...input.personAngle.filter((a) => a >= 0), ...Array.from({ length: 9 }, (_, i) => i)];
      const angle = order.find((a) => input.available(a, b)) ?? s.angle;
      push(angle, t, stepEnd);
      t = stepEnd;
    }
  }
  return fixed.map((s) => ({ angle: s.angle, start: r3(s.start), end: r3(s.end) }));
};

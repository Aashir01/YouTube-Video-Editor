/**
 * Keyframe animation for clip properties ("channels").
 *
 * A channel such as "opacity" or "box.x" names a numeric clip field. When it has keyframes, the
 * value at any moment is interpolated between them and overrides the static field. Keyframe times
 * are seconds from the clip start. The renderer, the editor UI, the edit ops and the agent tools
 * all use these helpers, so an animation looks and edits the same everywhere.
 */
import type { Clip, ClipType, Keyframe, KeyframeEase } from './schema';

export const CHANNEL_IDS = ['box.x', 'box.y', 'box.w', 'box.h', 'focus.x', 'focus.y', 'scale', 'opacity', 'rotation', 'volume', 'x', 'y', 'style.size'] as const;
export type Channel = (typeof CHANNEL_IDS)[number];

export interface ChannelInfo {
  label: string;
  min: number;
  max: number;
  /** value of the field when the clip does not set it */
  def: number;
  format: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const CHANNELS: Record<Channel, ChannelInfo> = {
  'box.x': { label: 'Position X', min: -1, max: 2, def: 0, format: pct },
  'box.y': { label: 'Position Y', min: -1, max: 2, def: 0, format: pct },
  'box.w': { label: 'Width', min: 0.01, max: 3, def: 1, format: pct },
  'box.h': { label: 'Height', min: 0.01, max: 3, def: 1, format: pct },
  'focus.x': { label: 'Focus X', min: 0, max: 1, def: 0.5, format: pct },
  'focus.y': { label: 'Focus Y', min: 0, max: 1, def: 0.5, format: pct },
  scale: { label: 'Zoom', min: 0.2, max: 5, def: 1, format: (v) => `${v.toFixed(2)}×` },
  opacity: { label: 'Opacity', min: 0, max: 1, def: 1, format: pct },
  rotation: { label: 'Rotation', min: -3600, max: 3600, def: 0, format: (v) => `${Math.round(v)}°` },
  volume: { label: 'Volume', min: 0, max: 2, def: 1, format: pct },
  x: { label: 'Position X', min: 0, max: 1, def: 0.5, format: pct },
  y: { label: 'Position Y', min: 0, max: 1, def: 0.5, format: pct },
  'style.size': { label: 'Text size', min: 6, max: 600, def: 84, format: (v) => `${Math.round(v)} px` },
};

/** Channels each clip type can animate. Box channels need a picture-in-picture box (one is created on demand). */
export const ANIMATABLE: Record<ClipType, readonly Channel[]> = {
  video: ['box.x', 'box.y', 'box.w', 'box.h', 'focus.x', 'focus.y', 'scale', 'opacity', 'rotation', 'volume'],
  image: ['box.x', 'box.y', 'box.w', 'box.h', 'focus.x', 'focus.y', 'scale', 'opacity', 'rotation'],
  text: ['x', 'y', 'style.size', 'opacity', 'rotation'],
  audio: ['volume'],
  scene: [],
  code: [],
  captions: [],
};

export const isChannelOf = (type: ClipType, ch: string): ch is Channel => (ANIMATABLE[type] as readonly string[]).includes(ch);

/** Two keyframe times closer than this are the same moment (well under one frame at 240 fps). */
export const KF_EPS = 0.004;
export const DEFAULT_EASE: KeyframeEase = 'ease-in-out';

type Rec = Record<string, unknown>;
const EMPTY: readonly Keyframe[] = [];
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const sameTime = (a: number, b: number) => Math.abs(a - b) <= KF_EPS;
const clampTo = (ch: Channel, v: number) => Math.min(CHANNELS[ch].max, Math.max(CHANNELS[ch].min, v));

// ---------------------------------------------------------------------------
// Reading values
// ---------------------------------------------------------------------------

/** The static (un-animated) value of a channel. */
export const staticValue = (clip: Clip, ch: Channel): number => {
  const [a, b] = ch.split('.') as [string, string | undefined];
  const top = (clip as unknown as Rec)[a];
  const v = b === undefined ? top : top && typeof top === 'object' ? (top as Rec)[b] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : CHANNELS[ch].def;
};

/** Write a channel value onto a clip-like object, copying the nested object it lives in. */
const writeChannel = (obj: Rec, ch: Channel, v: number): void => {
  const [a, b] = ch.split('.') as [string, string | undefined];
  if (b === undefined) {
    obj[a] = v;
    return;
  }
  const cur = obj[a] as Rec | undefined;
  if (!cur && a === 'box') return; // full-frame clip: nothing to place
  obj[a] = { ...(cur ?? (a === 'focus' ? { x: 0.5, y: 0.5 } : {})), [b]: v };
};

/** The updateClip patch that sets a channel's static value. */
export const channelPatch = (clip: Clip, ch: Channel, v: number): Rec => {
  const [a, b] = ch.split('.') as [string, string | undefined];
  if (b === undefined) return { [a]: v };
  if (a === 'style') return { style: { [b]: v } };
  const cur = (clip as unknown as Rec)[a] as Rec | undefined;
  return { [a]: { ...(cur ?? (a === 'focus' ? { x: 0.5, y: 0.5 } : { x: 0, y: 0, w: 1, h: 1 })), [b]: v } };
};

const EASE_FN: Record<KeyframeEase, (p: number) => number> = {
  linear: (p) => p,
  'ease-in': (p) => p * p * p,
  'ease-out': (p) => 1 - (1 - p) ** 3,
  'ease-in-out': (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
  hold: () => 0,
};

export const easeAt = (ease: KeyframeEase | undefined, p: number): number => EASE_FN[ease ?? DEFAULT_EASE](Math.min(1, Math.max(0, p)));

/** Interpolated value of sorted keyframes at time t (holds the first/last value outside them). */
export const valueAt = (list: readonly Keyframe[], t: number): number => {
  const n = list.length;
  if (n === 0) return Number.NaN;
  if (t <= list[0]!.t) return list[0]!.v;
  if (t >= list[n - 1]!.t) return list[n - 1]!.v;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = list[lo]!;
  const b = list[hi]!;
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  return a.v + (b.v - a.v) * easeAt(a.ease, (t - a.t) / span);
};

export const channelKeys = (clip: Clip, ch: Channel): readonly Keyframe[] => clip.keyframes?.[ch] ?? EMPTY;
export const isAnimated = (clip: Clip, ch: Channel): boolean => channelKeys(clip, ch).length > 0;
export const animatedChannels = (clip: Clip): Channel[] => ANIMATABLE[clip.type].filter((ch) => isAnimated(clip, ch));

/** A channel's value at clip time t: interpolated when animated, otherwise the static field. */
export const channelAt = (clip: Clip, ch: Channel, t: number): number => {
  const list = channelKeys(clip, ch);
  return list.length ? valueAt(list, t) : staticValue(clip, ch);
};

/** The clip as it looks at clip time t: animated channels written over the static fields. */
export const animateClip = <T extends Clip>(clip: T, t: number): T => {
  const kf = clip.keyframes;
  if (!kf) return clip;
  let out: Rec | null = null;
  for (const ch of ANIMATABLE[clip.type]) {
    const list = kf[ch];
    if (!list?.length) continue;
    out ??= { ...(clip as unknown as Rec) };
    writeChannel(out, ch, valueAt(list, t));
  }
  return (out ?? clip) as unknown as T;
};

/** Distinct keyframe times inside the clip, across all channels (for timeline diamonds). */
export const keyframeTimes = (clip: Clip): number[] => {
  if (!clip.keyframes) return [];
  const ts: number[] = [];
  for (const ch of ANIMATABLE[clip.type]) for (const k of clip.keyframes[ch] ?? EMPTY) if (k.t >= -KF_EPS && k.t <= clip.duration + KF_EPS) ts.push(k.t);
  ts.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of ts) if (!out.length || !sameTime(out[out.length - 1]!, t)) out.push(t);
  return out;
};

/** Channels that have a keyframe at time t. */
export const channelsAt = (clip: Clip, t: number): Channel[] => ANIMATABLE[clip.type].filter((ch) => channelKeys(clip, ch).some((k) => sameTime(k.t, t)));

// ---------------------------------------------------------------------------
// Editing (mutates a draft clip; used by the edit ops)
// ---------------------------------------------------------------------------

const requireChannel = (clip: Clip, name: string): Channel => {
  if (isChannelOf(clip.type, name)) return name;
  const list = ANIMATABLE[clip.type];
  throw new Error(list.length ? `"${name}" cannot be animated on a ${clip.type} clip. Animatable: ${list.join(', ')}` : `${clip.type} clips have no animatable properties`);
};

/** Box channels animate a picture-in-picture frame; a full-frame clip gets a full-frame box first. */
const ensureBox = (clip: Clip) => {
  if ((clip.type === 'video' || clip.type === 'image') && !clip.box) clip.box = { x: 0, y: 0, w: 1, h: 1 };
};

const store = (clip: Clip, kf: Record<string, Keyframe[]>) => {
  const clean = Object.fromEntries(Object.entries(kf).filter(([, l]) => l.length > 0));
  if (Object.keys(clean).length) clip.keyframes = clean;
  else delete clip.keyframes;
};

/** Insert or replace keyframes at clip time t for one or more channels. */
export const setKeyframes = (clip: Clip, t: number, values: Record<string, number>, ease?: KeyframeEase): void => {
  if (!Number.isFinite(t)) throw new Error('Keyframe time must be a number of seconds');
  const time = r3(t);
  const kf: Record<string, Keyframe[]> = { ...(clip.keyframes ?? {}) };
  for (const [name, raw] of Object.entries(values)) {
    const ch = requireChannel(clip, name);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`Keyframe value for "${ch}" must be a number`);
    if (ch.startsWith('box.')) ensureBox(clip);
    const list = [...(kf[ch] ?? [])];
    const i = list.findIndex((k) => sameTime(k.t, time));
    const keepEase = ease ?? (i >= 0 ? list[i]!.ease : undefined);
    const k: Keyframe = { t: i >= 0 ? list[i]!.t : time, v: r4(clampTo(ch, raw)), ...(keepEase ? { ease: keepEase } : {}) };
    if (i >= 0) list[i] = k;
    else list.push(k);
    list.sort((a, b) => a.t - b.t);
    kf[ch] = list;
  }
  store(clip, kf);
};

/**
 * Remove the keyframes at time t (every channel, or the given ones). A channel left with no
 * keyframes keeps the removed value as its static value, so nothing jumps. Returns how many went.
 */
export const removeKeyframes = (clip: Clip, t: number, channels?: string[]): number => {
  if (!clip.keyframes) return 0;
  let removed = 0;
  const kf: Record<string, Keyframe[]> = { ...clip.keyframes };
  for (const [ch, list] of Object.entries(kf)) {
    if (channels && !channels.includes(ch)) continue;
    const gone = list.find((k) => sameTime(k.t, t));
    if (!gone) continue;
    const keep = list.filter((k) => !sameTime(k.t, t));
    removed += list.length - keep.length;
    kf[ch] = keep;
    if (!keep.length && isChannelOf(clip.type, ch)) writeChannel(clip as unknown as Rec, ch, gone.v);
  }
  store(clip, kf);
  return removed;
};

/** Stop animating channels (all, or the given ones); the value at clip time `keepAt` becomes static. */
export const clearKeyframes = (clip: Clip, channels?: string[], keepAt = 0): void => {
  if (!clip.keyframes) return;
  const kf: Record<string, Keyframe[]> = { ...clip.keyframes };
  for (const [ch, list] of Object.entries(kf)) {
    if (channels && !channels.includes(ch)) continue;
    if (list.length && isChannelOf(clip.type, ch)) writeChannel(clip as unknown as Rec, ch, r4(valueAt(list, keepAt)));
    delete kf[ch];
  }
  store(clip, kf);
};

/** Move the keyframes at `from` to `to` (replacing any already there). Returns how many moved. */
export const moveKeyframes = (clip: Clip, from: number, to: number, channels?: string[]): number => {
  if (!clip.keyframes) return 0;
  const time = r3(to);
  let moved = 0;
  const kf: Record<string, Keyframe[]> = { ...clip.keyframes };
  for (const [ch, list] of Object.entries(kf)) {
    if (channels && !channels.includes(ch)) continue;
    const k = list.find((x) => sameTime(x.t, from));
    if (!k) continue;
    moved++;
    kf[ch] = [...list.filter((x) => x !== k && !sameTime(x.t, time)), { ...k, t: time }].sort((a, b) => a.t - b.t);
  }
  store(clip, kf);
  return moved;
};

/** Change how the value travels from the keyframes at t to the next ones. */
export const setKeyframeEase = (clip: Clip, t: number, ease: KeyframeEase, channels?: string[]): number => {
  if (!clip.keyframes) return 0;
  let changed = 0;
  const kf: Record<string, Keyframe[]> = {};
  for (const [ch, list] of Object.entries(clip.keyframes)) {
    kf[ch] = list.map((k) => {
      if ((channels && !channels.includes(ch)) || !sameTime(k.t, t)) return k;
      changed++;
      return { ...k, ease };
    });
  }
  store(clip, kf);
  return changed;
};

// ---------------------------------------------------------------------------
// Keeping animation in place through timeline edits
// ---------------------------------------------------------------------------

/** Shift every keyframe by delta seconds (positive = later in the clip). */
export const shiftKeyframes = (clip: Clip, delta: number): void => {
  if (!clip.keyframes || !delta) return;
  clip.keyframes = Object.fromEntries(Object.entries(clip.keyframes).map(([ch, l]) => [ch, l.map((k) => ({ ...k, t: r3(k.t + delta) }))]));
};

/** Stretch keyframe times (e.g. after a speed change: factor = old speed / new speed). */
export const scaleKeyframeTimes = (clip: Clip, factor: number): void => {
  if (!clip.keyframes || !(factor > 0) || factor === 1) return;
  clip.keyframes = Object.fromEntries(Object.entries(clip.keyframes).map(([ch, l]) => [ch, l.map((k) => ({ ...k, t: r3(k.t * factor) }))]));
};

/** Drop keyframes that can no longer show: outside the clip, except the nearest one on each side. */
export const pruneKeyframes = (clip: Clip): void => {
  if (!clip.keyframes) return;
  const kf: Record<string, Keyframe[]> = {};
  for (const [ch, list] of Object.entries(clip.keyframes)) {
    const inside = list.filter((k) => k.t >= -KF_EPS && k.t <= clip.duration + KF_EPS);
    const before = list.filter((k) => k.t < -KF_EPS).at(-1);
    const after = list.find((k) => k.t > clip.duration + KF_EPS);
    kf[ch] = [...(before ? [before] : []), ...inside, ...(after ? [after] : [])];
  }
  store(clip, kf);
};

/** Validate and normalize a clip's keyframes: known channels only, sorted, one per moment, values in range. */
export const sanitizeKeyframes = (clip: Clip): void => {
  const kf = clip.keyframes;
  if (!kf) return;
  const out: Record<string, Keyframe[]> = {};
  for (const [name, list] of Object.entries(kf)) {
    if (!list?.length) continue;
    const ch = requireChannel(clip, name);
    if (ch.startsWith('box.')) ensureBox(clip);
    const sorted = list.map((k) => ({ ...k, t: r3(k.t), v: clampTo(ch, k.v) })).sort((a, b) => a.t - b.t);
    const dedup: Keyframe[] = [];
    for (const k of sorted) {
      if (dedup.length && sameTime(dedup[dedup.length - 1]!.t, k.t)) dedup[dedup.length - 1] = k;
      else dedup.push(k);
    }
    out[ch] = dedup;
  }
  store(clip, out);
};

/** Short description of a clip's animation for the agent's timeline summary. */
export const describeAnimation = (clip: Clip): string => {
  const chs = animatedChannels(clip);
  return chs.length ? `animated ${chs.map((ch) => `${ch}×${channelKeys(clip, ch).length}`).join(' ')}` : '';
};

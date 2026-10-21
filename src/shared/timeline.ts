import {
  ClipSchema,
  ProjectSchema,
  SCHEMA_VERSION,
  TRACK_ACCEPTS,
  type Asset,
  type AudioClip,
  type CaptionsClip,
  type Clip,
  type ClipInput,
  type MediaClip,
  type Project,
  type Track,
  type TrackKind,
  type VideoClip,
  type Word,
} from './schema';
import { uid } from './ids';

export const EPS = 0.001;
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
export const clipEnd = (c: { start: number; duration: number }): number => c.start + c.duration;

export const formatTime = (sec: number, withMs = true): string => {
  const neg = sec < 0;
  const s = Math.abs(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const ss = withMs ? rest.toFixed(2).padStart(5, '0') : Math.floor(rest).toString().padStart(2, '0');
  const body = h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m.toString().padStart(2, '0')}:${ss}`;
  return neg ? `-${body}` : body;
};

// ---------------------------------------------------------------------------
// Project creation & normalization
// ---------------------------------------------------------------------------

export const ASPECTS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
} as const;
export type Aspect = keyof typeof ASPECTS;

export const aspectOf = (width: number, height: number): Aspect | 'custom' => {
  const r = width / height;
  for (const [k, v] of Object.entries(ASPECTS)) if (Math.abs(r - v.width / v.height) < 0.01) return k as Aspect;
  return 'custom';
};

export const DEFAULT_TRACKS: { name: string; kind: TrackKind }[] = [
  { name: 'Main', kind: 'video' },
  { name: 'B-roll', kind: 'overlay' },
  { name: 'Graphics', kind: 'overlay' },
  { name: 'Captions', kind: 'captions' },
  { name: 'Voiceover', kind: 'audio' },
  { name: 'Music', kind: 'audio' },
  { name: 'SFX', kind: 'audio' },
];

export interface CreateProjectOptions {
  name: string;
  format?: 'long' | 'short';
  mode?: 'edit' | 'generate' | 'hybrid';
  topic?: string;
  fps?: number;
}

export const createProject = (opts: CreateProjectOptions): Project => {
  const now = new Date().toISOString();
  const format = opts.format ?? 'long';
  const size = format === 'short' ? ASPECTS['9:16'] : ASPECTS['16:9'];
  return ProjectSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: uid('prj', 10),
    name: opts.name,
    createdAt: now,
    updatedAt: now,
    canvas: { width: size.width, height: size.height, fps: opts.fps ?? 30 },
    brief: { topic: opts.topic ?? '', format, mode: opts.mode ?? 'hybrid' },
    tracks: DEFAULT_TRACKS.map((t) => ({ id: uid('trk'), name: t.name, kind: t.kind, clips: [] })),
  });
};

/** Duration of the timeline, ignoring clips that only follow the timeline (auto captions). */
export const projectDuration = (p: Project): number => {
  let end = 0;
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (c.type === 'captions' && c.mode === 'auto') continue;
      end = Math.max(end, clipEnd(c));
    }
  }
  return round3(end);
};

const isFollower = (c: Clip): boolean =>
  (c.type === 'captions' && c.mode === 'auto') || (c.type === 'audio' && c.role === 'music' && c.loop);

/**
 * Keeps "span the whole video" clips (auto captions, looping music beds) attached to the
 * end of the timeline after an edit changes the duration. A follower clip that reached the
 * old end is stretched/shrunk to the new end.
 */
export const reconcileFollowers = (next: Project, prev: Project | null): void => {
  const prevEnd = prev ? projectDurationWithoutFollowers(prev) : null;
  const newEnd = projectDurationWithoutFollowers(next);
  if (newEnd <= 0) return;
  for (const t of next.tracks) {
    for (const c of t.clips) {
      if (!isFollower(c)) continue;
      const reachedOldEnd = prevEnd === null || clipEnd(c) >= prevEnd - 0.05;
      if (reachedOldEnd || clipEnd(c) > newEnd) {
        const d = round3(newEnd - c.start);
        if (d > 0.05) c.duration = d;
      }
    }
  }
};

const projectDurationWithoutFollowers = (p: Project): number => {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) if (!isFollower(c)) end = Math.max(end, clipEnd(c));
  return round3(end);
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface ClipRef {
  track: Track;
  clip: Clip;
  index: number;
}

export const findClip = (p: Project, clipId: string): ClipRef | null => {
  for (const track of p.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index]!, index };
  }
  return null;
};

export const requireClip = (p: Project, clipId: string): ClipRef => {
  const ref = findClip(p, clipId);
  if (!ref) throw new Error(`Clip "${clipId}" not found`);
  return ref;
};

export const getTrack = (p: Project, trackId: string): Track | undefined => p.tracks.find((t) => t.id === trackId);

export const requireTrack = (p: Project, trackIdOrName: string): Track => {
  const t =
    p.tracks.find((x) => x.id === trackIdOrName) ??
    p.tracks.find((x) => x.name.toLowerCase() === trackIdOrName.toLowerCase());
  if (!t) throw new Error(`Track "${trackIdOrName}" not found. Tracks: ${p.tracks.map((x) => `${x.id} (${x.name})`).join(', ')}`);
  return t;
};

export const getAsset = (p: Project, assetId: string): Asset | undefined => p.assets.find((a) => a.id === assetId);

export const requireAsset = (p: Project, assetId: string): Asset => {
  const a = getAsset(p, assetId);
  if (!a) throw new Error(`Asset "${assetId}" not found`);
  return a;
};

/** Default track for a clip type when the caller did not specify one. */
export const defaultTrackFor = (p: Project, clip: Pick<Clip, 'type'> & { role?: string }): Track => {
  const byName = (name: string) => p.tracks.find((t) => t.name.toLowerCase() === name.toLowerCase());
  const byKind = (kind: TrackKind) => p.tracks.find((t) => t.kind === kind);
  let t: Track | undefined;
  switch (clip.type) {
    case 'audio':
      t =
        clip.role === 'voiceover'
          ? byName('Voiceover')
          : clip.role === 'sfx'
            ? byName('SFX')
            : clip.role === 'original'
              ? byName('Voiceover')
              : byName('Music');
      t ??= byKind('audio');
      break;
    case 'captions':
      t = byKind('captions');
      break;
    case 'text':
    case 'code':
      t = byName('Graphics') ?? byKind('overlay');
      break;
    default:
      t = byName('Main') ?? byKind('video');
  }
  if (!t) {
    const kind: TrackKind = clip.type === 'audio' ? 'audio' : clip.type === 'captions' ? 'captions' : 'video';
    t = addTrack(p, { name: kind === 'audio' ? 'Audio' : kind === 'captions' ? 'Captions' : 'Main', kind });
  }
  return t;
};

export const addTrack = (p: Project, opts: { name: string; kind: TrackKind; index?: number }): Track => {
  const track: Track = { id: uid('trk'), name: opts.name, kind: opts.kind, muted: false, hidden: false, locked: false, clips: [] };
  if (opts.index === undefined) {
    // keep visual tracks before audio tracks for readability
    if (opts.kind === 'audio') p.tracks.push(track);
    else {
      const firstAudio = p.tracks.findIndex((t) => t.kind === 'audio');
      const capIdx = p.tracks.findIndex((t) => t.kind === 'captions');
      const insertAt = opts.kind === 'captions' ? (firstAudio < 0 ? p.tracks.length : firstAudio) : capIdx >= 0 ? capIdx : firstAudio < 0 ? p.tracks.length : firstAudio;
      p.tracks.splice(insertAt, 0, track);
    }
  } else p.tracks.splice(opts.index, 0, track);
  return track;
};

// ---------------------------------------------------------------------------
// Overlaps & placement
// ---------------------------------------------------------------------------

/** Allowed overlap between two clips (crossfade) given their transitions. */
const allowedOverlap = (a: Clip, b: Clip): number => {
  const first = a.start <= b.start ? a : b;
  const second = first === a ? b : a;
  return Math.max(second.transitionIn?.duration ?? 0, first.transitionOut?.duration ?? 0);
};

export const overlapAmount = (a: { start: number; duration: number }, b: { start: number; duration: number }): number =>
  Math.max(0, Math.min(clipEnd(a), clipEnd(b)) - Math.max(a.start, b.start));

export const conflictsOnTrack = (track: Track, clip: Clip, ignoreId?: string): Clip[] =>
  track.clips.filter(
    (c) => c.id !== clip.id && c.id !== ignoreId && overlapAmount(c, clip) > allowedOverlap(c, clip) + EPS,
  );

const sortTrack = (t: Track) => t.clips.sort((a, b) => a.start - b.start);

export type ConflictMode = 'error' | 'new-track' | 'overwrite' | 'allow';

export interface PlaceOptions {
  trackId?: string;
  onConflict?: ConflictMode;
}

export const normalizeClip = (input: ClipInput | Clip): Clip => {
  const withId = { ...input, id: input.id || uid('clip') } as ClipInput;
  const parsed = ClipSchema.parse(withId);
  parsed.start = round3(parsed.start);
  parsed.duration = round3(parsed.duration);
  return parsed;
};

/**
 * Inserts a clip on a track. With onConflict:
 *  - 'error'     throw if it overlaps another clip
 *  - 'new-track' put it on a new track of the same kind (stacked above)
 *  - 'overwrite' trim/split/remove what is underneath (NLE overwrite edit)
 *  - 'allow'     keep the overlap (e.g. crossfades)
 */
export const placeClip = (p: Project, input: ClipInput | Clip, opts: PlaceOptions = {}): { clip: Clip; track: Track } => {
  const clip = normalizeClip(input);
  let track = opts.trackId ? requireTrack(p, opts.trackId) : defaultTrackFor(p, clip as Clip & { role?: string });
  if (!TRACK_ACCEPTS[track.kind].includes(clip.type)) {
    throw new Error(`Track "${track.name}" (${track.kind}) cannot hold ${clip.type} clips. Use a ${Object.entries(TRACK_ACCEPTS).filter(([, v]) => v.includes(clip.type)).map(([k]) => k).join('/')} track.`);
  }
  if (findClip(p, clip.id)) throw new Error(`Clip id "${clip.id}" already exists`);
  validateMediaBounds(p, clip);
  const conflicts = conflictsOnTrack(track, clip);
  const mode = opts.onConflict ?? 'error';
  if (conflicts.length > 0) {
    if (mode === 'error') {
      throw new Error(
        `Clip overlaps ${conflicts.map((c) => `${c.id} (${c.start.toFixed(2)}-${clipEnd(c).toFixed(2)}s)`).join(', ')} on track "${track.name}". Choose another start, use onConflict "overwrite" to replace what is underneath, or "new-track" to stack it.`,
      );
    }
    if (mode === 'new-track') {
      const idx = p.tracks.indexOf(track);
      const existingAbove = p.tracks
        .slice(idx + 1)
        .find((t) => t.kind === track.kind && conflictsOnTrack(t, clip).length === 0);
      track = existingAbove ?? addTrack(p, { name: `${track.name} ${p.tracks.filter((t) => t.kind === track.kind).length + 1}`, kind: track.kind, index: idx + 1 });
    } else if (mode === 'overwrite') {
      clearRange(p, track, clip.start, clipEnd(clip));
    }
  }
  track.clips.push(clip);
  sortTrack(track);
  return { clip, track };
};

const validateMediaBounds = (p: Project, clip: Clip): void => {
  if (clip.type !== 'video' && clip.type !== 'audio') return;
  const asset = getAsset(p, clip.assetId);
  if (!asset) throw new Error(`Asset "${clip.assetId}" not found`);
  if (clip.type === 'video' && asset.kind !== 'video') throw new Error(`Asset ${asset.id} is ${asset.kind}, not video. Use an image clip for images.`);
  if (clip.type === 'audio' && asset.kind !== 'audio' && asset.kind !== 'video') throw new Error(`Asset ${asset.id} has no audio`);
  const dur = asset.meta.duration;
  if (dur && !(clip.type === 'audio' && clip.loop)) {
    const needed = clip.trimStart + clip.duration * clip.speed;
    if (clip.trimStart >= dur) throw new Error(`trimStart ${clip.trimStart}s is past the end of ${asset.name} (${dur.toFixed(2)}s)`);
    if (needed > dur + 0.05) {
      // clamp instead of failing: the most common cause is rounding or an LLM estimate
      clip.duration = round3((dur - clip.trimStart) / clip.speed);
    }
  }
};

/** Remove everything on a track inside [from, to), trimming/splitting clips on the edges. */
export const clearRange = (p: Project, track: Track, from: number, to: number): void => {
  const next: Clip[] = [];
  for (const c of track.clips) {
    const s = c.start;
    const e = clipEnd(c);
    if (e <= from + EPS || s >= to - EPS) {
      next.push(c);
      continue;
    }
    if (s < from - EPS) next.push(cutClip(c, s, from));
    if (e > to + EPS) next.push(cutClip(c, to, e, true));
  }
  track.clips = next;
  sortTrack(track);
};

/** Returns a copy of clip limited to [from, to) of its timeline span (keeps source sync). */
const cutClip = (c: Clip, from: number, to: number, newId = false): Clip => {
  const copy = structuredClone(c) as Clip;
  if (newId) copy.id = uid('clip');
  const offset = from - c.start;
  copy.start = round3(from);
  copy.duration = round3(to - from);
  if (copy.type === 'video' || copy.type === 'audio') {
    copy.trimStart = round3(copy.trimStart + offset * copy.speed);
  }
  if (copy.type === 'video') {
    copy.zooms = copy.zooms
      .map((z) => ({ ...z, at: z.at - offset }))
      .filter((z) => z.at + z.duration > 0 && z.at < copy.duration)
      .map((z) => (z.at < 0 ? { ...z, duration: z.duration + z.at, at: 0 } : z));
  }
  if (copy.type === 'captions' && copy.mode === 'manual') {
    copy.words = copy.words.filter((w) => w.end > from && w.start < to);
  }
  if (from > c.start + EPS) delete copy.transitionIn;
  if (to < clipEnd(c) - EPS) delete copy.transitionOut;
  return copy;
};

export const removeClip = (p: Project, clipId: string): Clip => {
  const ref = requireClip(p, clipId);
  ref.track.clips.splice(ref.index, 1);
  return ref.clip;
};

export const moveClip = (
  p: Project,
  clipId: string,
  to: { start?: number; trackId?: string; onConflict?: ConflictMode },
): Clip => {
  const ref = requireClip(p, clipId);
  const clip = structuredClone(ref.clip);
  ref.track.clips.splice(ref.index, 1);
  if (to.start !== undefined) clip.start = round3(Math.max(0, to.start));
  try {
    placeClip(p, clip, { trackId: to.trackId ?? ref.track.id, onConflict: to.onConflict ?? 'error' });
  } catch (err) {
    ref.track.clips.splice(ref.index, 0, ref.clip); // restore
    throw err;
  }
  return clip;
};

/** Split a clip at a timeline time. Returns [leftId, rightId]. */
export const splitClip = (p: Project, clipId: string, at: number): [string, string] => {
  const ref = requireClip(p, clipId);
  const c = ref.clip;
  if (at <= c.start + 0.02 || at >= clipEnd(c) - 0.02) throw new Error(`Split point ${at}s must be inside the clip (${c.start}-${clipEnd(c)})`);
  const left = cutClip(c, c.start, at);
  const right = cutClip(c, at, clipEnd(c), true);
  ref.track.clips.splice(ref.index, 1, left, right);
  return [left.id, right.id];
};

/** Move the in/out points of a clip on the timeline, keeping media in sync. */
export const trimClip = (p: Project, clipId: string, edges: { start?: number; end?: number }): Clip => {
  const ref = requireClip(p, clipId);
  const c = ref.clip;
  const newStart = edges.start ?? c.start;
  const newEnd = edges.end ?? clipEnd(c);
  if (newEnd - newStart < 0.05) throw new Error('Clip would be shorter than 0.05s');
  const delta = newStart - c.start;
  const next = structuredClone(c);
  next.start = round3(newStart);
  next.duration = round3(newEnd - newStart);
  if (next.type === 'video' || next.type === 'audio') {
    next.trimStart = round3(next.trimStart + delta * next.speed);
    if (next.trimStart < -EPS) throw new Error(`Cannot extend before the start of the source media (would need ${(-next.trimStart).toFixed(2)}s more)`);
    next.trimStart = Math.max(0, next.trimStart);
    validateMediaBounds(p, next);
  }
  if (next.type === 'video' && delta !== 0) {
    next.zooms = next.zooms.map((z) => ({ ...z, at: z.at - delta })).filter((z) => z.at + z.duration > 0 && z.at < next.duration);
  }
  ref.track.clips[ref.index] = next;
  if (conflictsOnTrack(ref.track, next).length > 0) {
    ref.track.clips[ref.index] = c;
    throw new Error('Trim would overlap a neighbouring clip');
  }
  return next;
};

/**
 * Delete a timeline range and pull everything after it left (ripple delete).
 * Applies to the given tracks, or all tracks when omitted.
 */
export const rippleDelete = (p: Project, from: number, to: number, trackIds?: string[]): void => {
  if (to <= from) throw new Error('Range end must be after start');
  const gap = to - from;
  for (const t of p.tracks) {
    if (trackIds && !trackIds.includes(t.id)) continue;
    clearRange(p, t, from, to);
    for (const c of t.clips) if (c.start >= to - EPS) c.start = round3(c.start - gap);
    for (const c of t.clips) {
      if (c.type === 'captions' && c.mode === 'manual') {
        c.words = c.words.map((w) => (w.start >= to ? { ...w, start: w.start - gap, end: w.end - gap } : w));
      }
    }
  }
  for (const m of p.markers) if (m.time >= to) m.time = round3(m.time - gap);
};

/** Shift every clip starting at/after `from` by `delta` seconds on the given tracks. */
export const shiftClips = (p: Project, from: number, delta: number, trackIds?: string[]): void => {
  for (const t of p.tracks) {
    if (trackIds && !trackIds.includes(t.id)) continue;
    for (const c of t.clips) if (c.start >= from - EPS) c.start = round3(Math.max(0, c.start + delta));
  }
};

/** Pack the clips of a track back-to-back starting from `from` (default: first clip start). */
export const closeGaps = (p: Project, trackId: string, from?: number): void => {
  const t = requireTrack(p, trackId);
  sortTrack(t);
  let cursor = from ?? t.clips[0]?.start ?? 0;
  for (const c of t.clips) {
    const overlapIn = c.transitionIn?.duration ?? 0;
    c.start = round3(Math.max(0, cursor - (c === t.clips[0] ? 0 : overlapIn)));
    cursor = clipEnd(c);
  }
};

// ---------------------------------------------------------------------------
// Source <-> timeline mapping, transcripts, captions and ducking
// ---------------------------------------------------------------------------

export const sourceToTimeline = (clip: MediaClip, src: number): number => clip.start + (src - clip.trimStart) / clip.speed;
export const timelineToSource = (clip: MediaClip, t: number): number => clip.trimStart + (t - clip.start) * clip.speed;

const SPEECH_ROLES = new Set(['voiceover', 'original']);

/** Clips whose audio carries speech that should be captioned. */
export const speechClips = (p: Project, trackIds?: string[]): MediaClip[] => {
  const out: MediaClip[] = [];
  for (const t of p.tracks) {
    if (t.muted) continue;
    if (trackIds && trackIds.length > 0 && !trackIds.includes(t.id)) continue;
    for (const c of t.clips) {
      if (c.type === 'video' && !c.muted && c.volume > 0) out.push(c);
      if (c.type === 'audio' && SPEECH_ROLES.has(c.role) && c.volume > 0) out.push(c);
    }
  }
  return out;
};

/** Words placed on the timeline by mapping each speech clip's source transcript. */
export const timelineWords = (
  p: Project,
  transcripts: Record<string, Word[]>,
  opts: { trackIds?: string[]; from?: number; to?: number } = {},
): Word[] => {
  const words: Word[] = [];
  for (const clip of speechClips(p, opts.trackIds)) {
    const src = transcripts[clip.assetId];
    if (!src || src.length === 0) continue;
    const srcFrom = clip.trimStart;
    const srcTo = clip.trimStart + clip.duration * clip.speed;
    for (const w of src) {
      if (w.end <= srcFrom || w.start >= srcTo) continue;
      // keep a word only if most of it is inside the cut
      const inside = Math.min(w.end, srcTo) - Math.max(w.start, srcFrom);
      if (inside < (w.end - w.start) * 0.5) continue;
      const start = Math.max(clip.start, sourceToTimeline(clip, w.start));
      const end = Math.min(clipEnd(clip), sourceToTimeline(clip, w.end));
      if (end <= start) continue;
      if (opts.from !== undefined && end <= opts.from) continue;
      if (opts.to !== undefined && start >= opts.to) continue;
      words.push({ text: w.text, start: round3(start), end: round3(end), confidence: w.confidence });
    }
  }
  words.sort((a, b) => a.start - b.start);
  // drop words that duplicate a simultaneous source (e.g. same audio on two tracks)
  const out: Word[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && prev.text.trim().toLowerCase() === w.text.trim().toLowerCase() && Math.abs(prev.start - w.start) < 0.05) continue;
    out.push(w);
  }
  return out;
};

export const captionWords = (p: Project, clip: CaptionsClip, transcripts: Record<string, Word[]>): Word[] => {
  const from = clip.start;
  const to = clipEnd(clip);
  if (clip.mode === 'manual') return clip.words.filter((w) => w.end > from && w.start < to);
  return timelineWords(p, transcripts, { trackIds: clip.sourceTrackIds, from, to });
};

export interface CaptionPage {
  start: number;
  end: number;
  words: Word[];
}

export interface PaginateOptions {
  maxWords: number;
  maxChars: number;
  maxDuration: number;
  gapBreak: number;
  hold: number;
}

const SENTENCE_END = /[.!?…]["')\]]?$/;

export const paginateWords = (words: Word[], opts: Partial<PaginateOptions> = {}): CaptionPage[] => {
  const o: PaginateOptions = { maxWords: 3, maxChars: 22, maxDuration: 2.6, gapBreak: 0.6, hold: 0.35, ...opts };
  const pages: CaptionPage[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    pages.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur });
    cur = [];
  };
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.trim().length + 1, 0) + text.length;
    const breakHere =
      cur.length > 0 &&
      (cur.length >= o.maxWords ||
        chars > o.maxChars ||
        (prev && w.start - prev.end > o.gapBreak) ||
        (prev && SENTENCE_END.test(prev.text.trim())) ||
        w.end - cur[0]!.start > o.maxDuration);
    if (breakHere) flush();
    cur.push({ ...w, text });
  }
  flush();
  // let each page linger a little (until the next one starts)
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    const page = pages[i]!;
    page.end = round3(Math.min(page.end + o.hold, next ? next.start : page.end + o.hold));
  }
  return pages;
};

export type Interval = [number, number];

export const mergeIntervals = (intervals: Interval[], joinGap = 0): Interval[] => {
  const sorted = [...intervals].filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + joinGap) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
};

/** Timeline intervals where someone is speaking (used to duck music). */
export const speechIntervals = (p: Project, transcripts: Record<string, Word[]>): Interval[] => {
  const intervals: Interval[] = [];
  const words = timelineWords(p, transcripts);
  for (const w of words) intervals.push([w.start, w.end]);
  // voiceover clips without a transcript count as speech for their whole span
  for (const t of p.tracks) {
    if (t.muted) continue;
    for (const c of t.clips) {
      if (c.type === 'audio' && c.role === 'voiceover' && !(transcripts[c.assetId]?.length)) intervals.push([c.start, clipEnd(c)]);
    }
  }
  return mergeIntervals(intervals, 0.35);
};

/** Gain multiplier for a ducked clip at time t (1 = full volume). */
export const duckGain = (t: number, speech: Interval[], level: number, ramp = 0.3): number => {
  let gain = 1;
  // binary search the first interval whose end + ramp >= t
  let lo = 0;
  let hi = speech.length - 1;
  let idx = speech.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (speech[mid]![1] + ramp >= t) {
      idx = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  for (let i = idx; i < speech.length && i <= idx + 1; i++) {
    const [s, e] = speech[i]!;
    let g = 1;
    if (t >= s && t <= e) g = level;
    else if (t < s && t >= s - ramp) g = 1 - (1 - level) * ((t - (s - ramp)) / ramp);
    else if (t > e && t <= e + ramp) g = level + (1 - level) * ((t - e) / ramp);
    gain = Math.min(gain, g);
  }
  return gain;
};

// ---------------------------------------------------------------------------
// Jump-cut editing (silence / filler removal)
// ---------------------------------------------------------------------------

export const DEFAULT_FILLERS = ['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'ahh', 'hmm', 'mm', 'mmm', 'mhm'];

export interface CutOptions {
  /** Pauses longer than this are removed (seconds). */
  minPause: number;
  padBefore: number;
  padAfter: number;
  removeFillers: boolean;
  fillers: string[];
  /** Extra source ranges to cut (bad takes, mistakes). */
  removeRanges: Interval[];
  /** Drop kept segments shorter than this. */
  minSegment: number;
}

export const DEFAULT_CUT_OPTIONS: CutOptions = {
  minPause: 0.45,
  padBefore: 0.08,
  padAfter: 0.14,
  removeFillers: true,
  fillers: DEFAULT_FILLERS,
  removeRanges: [],
  minSegment: 0.25,
};

const normalizeWord = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

export const isFiller = (text: string, fillers = DEFAULT_FILLERS): boolean => fillers.includes(normalizeWord(text));

const subtractIntervals = (keep: Interval[], remove: Interval[]): Interval[] => {
  let out = keep.map((k) => [...k] as Interval);
  for (const [rs, re] of remove) {
    const next: Interval[] = [];
    for (const [s, e] of out) {
      if (re <= s || rs >= e) next.push([s, e]);
      else {
        if (rs > s) next.push([s, rs]);
        if (re < e) next.push([re, e]);
      }
    }
    out = next;
  }
  return out;
};

/**
 * Computes the source ranges to keep from a talking-head recording.
 * Uses word timestamps when available, otherwise the inverse of detected silences.
 */
export const computeKeepSegments = (
  words: Word[],
  duration: number,
  options: Partial<CutOptions> = {},
  silences?: Interval[],
): Interval[] => {
  const o = { ...DEFAULT_CUT_OPTIONS, ...options };
  let keep: Interval[];
  if (words.length > 0) {
    const spoken = words.filter((w) => !(o.removeFillers && isFiller(w.text, o.fillers)));
    const raw: Interval[] = spoken.map((w) => [Math.max(0, w.start - o.padBefore), Math.min(duration, w.end + o.padAfter)]);
    keep = mergeIntervals(raw, Math.max(0, o.minPause - o.padBefore - o.padAfter));
    if (o.removeFillers) {
      const fillerRanges = words.filter((w) => isFiller(w.text, o.fillers)).map((w) => [w.start, w.end] as Interval);
      keep = subtractIntervals(keep, fillerRanges);
    }
  } else if (silences && silences.length > 0) {
    const longSilences = silences
      .filter(([s, e]) => e - s >= o.minPause)
      .map(([s, e]) => [s + o.padAfter, e - o.padBefore] as Interval)
      .filter(([s, e]) => e > s);
    keep = subtractIntervals([[0, duration]], longSilences);
  } else {
    keep = [[0, duration]];
  }
  keep = subtractIntervals(keep, o.removeRanges);
  return keep.filter(([s, e]) => e - s >= o.minSegment).map(([s, e]) => [round3(s), round3(e)] as Interval);
};

export interface SegmentsToClipsOptions {
  assetId: string;
  startAt: number;
  jumpCutZoom: boolean;
  zoomScale: number;
  focusX: number;
  focusY: number;
}

/** Turns kept source segments into back-to-back video clips (alternating punch-ins hide jump cuts). */
export const segmentsToClips = (segments: Interval[], o: SegmentsToClipsOptions): VideoClip[] => {
  let cursor = o.startAt;
  return segments.map(([s, e], i) => {
    const duration = round3(e - s);
    const zoomed = o.jumpCutZoom && i % 2 === 1 && duration > 0.6;
    const clip = ClipSchema.parse({
      id: uid('clip'),
      type: 'video',
      assetId: o.assetId,
      start: round3(cursor),
      duration,
      trimStart: s,
      zooms: zoomed ? [{ at: 0, duration, scale: o.zoomScale, x: o.focusX, y: o.focusY, style: 'snap' }] : [],
    }) as VideoClip;
    cursor += duration;
    return clip;
  });
};

// ---------------------------------------------------------------------------
// Linting & summaries
// ---------------------------------------------------------------------------

export const lintProject = (p: Project, knownTemplates?: string[]): string[] => {
  const warnings: string[] = [];
  const assetIds = new Set(p.assets.map((a) => a.id));
  for (const t of p.tracks) {
    const sorted = [...t.clips].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i]!;
      if ('assetId' in c && !assetIds.has(c.assetId)) warnings.push(`${c.id} on "${t.name}" references missing asset ${c.assetId}`);
      const n = sorted[i + 1];
      if (n && overlapAmount(c, n) > allowedOverlap(c, n) + 0.01) warnings.push(`${c.id} and ${n.id} overlap on track "${t.name}"`);
      if (c.type === 'scene' && knownTemplates && !knownTemplates.includes(c.template)) warnings.push(`${c.id} uses unknown template "${c.template}"`);
      if (c.type === 'text' && c.text.length > 140) warnings.push(`${c.id} has a lot of on-screen text (${c.text.length} chars) — consider splitting it`);
      if (c.type === 'video' || c.type === 'audio') {
        const a = p.assets.find((x) => x.id === c.assetId);
        const dur = a?.meta.duration;
        if (dur && !(c.type === 'audio' && c.loop) && c.trimStart + c.duration * c.speed > dur + 0.1) warnings.push(`${c.id} plays past the end of ${a?.name}`);
      }
    }
  }
  const main = p.tracks.find((t) => t.kind === 'video');
  if (main && main.clips.length > 0) {
    const sorted = [...main.clips].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const c of sorted) {
      if (c.start - cursor > 0.1) warnings.push(`Gap of ${(c.start - cursor).toFixed(2)}s on "${main.name}" at ${formatTime(cursor)} (black frames unless covered by another track)`);
      cursor = Math.max(cursor, clipEnd(c));
    }
  }
  const hasMusic = p.tracks.some((t) => t.clips.some((c) => c.type === 'audio' && c.role === 'music'));
  const musicNotDucked = p.tracks.some((t) => t.clips.some((c) => c.type === 'audio' && c.role === 'music' && !c.duck));
  const hasSpeech = p.tracks.some((t) => t.clips.some((c) => (c.type === 'audio' && c.role === 'voiceover') || c.type === 'video'));
  if (hasMusic && musicNotDucked && hasSpeech) warnings.push('Music is not set to duck under speech (set duck: true on music clips)');
  return warnings;
};

const describeClip = (c: Clip, p: Project): string => {
  const span = `${c.start.toFixed(2)}–${clipEnd(c).toFixed(2)}s`;
  switch (c.type) {
    case 'video': {
      const z = c.zooms.length ? ` zooms:${c.zooms.length}` : '';
      return `${c.id} video ${c.assetId} ${span} src ${c.trimStart.toFixed(2)}–${(c.trimStart + c.duration * c.speed).toFixed(2)}s${c.speed !== 1 ? ` speed ${c.speed}x` : ''}${c.muted ? ' muted' : ''}${c.box ? ' PiP' : ''}${z}`;
    }
    case 'image':
      return `${c.id} image ${c.assetId} ${span}${c.kenBurns ? ' kenburns' : ''}`;
    case 'audio':
      return `${c.id} audio(${c.role}) ${c.assetId} ${span} vol ${c.volume}${c.duck ? ' ducked' : ''}${c.loop ? ' loop' : ''}`;
    case 'text':
      return `${c.id} text "${c.text.slice(0, 50)}${c.text.length > 50 ? '…' : ''}" ${span}`;
    case 'scene': {
      const title = (c.props.title ?? c.props.heading ?? c.props.text ?? c.props.name ?? '') as string;
      return `${c.id} scene:${c.template}${title ? ` "${String(title).slice(0, 40)}"` : ''} ${span}`;
    }
    case 'code':
      return `${c.id} code-scene${c.description ? ` "${c.description.slice(0, 40)}"` : ''} ${span}`;
    case 'captions':
      return `${c.id} captions(${c.mode}, ${c.style.preset}) ${span}`;
  }
  void p;
};

export const summarizeTimeline = (p: Project, maxClipsPerTrack = 40): string => {
  const lines: string[] = [];
  for (const t of p.tracks) {
    const flags = [t.muted && 'muted', t.hidden && 'hidden', t.locked && 'locked'].filter(Boolean).join(',');
    lines.push(`- ${t.id} "${t.name}" [${t.kind}]${flags ? ` (${flags})` : ''}: ${t.clips.length} clip(s)`);
    const clips = [...t.clips].sort((a, b) => a.start - b.start);
    for (const c of clips.slice(0, maxClipsPerTrack)) lines.push(`    ${describeClip(c, p)}`);
    if (clips.length > maxClipsPerTrack) lines.push(`    … ${clips.length - maxClipsPerTrack} more (use get_timeline with a time range)`);
  }
  return lines.join('\n');
};

export const summarizeAsset = (a: Asset): string => {
  const parts = [`${a.id} [${a.kind}] "${a.name}"`];
  if (a.meta.duration) parts.push(formatTime(a.meta.duration));
  if (a.meta.width && a.meta.height) parts.push(`${a.meta.width}x${a.meta.height}`);
  if (a.kind === 'video') parts.push(a.meta.hasAudio ? 'has audio' : 'no audio');
  if (a.status !== 'ready') parts.push(`status:${a.status}${a.error ? ` (${a.error})` : ''}`);
  if (a.transcript.status === 'done') parts.push(`transcript: ${a.transcript.wordCount ?? '?'} words`);
  else if (a.transcript.status !== 'none') parts.push(`transcript:${a.transcript.status}`);
  if (a.text) parts.push(`document: ${a.text.chars} chars`);
  if (a.origin !== 'upload') parts.push(`origin:${a.origin}`);
  if (a.description) parts.push(`— ${a.description.slice(0, 160)}`);
  else if (a.transcript.preview) parts.push(`— "${a.transcript.preview.slice(0, 120)}…"`);
  return parts.join(' · ');
};

export const summarizeProject = (p: Project): string => {
  const b = p.brief;
  const dur = projectDuration(p);
  const aspect = aspectOf(p.canvas.width, p.canvas.height);
  const lines = [
    `Project "${p.name}" (${p.id}) — ${p.canvas.width}x${p.canvas.height} ${aspect} @${p.canvas.fps}fps — timeline ${formatTime(dur)}`,
    `Brief: ${b.topic ? `topic "${b.topic}"` : 'NO TOPIC YET'}; mode ${b.mode}; format ${b.format}${b.targetDurationSec ? `; target ${formatTime(b.targetDurationSec, false)}` : ''}${b.audience ? `; audience: ${b.audience}` : ''}${b.tone ? `; tone: ${b.tone}` : ''}${b.style ? `; style: ${b.style}` : ''}${b.goal ? `; goal: ${b.goal}` : ''}${b.callToAction ? `; CTA: ${b.callToAction}` : ''}; status ${b.status}`,
  ];
  if (b.keyPoints.length) lines.push(`Key points: ${b.keyPoints.join(' | ')}`);
  if (b.notes) lines.push(`Notes: ${b.notes}`);
  const br = p.brand;
  lines.push(
    `Brand: primary ${br.primary}, secondary ${br.secondary}, accent ${br.accent}, bg ${br.background}; fonts ${br.headingFont}/${br.bodyFont}${br.channelName ? `; channel ${br.channelName}` : ''}${br.handle ? ` ${br.handle}` : ''}${br.logoAssetId ? `; logo ${br.logoAssetId}` : ''}`,
  );
  lines.push(`Assets (${p.assets.length}):`);
  for (const a of p.assets.slice(0, 60)) lines.push(`- ${summarizeAsset(a)}`);
  if (p.assets.length > 60) lines.push(`… ${p.assets.length - 60} more (use list_assets)`);
  if (p.script.sections.length) {
    lines.push(`Script: "${p.script.title}" — ${p.script.sections.length} sections (${p.script.sections.filter((s) => s.status !== 'draft').length} voiced)`);
  }
  lines.push('Timeline:');
  lines.push(summarizeTimeline(p, 25));
  if (p.youtube.title) lines.push(`YouTube title: ${p.youtube.title}`);
  const lastRender = p.renders.find((r) => r.kind === 'video');
  if (lastRender) lines.push(`Last render: ${lastRender.status}${lastRender.file ? ` (${lastRender.file})` : ''}`);
  return lines.join('\n');
};

export const isAudioClip = (c: Clip): c is AudioClip => c.type === 'audio';

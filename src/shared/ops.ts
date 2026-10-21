import {
  AudioMixSchema,
  BrandSchema,
  BriefSchema,
  CanvasSchema,
  ClipSchema,
  ScriptSchema,
  YouTubeSchema,
  type Clip,
  type ClipInput,
  type Project,
  type TrackKind,
} from './schema';
import {
  addTrack,
  closeGaps,
  moveClip,
  placeClip,
  removeClip,
  requireClip,
  requireTrack,
  rippleDelete,
  shiftClips,
  splitClip,
  trimClip,
  type ConflictMode,
  conflictsOnTrack,
} from './timeline';
import { parseTemplateProps } from './templates';

/**
 * Edit operations shared by the editor UI, the agent tools and the MCP server.
 * They mutate a draft project in place and throw readable errors.
 */
export type EditOp =
  | { op: 'addClip'; clip: ClipInput; trackId?: string; onConflict?: ConflictMode }
  | { op: 'updateClip'; clipId: string; patch: Record<string, unknown> }
  | { op: 'removeClips'; clipIds: string[]; ripple?: boolean }
  | { op: 'moveClip'; clipId: string; start?: number; trackId?: string; onConflict?: ConflictMode }
  | { op: 'trimClip'; clipId: string; start?: number; end?: number }
  | { op: 'splitClip'; clipId: string; at: number }
  | { op: 'rippleDelete'; from: number; to: number; trackIds?: string[] }
  | { op: 'shiftClips'; from: number; delta: number; trackIds?: string[] }
  | { op: 'closeGaps'; trackId: string }
  | { op: 'addTrack'; name: string; kind: TrackKind; index?: number }
  | { op: 'updateTrack'; trackId: string; patch: { name?: string; muted?: boolean; hidden?: boolean; locked?: boolean } }
  | { op: 'removeTrack'; trackId: string }
  | { op: 'reorderTrack'; trackId: string; index: number }
  | { op: 'setCanvas'; patch: Record<string, unknown> }
  | { op: 'setBrand'; patch: Record<string, unknown> }
  | { op: 'setBrief'; patch: Record<string, unknown> }
  | { op: 'setYoutube'; patch: Record<string, unknown> }
  | { op: 'setScript'; script: Record<string, unknown> }
  | { op: 'setAudioMix'; patch: Record<string, unknown> }
  | { op: 'renameProject'; name: string }
  | { op: 'updateAsset'; assetId: string; patch: { name?: string; description?: string; tags?: string[] } }
  | { op: 'removeAsset'; assetId: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge for nested objects like `style`, `props`, `grade`; arrays are replaced. */
export const deepMerge = <T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T => {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) {
      delete out[k];
      continue;
    }
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v;
  }
  return out as T;
};

const IMMUTABLE_CLIP_KEYS = new Set(['id', 'type']);

export const updateClip = (p: Project, clipId: string, patch: Record<string, unknown>): Clip => {
  const ref = requireClip(p, clipId);
  if (ref.track.locked) throw new Error(`Track "${ref.track.name}" is locked`);
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => !IMMUTABLE_CLIP_KEYS.has(k)));
  const merged = deepMerge(ref.clip as unknown as Record<string, unknown>, clean);
  if (merged.type === 'scene' && (clean.props || clean.template)) {
    merged.props = parseTemplateProps(String(merged.template), merged.props);
  }
  const next = ClipSchema.parse(merged);
  if (conflictsOnTrack(ref.track, next).length > 0 && ('start' in clean || 'duration' in clean)) {
    throw new Error(`Updated clip would overlap another clip on "${ref.track.name}". Use moveClip with onConflict, or change start/duration.`);
  }
  ref.track.clips[ref.index] = next;
  ref.track.clips.sort((a, b) => a.start - b.start);
  return next;
};

const assertUnlocked = (p: Project, clipId: string) => {
  const ref = requireClip(p, clipId);
  if (ref.track.locked) throw new Error(`Track "${ref.track.name}" is locked`);
};

export const applyOp = (p: Project, op: EditOp): unknown => {
  switch (op.op) {
    case 'addClip': {
      const clip = { ...op.clip } as ClipInput;
      if (clip.type === 'scene') (clip as { props?: unknown }).props = parseTemplateProps(clip.template, clip.props);
      const r = placeClip(p, clip, { trackId: op.trackId, onConflict: op.onConflict });
      if (r.track.locked) throw new Error(`Track "${r.track.name}" is locked`);
      return { clipId: r.clip.id, trackId: r.track.id };
    }
    case 'updateClip':
      return updateClip(p, op.clipId, op.patch).id;
    case 'removeClips': {
      const removed: Clip[] = [];
      for (const id of op.clipIds) {
        assertUnlocked(p, id);
        const ref = requireClip(p, id);
        removed.push(removeClip(p, id));
        if (op.ripple) {
          for (const c of ref.track.clips) if (c.start >= ref.clip.start + ref.clip.duration - 0.001) c.start = Math.round((c.start - ref.clip.duration) * 1000) / 1000;
        }
      }
      return removed.map((c) => c.id);
    }
    case 'moveClip':
      assertUnlocked(p, op.clipId);
      return moveClip(p, op.clipId, { start: op.start, trackId: op.trackId, onConflict: op.onConflict }).id;
    case 'trimClip':
      assertUnlocked(p, op.clipId);
      return trimClip(p, op.clipId, { start: op.start, end: op.end }).id;
    case 'splitClip':
      assertUnlocked(p, op.clipId);
      return splitClip(p, op.clipId, op.at);
    case 'rippleDelete':
      rippleDelete(p, op.from, op.to, op.trackIds);
      return null;
    case 'shiftClips':
      shiftClips(p, op.from, op.delta, op.trackIds);
      return null;
    case 'closeGaps':
      closeGaps(p, requireTrack(p, op.trackId).id);
      return null;
    case 'addTrack':
      return addTrack(p, { name: op.name, kind: op.kind, index: op.index }).id;
    case 'updateTrack': {
      const t = requireTrack(p, op.trackId);
      Object.assign(t, Object.fromEntries(Object.entries(op.patch).filter(([, v]) => v !== undefined)));
      return t.id;
    }
    case 'removeTrack': {
      const t = requireTrack(p, op.trackId);
      if (t.clips.length > 0) throw new Error(`Track "${t.name}" still has ${t.clips.length} clip(s); remove them first`);
      p.tracks = p.tracks.filter((x) => x.id !== t.id);
      return null;
    }
    case 'reorderTrack': {
      const t = requireTrack(p, op.trackId);
      p.tracks = p.tracks.filter((x) => x.id !== t.id);
      p.tracks.splice(Math.max(0, Math.min(op.index, p.tracks.length)), 0, t);
      return null;
    }
    case 'setCanvas':
      p.canvas = CanvasSchema.parse(deepMerge(p.canvas as unknown as Record<string, unknown>, op.patch));
      return null;
    case 'setBrand':
      p.brand = BrandSchema.parse(deepMerge(p.brand as unknown as Record<string, unknown>, op.patch));
      return null;
    case 'setBrief':
      p.brief = BriefSchema.parse(deepMerge(p.brief as unknown as Record<string, unknown>, op.patch));
      return null;
    case 'setYoutube':
      p.youtube = YouTubeSchema.parse(deepMerge(p.youtube as unknown as Record<string, unknown>, op.patch));
      return null;
    case 'setScript':
      p.script = ScriptSchema.parse(op.script);
      return null;
    case 'setAudioMix':
      p.audio = AudioMixSchema.parse(deepMerge(p.audio as unknown as Record<string, unknown>, op.patch));
      return null;
    case 'renameProject':
      if (!op.name.trim()) throw new Error('Name cannot be empty');
      p.name = op.name.trim().slice(0, 120);
      return null;
    case 'updateAsset': {
      const a = p.assets.find((x) => x.id === op.assetId);
      if (!a) throw new Error(`Asset ${op.assetId} not found`);
      if (op.patch.name !== undefined) a.name = op.patch.name;
      if (op.patch.description !== undefined) a.description = op.patch.description;
      if (op.patch.tags !== undefined) a.tags = op.patch.tags;
      return a.id;
    }
    case 'removeAsset': {
      const a = p.assets.find((x) => x.id === op.assetId);
      if (!a) throw new Error(`Asset ${op.assetId} not found`);
      for (const t of p.tracks) t.clips = t.clips.filter((c) => !('assetId' in c) || c.assetId !== op.assetId);
      p.assets = p.assets.filter((x) => x.id !== op.assetId);
      if (p.brand.logoAssetId === op.assetId) delete p.brand.logoAssetId;
      return a.file;
    }
  }
};

export const applyOps = (p: Project, ops: EditOp[]): unknown[] => ops.map((op) => applyOp(p, op));

export const describeOps = (ops: EditOp[]): string => {
  if (ops.length === 1) {
    const o = ops[0]!;
    switch (o.op) {
      case 'addClip':
        return `Add ${o.clip.type}`;
      case 'updateClip':
        return 'Edit clip';
      case 'removeClips':
        return o.clipIds.length > 1 ? `Delete ${o.clipIds.length} clips` : 'Delete clip';
      case 'moveClip':
        return 'Move clip';
      case 'trimClip':
        return 'Trim clip';
      case 'splitClip':
        return 'Split clip';
      default:
        return o.op.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    }
  }
  return `${ops.length} edits`;
};

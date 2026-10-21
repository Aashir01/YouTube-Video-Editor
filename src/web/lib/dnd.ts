import { toast } from 'sonner';
import type { Asset, ClipInput, Project, Track } from '../../shared/schema';
import { TRACK_ACCEPTS } from '../../shared/schema';
import { clipEnd, defaultTrackFor } from '../../shared/timeline';
import { getTemplate } from '../../shared/templates';
import { uid } from '../../shared/ids';
import { api } from './api';
import { useStudio } from './store';
import { errorText } from './utils';

/** Payloads dragged from the left panel onto the timeline. */
export type DragPayload =
  | { kind: 'asset'; assetId: string }
  | { kind: 'template'; templateId: string }
  | { kind: 'sound'; soundId: string; soundKind: 'sfx' | 'music' }
  | { kind: 'text'; preset: 'title' | 'lower' | 'caption-box' }
  | { kind: 'captions' };

export const DND_TYPE = 'application/x-director';

export const setDragPayload = (e: React.DragEvent, payload: DragPayload) => {
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copy';
  currentDrag = payload;
};
export const clearDragPayload = () => {
  currentDrag = null;
};

/** dataTransfer contents can't be read during dragover, so keep the active payload here. */
let currentDrag: DragPayload | null = null;
export const activeDrag = () => currentDrag;

export const readDragPayload = (e: React.DragEvent): DragPayload | null => {
  try {
    const raw = e.dataTransfer.getData(DND_TYPE);
    return raw ? (JSON.parse(raw) as DragPayload) : currentDrag;
  } catch {
    return currentDrag;
  }
};

const roleForTrack = (track: Track | undefined, fallback: 'music' | 'sfx' | 'voiceover'): 'music' | 'sfx' | 'voiceover' => {
  const n = track?.name.toLowerCase() ?? '';
  if (n.includes('voice')) return 'voiceover';
  if (n.includes('music')) return 'music';
  if (n.includes('sfx') || n.includes('effect')) return 'sfx';
  return fallback;
};

/** Build the clip a payload creates (without placing it). */
export const clipForPayload = (p: Project, payload: DragPayload, start: number, track?: Track, asset?: Asset): ClipInput | null => {
  const id = uid('clip');
  switch (payload.kind) {
    case 'asset': {
      const a = asset ?? p.assets.find((x) => x.id === payload.assetId);
      if (!a) return null;
      const dur = a.meta.duration && a.meta.duration > 0 ? a.meta.duration : 5;
      if (a.kind === 'video') {
        if (track?.kind === 'audio') return { id, type: 'audio', assetId: a.id, start, duration: dur, role: roleForTrack(track, 'voiceover') };
        return { id, type: 'video', assetId: a.id, start, duration: dur };
      }
      if (a.kind === 'image') return { id, type: 'image', assetId: a.id, start, duration: 5, kenBurns: { fromScale: 1, toScale: 1.12, fromX: 0.5, fromY: 0.5, toX: 0.5, toY: 0.5, easing: 'ease-in-out' } };
      if (a.kind === 'audio') {
        const role = roleForTrack(track, dur > 30 ? 'music' : 'sfx');
        return { id, type: 'audio', assetId: a.id, start, duration: dur, role, duck: role === 'music', volume: role === 'music' ? 0.5 : 1 };
      }
      return null;
    }
    case 'template': {
      const t = getTemplate(payload.templateId);
      if (!t) return null;
      return { id, type: 'scene', template: t.id, start, duration: t.defaultDuration, props: structuredClone(t.example) as Record<string, unknown>, transitionIn: { type: 'fade', duration: 0.3 } };
    }
    case 'text': {
      if (payload.preset === 'lower')
        return { id, type: 'text', text: 'Your *name* here', start, duration: 4, x: 0.28, y: 0.82, style: { size: 54, weight: 700, font: 'inter', background: 'rgba(0,0,0,0.65)', align: 'left' }, animationIn: 'slide-left' };
      if (payload.preset === 'caption-box') return { id, type: 'text', text: 'Key point goes *here*', start, duration: 3, x: 0.5, y: 0.8, style: { size: 60, background: 'rgba(0,0,0,0.6)' }, animationIn: 'pop' };
      return { id, type: 'text', text: 'Big *bold* title', start, duration: 3, x: 0.5, y: 0.5, style: { size: 120, uppercase: true }, animationIn: 'words' };
    }
    case 'captions':
      return { id, type: 'captions', mode: 'auto', start: 0, duration: Math.max(1, ...p.tracks.flatMap((t) => t.clips.filter((c) => c.type !== 'captions').map(clipEnd))) };
    case 'sound':
      return null; // needs an upload first, see dropPayload
  }
};

/** Find a non-overlapping start near `start` on a track (after the clip under the drop point). */
const settleStart = (track: Track, start: number, duration: number): number => {
  const under = track.clips.find((c) => start >= c.start && start < clipEnd(c));
  let s = under ? clipEnd(under) : start;
  for (let i = 0; i < 50; i++) {
    const hit = track.clips.find((c) => s < clipEnd(c) - 0.001 && s + duration > c.start + 0.001);
    if (!hit) break;
    s = clipEnd(hit);
  }
  return s;
};

const waitForAsset = (assetId: string, timeoutMs = 120_000): Promise<Asset | null> =>
  new Promise((resolve) => {
    const check = () => {
      const a = useStudio.getState().project?.assets.find((x) => x.id === assetId);
      if (a && a.status !== 'processing') return a;
      return null;
    };
    const ready = check();
    if (ready) return resolve(ready);
    const timer = setTimeout(() => {
      unsub();
      resolve(useStudio.getState().project?.assets.find((x) => x.id === assetId) ?? null);
    }, timeoutMs);
    const unsub = useStudio.subscribe(() => {
      const a = check();
      if (a) {
        clearTimeout(timer);
        unsub();
        resolve(a);
      }
    });
  });

/** Place a dragged payload on the timeline. */
export const dropPayload = async (payload: DragPayload, start: number, trackId?: string): Promise<void> => {
  const st = useStudio.getState();
  const p = st.project;
  if (!p) return;
  let asset: Asset | undefined;
  let effective = payload;
  if (payload.kind === 'sound') {
    try {
      asset = await api.addLibrarySound(p.id, payload.soundId);
      effective = { kind: 'asset', assetId: asset.id };
    } catch (err) {
      toast.error(errorText(err));
      return;
    }
  }
  const project = useStudio.getState().project!;
  let track = trackId ? project.tracks.find((t) => t.id === trackId) : undefined;
  const clip = clipForPayload(project, effective, start, track, asset);
  if (!clip) return;
  if (!track || !TRACK_ACCEPTS[track.kind].includes(clip.type)) {
    // look the default up on a copy: it may create a track, which only the server should do
    const fallback = defaultTrackFor(structuredClone(project), { type: clip.type, role: clip.type === 'audio' ? clip.role : undefined });
    track = project.tracks.find((t) => t.id === fallback.id);
  }
  if (payload.kind === 'sound' && !trackId) {
    track = project.tracks.find((t) => t.kind === 'audio' && t.name.toLowerCase().includes(payload.soundKind === 'music' ? 'music' : 'sfx')) ?? track;
    if (clip.type === 'audio') clip.role = payload.soundKind === 'music' ? 'music' : 'sfx';
  }
  if (track && clip.type !== 'captions') clip.start = Math.max(0, settleStart(track, clip.start, clip.duration));
  const res = await st.edit([{ op: 'addClip', clip, trackId: track?.id, onConflict: 'new-track' }], `Add ${clip.type}`);
  if (res) useStudio.setState({ selection: [clip.id!] });
};

/** Upload OS files dropped on the timeline, then place them once analyzed. */
export const dropFiles = async (files: File[], start: number, trackId?: string): Promise<void> => {
  const p = useStudio.getState().project;
  if (!p || files.length === 0) return;
  const id = toast.loading(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
  try {
    const { assets } = await api.upload(p.id, files, (x) => toast.loading(`Uploading… ${Math.round(x * 100)}%`, { id }));
    toast.success('Uploaded', { id });
    let at = start;
    for (const a of assets) {
      if (a.kind === 'document' || a.kind === 'other') continue;
      const ready = await waitForAsset(a.id);
      if (!ready || ready.status === 'error') continue;
      await dropPayload({ kind: 'asset', assetId: a.id }, at, trackId);
      at += ready.kind === 'image' ? 5 : ready.meta.duration ?? 5;
    }
  } catch (err) {
    toast.error(errorText(err), { id });
  }
};

/** Add a payload at the playhead on the most fitting track that is free there. */
export const addAtPlayhead = async (payload: DragPayload): Promise<void> => {
  const st = useStudio.getState();
  const p = st.project;
  if (!p) return;
  const t = st.time;
  if (payload.kind === 'sound') return dropPayload(payload, t);
  const clip = clipForPayload(p, payload, t);
  if (!clip) return;
  const overlay = clip.type === 'text' || clip.type === 'code' || (clip.type === 'scene' && getTemplate(clip.template)?.overlay);
  const score = (tr: Track): number => {
    const n = tr.name.toLowerCase();
    if (clip.type === 'audio') return n.includes(clip.role === 'voiceover' ? 'voice' : clip.role ?? 'music') ? 0 : 1;
    if (overlay) return n.includes('graphic') ? 0 : tr.kind === 'overlay' ? 1 : 2;
    return tr.kind === 'video' ? 0 : n.includes('b-roll') ? 1 : 2;
  };
  const candidates = p.tracks.filter((tr) => !tr.locked && TRACK_ACCEPTS[tr.kind].includes(clip.type)).sort((a, b) => score(a) - score(b));
  const end = clip.start + clip.duration;
  const free = candidates.find((tr) => !tr.clips.some((c) => clip.start < clipEnd(c) - 0.001 && end > c.start + 0.001));
  const res = await st.edit([{ op: 'addClip', clip, trackId: (free ?? candidates[0])?.id, onConflict: 'new-track' }], `Add ${clip.type}`);
  if (res) useStudio.setState({ selection: [clip.id!] });
};

import { toast } from 'sonner';
import type { Clip, Project, Track } from '../../shared/schema';
import { clipEnd, projectDuration } from '../../shared/timeline';
import { uid } from '../../shared/ids';
import { useStudio } from './store';
import { player } from './player';

/** Editing commands shared by keyboard shortcuts, toolbars and menus. */

export const splitAtPlayhead = () => {
  const { project, selection, time, edit } = useStudio.getState();
  if (!project) return;
  const inside = (c: Clip) => time > c.start + 0.02 && time < clipEnd(c) - 0.02;
  let targets = project.tracks.flatMap((t) => (t.locked ? [] : t.clips.filter((c) => selection.includes(c.id) && inside(c))));
  if (targets.length === 0) targets = project.tracks.filter((t) => t.kind === 'video' && !t.locked).flatMap((t) => t.clips.filter(inside));
  if (targets.length === 0) {
    toast('Put the playhead over a clip to split it');
    return;
  }
  void edit(
    targets.map((c) => ({ op: 'splitClip', clipId: c.id, at: time })),
    'Split clip',
  );
};

export const deleteSelection = (ripple = false) => {
  const { selection, edit } = useStudio.getState();
  if (selection.length === 0) return;
  void edit([{ op: 'removeClips', clipIds: selection, ripple }], ripple ? 'Ripple delete' : selection.length > 1 ? `Delete ${selection.length} clips` : 'Delete clip');
  useStudio.setState({ selection: [] });
};

export const duplicateSelection = () => {
  const { project, selection, edit } = useStudio.getState();
  if (!project || selection.length === 0) return;
  const ops = project.tracks.flatMap((t) =>
    t.clips
      .filter((c) => selection.includes(c.id))
      .map((c) => ({ op: 'addClip' as const, trackId: t.id, onConflict: 'new-track' as const, clip: { ...structuredClone(c), id: uid('clip'), start: clipEnd(c) } })),
  );
  void edit(ops, ops.length > 1 ? 'Duplicate clips' : 'Duplicate clip').then((r) => r && useStudio.setState({ selection: ops.map((o) => o.clip.id) }));
};

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

let clipboard: { items: { clip: Clip; trackId: string }[]; origin: number } | null = null;

const selectedRefs = () => {
  const { project, selection } = useStudio.getState();
  if (!project) return [];
  return project.tracks.flatMap((t) => t.clips.filter((c) => selection.includes(c.id)).map((clip) => ({ clip, track: t })));
};

export const copySelection = (cut = false) => {
  const refs = selectedRefs();
  if (refs.length === 0) return;
  clipboard = { items: refs.map((r) => ({ clip: structuredClone(r.clip), trackId: r.track.id })), origin: Math.min(...refs.map((r) => r.clip.start)) };
  if (cut) deleteSelection(false);
  toast(`${cut ? 'Cut' : 'Copied'} ${refs.length} clip${refs.length === 1 ? '' : 's'}`, { duration: 1200 });
};

/** Paste at the playhead, keeping the clips' relative timing and tracks. */
export const pasteAtPlayhead = () => {
  const { project, time, edit } = useStudio.getState();
  if (!project || !clipboard) return;
  const ops = clipboard.items.map(({ clip, trackId }) => ({
    op: 'addClip' as const,
    trackId: project.tracks.some((t) => t.id === trackId) ? trackId : undefined,
    onConflict: 'new-track' as const,
    clip: { ...structuredClone(clip), id: uid('clip'), start: Math.round((time + clip.start - clipboard!.origin) * 1000) / 1000 },
  }));
  void edit(ops, ops.length > 1 ? `Paste ${ops.length} clips` : 'Paste clip').then((r) => r && useStudio.setState({ selection: ops.map((o) => o.clip.id) }));
};

export const selectAll = () => {
  const { project } = useStudio.getState();
  if (project) useStudio.setState({ selection: project.tracks.flatMap((t) => (t.locked ? [] : t.clips.map((c) => c.id))) });
};

/** Select every clip that starts at or after the playhead (to push the rest of the edit). */
export const selectForward = () => {
  const { project, time } = useStudio.getState();
  if (project) useStudio.setState({ selection: project.tracks.flatMap((t) => (t.locked ? [] : t.clips.filter((c) => c.start >= time - 1e-3).map((c) => c.id))) });
};

// ---------------------------------------------------------------------------
// Precise timing
// ---------------------------------------------------------------------------

/** Move the selected clips by whole frames. Repeated presses merge into one undo step. */
export const nudgeSelection = (frames: number) => {
  const st = useStudio.getState();
  const fps = st.project?.canvas.fps ?? 30;
  const refs = selectedRefs().filter((r) => !r.track.locked);
  if (refs.length === 0) return;
  const delta = frames / fps;
  if (refs.some((r) => r.clip.start + delta < -1e-6)) return;
  const ordered = [...refs].sort((a, b) => (delta > 0 ? b.clip.start - a.clip.start : a.clip.start - b.clip.start));
  for (const r of ordered) st.editSoon(`nudge:${r.clip.id}`, { op: 'moveClip', clipId: r.clip.id, start: Math.round((r.clip.start + delta) * 1000) / 1000 }, 'Nudge clips');
};

const isMusicTrack = (t: Track) => t.kind === 'audio' && t.clips.length > 0 && t.clips.every((c) => c.type === 'audio' && c.role === 'music');

/** Tracks that move together on ripple edits: everything unlocked except music beds (they keep playing). */
export const syncTrackIds = (p: Project) => p.tracks.filter((t) => !t.locked && !isMusicTrack(t)).map((t) => t.id);

const clipUnderPlayhead = (): { clip: Clip; track: Track } | null => {
  const { project, time, selection } = useStudio.getState();
  if (!project) return null;
  const inside = (c: Clip) => time > c.start + 1e-3 && time < clipEnd(c) - 1e-3;
  for (const t of project.tracks) for (const c of t.clips) if (selection.includes(c.id) && inside(c) && !t.locked) return { clip: c, track: t };
  for (const t of project.tracks) if (t.kind === 'video' && !t.locked) for (const c of t.clips) if (inside(c)) return { clip: c, track: t };
  return null;
};

/** Q / W: cut from the clip's start (or to its end) at the playhead and close the gap, keeping other tracks in sync. */
export const rippleTrim = (side: 'start' | 'end') => {
  const { project, time, edit } = useStudio.getState();
  const ref = clipUnderPlayhead();
  if (!project || !ref) {
    toast('Put the playhead inside a clip to ripple-trim it');
    return;
  }
  const from = side === 'start' ? ref.clip.start : time;
  const to = side === 'start' ? time : clipEnd(ref.clip);
  void edit([{ op: 'rippleDelete', from, to, trackIds: syncTrackIds(project) }], side === 'start' ? 'Ripple trim start' : 'Ripple trim end').then((r) => {
    if (r && side === 'start') player.seek(from);
  });
};

/** All edit points (clip edges, markers, chapters) for ↑/↓ navigation. */
export const jumpToEdit = (dir: 1 | -1) => {
  const { project, time } = useStudio.getState();
  if (!project) return;
  const pts = new Set<number>([0]);
  for (const t of project.tracks) for (const c of t.clips) if (!(c.type === 'captions' && c.mode === 'auto')) pts.add(Math.round(c.start * 1000) / 1000).add(Math.round(clipEnd(c) * 1000) / 1000);
  for (const m of project.markers) pts.add(m.time);
  for (const ch of project.youtube.chapters) pts.add(ch.time);
  const sorted = [...pts].sort((a, b) => a - b);
  const eps = 0.5 / (project.canvas.fps || 30);
  const next = dir > 0 ? sorted.find((p) => p > time + eps) : [...sorted].reverse().find((p) => p < time - eps);
  if (next !== undefined) player.seek(next);
};

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

export const addMarkerAtPlayhead = () => {
  const { time, edit, project } = useStudio.getState();
  if (!project) return;
  if (project.markers.some((m) => Math.abs(m.time - time) < 0.05)) return;
  void edit([{ op: 'addMarker', time }], 'Add marker');
};

// ---------------------------------------------------------------------------
// In / out range
// ---------------------------------------------------------------------------

export const markIn = () => {
  const { time, range, project } = useStudio.getState();
  if (!project) return;
  const end = range && range[1] > time + 0.05 ? range[1] : Math.max(time + 1, projectDuration(project));
  useStudio.setState({ range: [time, end] });
};

export const markOut = () => {
  const { time, range } = useStudio.getState();
  const start = range && range[0] < time - 0.05 ? range[0] : 0;
  if (time - start < 0.05) return;
  useStudio.setState({ range: [start, time] });
};

export const clearRangeMarks = () => useStudio.setState({ range: null, loopRange: false });

/** Delete the in/out range and close the gap on all synced tracks. */
export const rippleDeleteRange = () => {
  const { range, project, edit } = useStudio.getState();
  if (!range || !project) return;
  void edit([{ op: 'rippleDelete', from: range[0], to: range[1], trackIds: syncTrackIds(project) }], 'Delete range').then((r) => {
    if (!r) return;
    clearRangeMarks();
    player.seek(range[0]);
  });
};

/** Clear everything inside the in/out range but leave the gap. */
export const liftRangeMarks = () => {
  const { range, edit } = useStudio.getState();
  if (!range) return;
  void edit([{ op: 'liftRange', from: range[0], to: range[1] }], 'Lift range');
};

// ---------------------------------------------------------------------------
// J / K / L shuttle
// ---------------------------------------------------------------------------

export const shuttle = (key: 'j' | 'k' | 'l') => {
  const { playbackRate } = useStudio.getState();
  if (key === 'k') {
    player.pause();
    useStudio.setState({ playbackRate: 1 });
    return;
  }
  const dir = key === 'l' ? 1 : -1;
  const playing = player.playing;
  const next = playing && Math.sign(playbackRate) === dir ? Math.max(-8, Math.min(8, playbackRate * 2)) : dir;
  useStudio.setState({ playbackRate: next });
  if (!playing) player.play();
  if (Math.abs(next) !== 1) toast(`${next > 0 ? '▶' : '◀'} ${Math.abs(next)}×`, { duration: 700, id: 'shuttle' });
};

// ---------------------------------------------------------------------------
// Text-based editing
// ---------------------------------------------------------------------------

/** Cut several timeline ranges (closing the gaps) as one undo step. Later ranges go first so earlier times stay valid. */
export const cutRanges = async (ranges: [number, number][], label: string): Promise<boolean> => {
  const { project, edit } = useStudio.getState();
  if (!project || ranges.length === 0) return false;
  const trackIds = syncTrackIds(project);
  const ops = [...ranges]
    .filter(([a, b]) => b - a > 0.01)
    .sort((a, b) => b[0] - a[0])
    .map(([from, to]) => ({ op: 'rippleDelete' as const, from, to, trackIds }));
  if (ops.length === 0) return false;
  return Boolean(await edit(ops, label));
};

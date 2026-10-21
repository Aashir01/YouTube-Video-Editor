import { toast } from 'sonner';
import type { Clip } from '../../shared/schema';
import { clipEnd } from '../../shared/timeline';
import { uid } from '../../shared/ids';
import { useStudio } from './store';

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

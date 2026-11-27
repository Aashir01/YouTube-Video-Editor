import { describe, expect, it } from 'vitest';
import { applyOps } from './ops';
import { createProject, placeClip } from './timeline';
import type { Project } from './schema';

const withScenes = (): Project => {
  const p = createProject({ name: 'ops' });
  placeClip(p, { id: 'a', type: 'scene', template: 'title-card', start: 0, duration: 4, props: { title: 'A' } }, { trackId: 'Main' });
  placeClip(p, { id: 'b', type: 'scene', template: 'title-card', start: 4, duration: 4, props: { title: 'B' } }, { trackId: 'Main' });
  placeClip(p, { id: 't', type: 'text', text: 'hi', start: 2, duration: 4 }, { trackId: 'Graphics' });
  return p;
};

describe('marker ops', () => {
  it('adds, renames, moves and removes markers, keeping them sorted', () => {
    const p = createProject({ name: 'm' });
    const [id1] = applyOps(p, [{ op: 'addMarker', time: 5 }]) as string[];
    applyOps(p, [{ op: 'addMarker', time: 1.23456, label: 'Hook' }]);
    expect(p.markers.map((m) => m.time)).toEqual([1.235, 5]);
    expect(p.markers[0]!.label).toBe('Hook');
    applyOps(p, [{ op: 'updateMarker', markerId: id1!, patch: { time: 0.5, label: 'Intro' } }]);
    expect(p.markers.map((m) => m.label)).toEqual(['Intro', 'Hook']);
    applyOps(p, [{ op: 'removeMarker', markerId: id1! }]);
    expect(p.markers).toHaveLength(1);
  });

  it('rejects updates to unknown markers', () => {
    const p = createProject({ name: 'm' });
    expect(() => applyOps(p, [{ op: 'updateMarker', markerId: 'nope', patch: { label: 'x' } }])).toThrow(/not found/);
  });
});

describe('liftRange', () => {
  it('clears a range on every track but keeps the gap', () => {
    const p = withScenes();
    applyOps(p, [{ op: 'liftRange', from: 3, to: 5 }]);
    const main = p.tracks.find((t) => t.name === 'Main')!;
    expect(main.clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 3],
      [5, 3],
    ]);
    const gfx = p.tracks.find((t) => t.name === 'Graphics')!;
    expect(gfx.clips.map((c) => [c.start, c.start + c.duration])).toEqual([
      [2, 3],
      [5, 6],
    ]);
  });

  it('only touches the given tracks and skips locked ones', () => {
    const p = withScenes();
    const main = p.tracks.find((t) => t.name === 'Main')!;
    const gfx = p.tracks.find((t) => t.name === 'Graphics')!;
    gfx.locked = true;
    applyOps(p, [{ op: 'liftRange', from: 3, to: 5 }]);
    expect(gfx.clips).toHaveLength(1);
    expect(gfx.clips[0]!.duration).toBe(4);
    expect(main.clips).toHaveLength(2);
    applyOps(p, [{ op: 'liftRange', from: 0, to: 1, trackIds: [main.id] }]);
    expect(main.clips[0]!.start).toBe(1);
  });
});

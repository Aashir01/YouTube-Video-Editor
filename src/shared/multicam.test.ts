import { describe, expect, it } from 'vitest';
import { applyOps } from './ops';
import { matchMics, planCameraCuts, type CameraShot } from './multicam';
import { createProject } from './timeline';
import type { Project, VideoClip } from './schema';

const bins = (seconds: number, bin = 0.5) => Math.round(seconds / bin);
/** activity that is 1 while `on(t)` and a little noise otherwise */
const series = (seconds: number, on: (t: number) => boolean, bin = 0.5) => Array.from({ length: bins(seconds, bin) }, (_, b) => (on(b * bin) ? 1 + ((b * 7) % 3) * 0.05 : ((b * 5) % 4) * 0.02));
const angles = (shots: CameraShot[]) => shots.map((s) => `${s.angle}@${s.start}`);

describe('multicam cutting', () => {
  it('cuts to whoever talks, back at the moment they started, without flicker', () => {
    // A talks 0-10 s, B 10-20 s (with a 0.5 s blip from A at 15 s), A again 20-30 s
    const a = series(30, (t) => t < 10 || (t >= 15 && t < 15.5) || t >= 20);
    const b = series(30, (t) => t >= 10 && t < 20 && !(t >= 15 && t < 15.5));
    const shots = planCameraCuts({ activity: [a, b], personAngle: [1, 2], bin: 0.5, bins: bins(30), available: () => true, maxShot: 0 });
    expect(angles(shots)).toEqual(['1@0', '2@10', '1@20']);
    expect(shots.at(-1)!.end).toBe(30);
  });

  it('shows the wide shot when people talk over each other, and snaps cuts to sentences', () => {
    const a = series(20, (t) => t < 8 || (t >= 12 && t < 20));
    const b = series(20, (t) => t >= 8 && t < 16);
    const shots = planCameraCuts({ activity: [a, b], personAngle: [1, 2], wide: 0, bin: 0.5, bins: bins(20), available: () => true, anchors: [7.8, 12.3], maxShot: 0 });
    expect(angles(shots)).toEqual(['1@0', '2@7.8', '0@12.3', '1@16']);
  });

  it('looks at the wide shot now and then in a long monologue', () => {
    const a = series(60, () => true);
    const b = series(60, () => false);
    const shots = planCameraCuts({ activity: [a, b], personAngle: [1, 2], wide: 0, bin: 0.5, bins: bins(60), available: () => true, maxShot: 20, cutaway: 3 });
    expect(shots.map((s) => s.angle)).toEqual([1, 0, 1, 0, 1, 0, 1]);
    expect(shots[1]!.end - shots[1]!.start).toBeCloseTo(3);
    for (const s of shots) expect(s.end - s.start).toBeLessThanOrEqual(20);
  });

  it('never shows a camera that was not recording', () => {
    const a = series(20, () => true);
    const b = series(20, () => false);
    // camera 1 only rolled from 5 s to 15 s
    const shots = planCameraCuts({ activity: [a, b], personAngle: [1, 2], wide: 0, bin: 0.5, bins: bins(20), available: (angle, bin) => angle !== 1 || (bin >= 10 && bin < 30), maxShot: 0 });
    expect(angles(shots)).toEqual(['0@0', '1@5', '0@15']);
  });

  it('ignores mouths that move while nobody speaks', () => {
    const a = series(20, (t) => t < 10);
    const b = series(20, (t) => t >= 10); // B "talks" only during a silence
    const speech = Array.from({ length: bins(20) }, (_, i) => i * 0.5 < 10);
    expect(angles(planCameraCuts({ activity: [a, b], personAngle: [1, 2], bin: 0.5, bins: bins(20), speech, available: () => true, maxShot: 0 }))).toEqual(['1@0']);
  });

  it('pairs each microphone with the close-up that moves with it', () => {
    const talkA = series(30, (t) => Math.floor(t / 5) % 2 === 0);
    const talkB = series(30, (t) => Math.floor(t / 5) % 2 === 1);
    expect(matchMics([talkB, talkA], [talkA, talkB])).toEqual([1, 0]);
    expect(matchMics([talkA, talkB, talkA], [talkA, talkB])).toEqual([0, 1, -1]);
  });
});

describe('switching cameras', () => {
  const project = (): Project => {
    const p = createProject({ name: 'Podcast' });
    const asset = (id: string, duration: number) => ({ id, kind: 'video', name: `${id}.mp4`, file: `${id}.mp4`, meta: { duration, width: 1920, height: 1080, hasAudio: true, hasVideo: true } });
    p.assets.push(asset('wide', 60) as never, asset('left', 50) as never);
    // left started 4 s after wide; the cut shows wide's 10-20 s
    applyOps(p, [
      { op: 'setMulticam', group: { id: 'mc', name: 'Podcast', angles: [{ assetId: 'wide', offset: 0 }, { assetId: 'left', offset: 4 }] } },
      { op: 'addClip', trackId: p.tracks[0]!.id, clip: { id: 'cut', type: 'video', assetId: 'wide', start: 0, duration: 10, trimStart: 10, multicam: 'mc' } },
    ]);
    return p;
  };
  const cuts = (p: Project) => p.tracks[0]!.clips as VideoClip[];

  it('keeps the moment when the camera changes', () => {
    const p = project();
    applyOps(p, [{ op: 'switchAngle', clipId: 'cut', angle: 1 }]);
    expect(cuts(p)[0]).toMatchObject({ assetId: 'left', trimStart: 6, start: 0, duration: 10 });
    applyOps(p, [{ op: 'switchAngle', clipId: 'cut', angle: 0 }]);
    expect(cuts(p)[0]).toMatchObject({ assetId: 'wide', trimStart: 10 });
  });

  it('cuts at the playhead and switches what follows (live switching)', () => {
    const p = project();
    applyOps(p, [{ op: 'switchAngle', clipId: 'cut', angle: 1, at: 4 }]);
    expect(cuts(p).map((c) => [c.assetId, c.start, c.duration, c.trimStart])).toEqual([
      ['wide', 0, 4, 10],
      ['left', 4, 6, 10],
    ]);
  });

  it('refuses a camera that was not recording, and plain clips', () => {
    const p = project();
    applyOps(p, [{ op: 'updateClip', clipId: 'cut', patch: { trimStart: 1 } }]);
    expect(() => applyOps(p, [{ op: 'switchAngle', clipId: 'cut', angle: 1 }])).toThrow(/not recording/);
    expect(() => applyOps(p, [{ op: 'switchAngle', clipId: 'cut', angle: 5 }])).toThrow(/no camera 6/);
    applyOps(p, [{ op: 'updateClip', clipId: 'cut', patch: { multicam: null } }]);
    expect(() => applyOps(p, [{ op: 'switchAngle', clipId: 'cut', angle: 1 }])).toThrow(/Only multicam/);
  });

  it('a removed file leaves its group', () => {
    const p = project();
    applyOps(p, [{ op: 'removeAsset', assetId: 'left' }]);
    expect(p.multicam[0]!.angles.map((a) => a.assetId)).toEqual(['wide']);
    applyOps(p, [{ op: 'removeAsset', assetId: 'wide' }]);
    expect(p.multicam).toEqual([]);
  });
});

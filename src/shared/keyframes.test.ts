import { describe, expect, it } from 'vitest';
import { applyOps } from './ops';
import { createProject, placeClip, requireClip } from './timeline';
import { AssetSchema, type Clip, type Project, type TextClip, type VideoClip } from './schema';
import { animateClip, channelAt, keyframeTimes, valueAt } from './keyframes';

const withVideo = (): Project => {
  const p = createProject({ name: 'kf' });
  p.assets.push(AssetSchema.parse({ id: 'v1', name: 'v.mp4', kind: 'video', file: 'v.mp4', createdAt: '', meta: { duration: 60, width: 1920, height: 1080 } }));
  placeClip(p, { id: 'vid', type: 'video', assetId: 'v1', start: 2, duration: 10, trimStart: 5 }, { trackId: 'Main' });
  placeClip(p, { id: 'txt', type: 'text', text: 'Hello', start: 1, duration: 6 }, { trackId: 'Graphics' });
  return p;
};
const clip = (p: Project, id: string): Clip => requireClip(p, id).clip;
/** Value of a channel at an absolute timeline time, on whichever piece covers it. */
const at = (p: Project, ids: string[], ch: Parameters<typeof channelAt>[1], time: number) => {
  const c = ids.map((id) => clip(p, id)).find((x) => time >= x.start && time <= x.start + x.duration)!;
  return channelAt(c, ch, time - c.start);
};

describe('interpolation', () => {
  const kf = [
    { t: 0, v: 0, ease: 'linear' as const },
    { t: 2, v: 10 },
    { t: 4, v: 0, ease: 'hold' as const },
    { t: 6, v: 5 },
  ];
  it('interpolates with each segment’s easing and holds outside the keys', () => {
    expect(valueAt(kf, -1)).toBe(0);
    expect(valueAt(kf, 1)).toBe(5); // linear
    expect(valueAt(kf, 3)).toBeCloseTo(5); // ease-in-out is symmetric around the middle
    expect(valueAt(kf, 2.5)).toBeGreaterThan(8); // ...and slow near the keys
    expect(valueAt(kf, 5)).toBe(0); // hold
    expect(valueAt(kf, 6)).toBe(5);
    expect(valueAt(kf, 99)).toBe(5);
  });

  it('writes animated channels over the static fields', () => {
    const p = withVideo();
    applyOps(p, [
      { op: 'setKeyframe', clipId: 'vid', t: 0, values: { opacity: 0, 'box.x': 0 }, ease: 'linear' },
      { op: 'setKeyframe', clipId: 'vid', t: 1, values: { opacity: 1, 'box.x': 0.5 } },
    ]);
    const c = clip(p, 'vid') as VideoClip;
    expect(c.box).toEqual({ x: 0, y: 0, w: 1, h: 1 }); // a box was created to animate position
    const mid = animateClip(c, 0.5);
    expect(mid.opacity).toBeCloseTo(0.5);
    expect(mid.box!.x).toBeCloseTo(0.25);
    expect(c.opacity).toBe(1); // the stored clip is untouched
  });
});

describe('keyframe ops', () => {
  it('sets, replaces, retimes and eases keyframes', () => {
    const p = withVideo();
    applyOps(p, [
      { op: 'setKeyframe', clipId: 'txt', t: 0, values: { y: 0.6 } },
      { op: 'setKeyframe', clipId: 'txt', t: 2, values: { y: 0.4 } },
      { op: 'setKeyframe', clipId: 'txt', t: 2.001, values: { y: 0.45 } }, // same moment: replaced
    ]);
    let t = clip(p, 'txt') as TextClip;
    expect(t.keyframes!.y).toEqual([
      { t: 0, v: 0.6 },
      { t: 2, v: 0.45 },
    ]);
    applyOps(p, [
      { op: 'moveKeyframes', clipId: 'txt', from: 2, to: 3 },
      { op: 'setKeyframeEase', clipId: 'txt', t: 0, ease: 'linear' },
    ]);
    t = clip(p, 'txt') as TextClip;
    expect(t.keyframes!.y).toEqual([
      { t: 0, v: 0.6, ease: 'linear' },
      { t: 3, v: 0.45 },
    ]);
    expect(keyframeTimes(t)).toEqual([0, 3]);
  });

  it('keeps the value when the last keyframe goes, and when animation is removed', () => {
    const p = withVideo();
    applyOps(p, [
      { op: 'setKeyframe', clipId: 'txt', t: 0, values: { opacity: 0.2, rotation: 10 } },
      { op: 'setKeyframe', clipId: 'txt', t: 2, values: { rotation: 30 } },
      { op: 'removeKeyframe', clipId: 'txt', t: 0, channels: ['opacity'] },
    ]);
    let t = clip(p, 'txt') as TextClip;
    expect(t.keyframes!.opacity).toBeUndefined();
    expect(t.opacity).toBe(0.2);
    applyOps(p, [{ op: 'clearKeyframes', clipId: 'txt', keepAt: 1 }]);
    t = clip(p, 'txt') as TextClip;
    expect(t.keyframes).toBeUndefined();
    expect(t.rotation).toBeCloseTo(20);
    // removing again is harmless
    expect(() => applyOps(p, [{ op: 'removeKeyframe', clipId: 'txt', t: 0 }])).not.toThrow();
  });

  it('rejects channels a clip cannot animate, with the list it can', () => {
    const p = withVideo();
    expect(() => applyOps(p, [{ op: 'setKeyframe', clipId: 'txt', t: 0, values: { volume: 1 } }])).toThrow(/Animatable: x, y/);
    expect(() => applyOps(p, [{ op: 'updateClip', clipId: 'vid', patch: { keyframes: { blur: [{ t: 0, v: 1 }] } } }])).toThrow(/cannot be animated/);
  });

  it('sorts, de-duplicates and clamps keyframes written as a patch', () => {
    const p = withVideo();
    applyOps(p, [{ op: 'updateClip', clipId: 'vid', patch: { keyframes: { opacity: [{ t: 2, v: 3 }, { t: 0, v: 0 }, { t: 2.002, v: 0.5 }] } } }]);
    expect((clip(p, 'vid') as VideoClip).keyframes!.opacity).toEqual([
      { t: 0, v: 0 },
      { t: 2.002, v: 0.5 },
    ]);
  });
});

describe('timeline edits keep the motion in place', () => {
  it('a split leaves both pieces moving exactly as before', () => {
    const p = withVideo();
    applyOps(p, [
      { op: 'setKeyframe', clipId: 'vid', t: 0, values: { scale: 1 } },
      { op: 'setKeyframe', clipId: 'vid', t: 8, values: { scale: 2 } },
    ]);
    const before = [3, 5.5, 6, 9].map((time) => at(p, ['vid'], 'scale', time));
    const [left, right] = applyOps(p, [{ op: 'splitClip', clipId: 'vid', at: 5.5 }])[0] as [string, string];
    const after = [3, 5.5, 6, 9].map((time) => at(p, [left, right], 'scale', time));
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i]!, 5));
  });

  it('trimming footage keeps keyframes on the same frames; graphics keep them relative to the clip', () => {
    const p = withVideo();
    applyOps(p, [
      { op: 'setKeyframe', clipId: 'vid', t: 4, values: { 'focus.x': 0.2 } },
      { op: 'setKeyframe', clipId: 'txt', t: 1, values: { x: 0.3 } },
      { op: 'trimClip', clipId: 'vid', start: 3 },
      { op: 'trimClip', clipId: 'txt', start: 2 },
    ]);
    expect((clip(p, 'vid') as VideoClip).keyframes!['focus.x']![0]!.t).toBe(3); // still at timeline 6s
    expect((clip(p, 'txt') as TextClip).keyframes!.x![0]!.t).toBe(1);
  });

  it('a speed change stretches keyframe times with the footage', () => {
    const p = withVideo();
    applyOps(p, [{ op: 'setKeyframe', clipId: 'vid', t: 4, values: { opacity: 0.5 } }]);
    applyOps(p, [{ op: 'updateClip', clipId: 'vid', patch: { speed: 2, duration: 5 } }]);
    expect((clip(p, 'vid') as VideoClip).keyframes!.opacity![0]!.t).toBe(2);
  });
});

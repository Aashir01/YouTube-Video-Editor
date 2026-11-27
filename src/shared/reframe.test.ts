import { describe, expect, it } from 'vitest';
import { coverGeometry, focusFor, planReframe, type FaceSample } from './reframe';
import { valueAt } from './keyframes';

// 16:9 footage in a 9:16 Short: the picture is ~3.16 frame-widths wide
const g = coverGeometry(1920, 1080, 1080, 1920);
const face = (cx: number, cy = 0.4, size = 0.12, score = 0.9) => ({ cx, cy, w: size, h: size * 1.3, score });
const samples = (n: number, step: number, at: (i: number) => FaceSample['faces']): FaceSample[] => Array.from({ length: n }, (_, i) => ({ t: i * step, faces: at(i) }));
/** Where a media x lands in the frame for a given focus (cover fit, no zoom). */
const onScreen = (cx: number, fx: number) => cx * g.kx - fx * (g.kx - 1);

describe('crop geometry', () => {
  it('solves the focus that puts the face where we want it', () => {
    expect(g.kx).toBeCloseTo(3.16, 2);
    expect(g.ky).toBe(1);
    const fx = focusFor(0.25, g.kx, 1, 0.5)!;
    expect(onScreen(0.25, fx)).toBeCloseTo(0.5, 6);
    expect(focusFor(0.5, 1, 1, 0.5)).toBeNull(); // nothing to pan when the media fits
    expect(focusFor(0.02, g.kx, 1, 0.5)).toBe(0); // clamped: the crop cannot leave the picture
  });
});

describe('planReframe', () => {
  it('locks a steady face with a static focus', () => {
    const plan = planReframe(samples(20, 0.5, (i) => [face(0.3 + (i % 2 ? 0.006 : -0.006))]), g, 10)!;
    expect(plan.keyframes).toBeUndefined();
    expect(onScreen(0.3, plan.focus!.x)).toBeCloseTo(0.5, 2);
    expect(plan.found).toBe(20);
  });

  it('follows a moving subject with a short eased path', () => {
    const plan = planReframe(samples(21, 0.5, (i) => [face(0.2 + (0.6 * i) / 20)]), g, 10)!;
    const kx = plan.keyframes!['focus.x']!;
    expect(kx.length).toBeLessThanOrEqual(4);
    expect(kx[0]!.t).toBe(0);
    expect(kx.at(-1)!.t).toBe(10);
    // the face stays near the center the whole way
    for (const t of [0, 2.5, 5, 7.5, 10]) {
      const cx = 0.2 + (0.6 * t) / 10;
      expect(Math.abs(onScreen(cx, valueAt(kx, t)) - 0.5)).toBeLessThan(0.12);
    }
  });

  it('cuts with the footage instead of panning across a cut', () => {
    const plan = planReframe(samples(20, 0.5, (i) => [face(i < 10 ? 0.2 : 0.8)]), g, 10, { cuts: [4.8] })!;
    const kx = plan.keyframes!['focus.x']!;
    const hold = kx.find((k) => k.ease === 'hold')!;
    expect(hold).toBeDefined();
    const after = kx[kx.indexOf(hold) + 1]!;
    expect(after.t).toBe(4.8);
    expect(onScreen(0.2, valueAt(kx, 4.7))).toBeCloseTo(0.5, 1);
    expect(onScreen(0.8, valueAt(kx, 4.9))).toBeCloseTo(0.5, 1);
  });

  it('keeps the crop when there are hardly any faces', () => {
    const plan = planReframe(samples(20, 0.5, (i) => (i === 3 ? [face(0.7)] : [])), g, 10)!;
    expect(plan.found).toBe(1);
    expect(plan.focus).toBeUndefined();
    expect(plan.keyframes).toBeUndefined();
  });

  it('stays with the current speaker instead of flipping between two people', () => {
    // A (left) starts bigger; B (right) becomes a little bigger halfway but not by much
    const plan = planReframe(samples(20, 0.5, (i) => [face(0.3, 0.4, i < 10 ? 0.12 : 0.11), face(0.75, 0.4, i < 10 ? 0.1 : 0.12)]), g, 10)!;
    expect(plan.people).toBe(2);
    expect(plan.keyframes).toBeUndefined();
    expect(onScreen(0.3, plan.focus!.x)).toBeCloseTo(0.5, 2);
  });

  it('pans both ways inside zoomed same-aspect footage', () => {
    const zoomed = coverGeometry(1920, 1080, 1920, 1080, 1.6);
    const plan = planReframe(samples(10, 0.5, () => [face(0.7, 0.3)]), zoomed, 5)!;
    expect(plan.focus!.x).toBeGreaterThan(0.5);
    expect(plan.focus!.y).toBeLessThan(0.5);
  });
});

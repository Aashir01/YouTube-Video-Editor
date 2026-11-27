import { describe, expect, it } from 'vitest';
import { hex, maskToAlpha, screenColor, steadyMask, toModelInput, toRgba } from './matte';

/** a BGR frame filled by fn(x, y) -> [r, g, b] */
const frame = (w: number, h: number, fn: (x: number, y: number) => [number, number, number]) => {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y);
    out.set([b, g, r], (y * w + x) * 3);
  }
  return out;
};

describe('removing a background', () => {
  it('feeds the model RGB in 0..1 at its own size', () => {
    const f = frame(8, 4, (x) => (x < 4 ? [255, 0, 0] : [0, 0, 255]));
    const input = toModelInput(f, 8, 4, 2, 1);
    expect(Array.from(input).map((v) => Math.round(v * 100) / 100)).toEqual([1, 0, 0, 0, 0, 1]);
  });

  it('turns the low-resolution mask into a soft, solid alpha at full size', () => {
    // left half person, right half background
    const mask = Float32Array.from([1, 1, 0, 0, 1, 1, 0, 0]);
    const alpha = maskToAlpha(mask, 4, 2, 16, 8);
    expect(alpha[2 * 16 + 1]).toBe(255); // well inside the person
    expect(alpha[2 * 16 + 14]).toBe(0); // well inside the background
    const row = Array.from(alpha.subarray(3 * 16, 4 * 16));
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1]!); // a smooth edge, no ringing
    expect(row.some((v) => v > 0 && v < 255)).toBe(true);
  });

  it('steadies the mask from frame to frame', () => {
    const now = Float32Array.from([1, 0]);
    steadyMask(now, Float32Array.from([0, 1]), 0.25);
    expect(Array.from(now)).toEqual([0.75, 0.25]);
  });

  it('packs RGBA and finds the color of a green screen', () => {
    const f = frame(64, 36, (x, y) => (x > 20 && x < 44 && y > 8 ? [200, 120, 90] : [10, 177, 64]));
    expect(hex(screenColor(f, 64, 36))).toBe('#0ab140');
    const rgba = toRgba(frame(1, 1, () => [1, 2, 3]), Uint8Array.from([200]));
    expect(Array.from(rgba)).toEqual([1, 2, 3, 200]);
  });
});

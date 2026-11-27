import { describe, expect, it } from 'vitest';
import { align, binned, fft, logEnergy, onsets } from './dsp';

/** deterministic pseudo-random numbers */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

/** a "recording": noise bursts at random moments, as loudness onsets at `rate` per second */
const scene = (seconds: number, rate: number, seed = 1) => {
  const r = rng(seed);
  const out = new Float64Array(Math.round(seconds * rate));
  let i = 0;
  while (i < out.length) {
    i += Math.floor(r() * rate * 0.8) + 3;
    const len = Math.floor(r() * 15) + 3;
    const level = 0.3 + r();
    for (let k = 0; k < len && i + k < out.length; k++) out[i + k] = level;
    i += len;
  }
  return out;
};

describe('signal processing', () => {
  it('the FFT matches a plain DFT and inverts', () => {
    const r = rng(3);
    const n = 16;
    const x = Array.from({ length: n }, () => r() - 0.5);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        sr += x[t]! * Math.cos((-2 * Math.PI * k * t) / n);
        si += x[t]! * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(sr, 9);
      expect(im[k]).toBeCloseTo(si, 9);
    }
    fft(re, im, true);
    x.forEach((v, i) => expect(re[i]).toBeCloseTo(v, 9));
  });

  it('loudness onsets ignore the overall level (different microphones)', () => {
    const r = rng(5);
    const sig = Float32Array.from({ length: 8000 }, (_, i) => (r() - 0.5) * (i % 2000 < 600 ? 1 : 0.05));
    const quiet = sig.map((v) => v * 0.2);
    const a = onsets(logEnergy(sig, 80));
    const b = onsets(logEnergy(quiet, 80));
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 3));
  });

  it('lines up two recordings of the same scene, however they overlap', () => {
    const rate = 100;
    const master = scene(120, rate, 7);
    // camera B started 7.33 s after A, recorded 60 s, quieter and with its own noise
    const r = rng(11);
    const b = Float64Array.from(master.subarray(733, 733 + 60 * rate), (v) => v * 0.4 + r() * 0.08);
    const later = align(master, b, rate)!;
    expect(later.offset).toBeCloseTo(7.33, 2);
    expect(later.confidence).toBeGreaterThan(8);
    // a microphone that started 2.5 s before A: its time 0 is A's -2.5 s
    const mic = new Float64Array(250 + 50 * rate);
    mic.set(master.subarray(0, 50 * rate), 250);
    expect(align(master, mic, rate)!.offset).toBeCloseTo(-2.5, 2);
    // and the sub-frame position: half a frame
    const half = Float64Array.from({ length: master.length - 1 }, (_, i) => (master[i]! + master[i + 1]!) / 2);
    expect(align(master, half.subarray(300), rate)!.offset).toBeCloseTo(3.005, 2);
  });

  it('says when two recordings do not match', () => {
    const a = align(scene(60, 100, 1), scene(60, 100, 2), 100)!;
    expect(a.confidence).toBeLessThan(6);
    expect(align([1], [1, 2, 3], 100)).toBeNull();
  });

  it('averages a series into bins', () => {
    expect(Array.from(binned([1, 1, 3, 3, 5], 2, 1, 3))).toEqual([1, 3, 5]);
    expect(Number.isNaN(binned([1], 2, 1, 2)[1])).toBe(true);
  });
});

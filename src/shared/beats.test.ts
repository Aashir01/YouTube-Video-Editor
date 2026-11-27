import { describe, expect, it } from 'vitest';
import { logEnergy, onsets } from './dsp';
import { planBeatCuts, timelineBeats, trackBeats } from './beats';

const RATE = 8000;
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

/** a drum loop: a kick on every beat, a quieter hi-hat between beats, a little noise; optional silent break */
const drums = (bpm: number, seconds: number, first = 0.23, silence?: [number, number]) => {
  const r = rng(9);
  const out = new Float32Array(seconds * RATE).map(() => (r() - 0.5) * 0.004);
  const hit = (at: number, freq: number, level: number, noise = false) => {
    for (let i = 0; i < 0.15 * RATE; i++) {
      const k = Math.round(at * RATE) + i;
      if (k >= out.length) break;
      const tt = i / RATE;
      out[k]! += level * Math.exp(-tt / 0.04) * (noise ? r() - 0.5 : Math.sin(2 * Math.PI * freq * tt));
    }
  };
  const beat = 60 / bpm;
  for (let t = first; t < seconds; t += beat) {
    if (silence && t >= silence[0] && t < silence[1]) continue;
    hit(t, 70, 0.9);
    hit(t + beat / 2, 0, 0.25, true);
  }
  return out;
};
const envelope = (samples: Float32Array) => onsets(logEnergy(samples, RATE / 100));

describe('beats', () => {
  it('finds the tempo and every kick of a 120 BPM loop', () => {
    const b = trackBeats(envelope(drums(120, 20)), 100)!;
    expect(b.tempo).toBeGreaterThan(118);
    expect(b.tempo).toBeLessThan(122);
    expect(b.confidence).toBeGreaterThan(3);
    // on the kicks (not the hi-hats), within 20 ms
    const off = b.beats.map((t) => Math.abs(((t - 0.23 + 0.25) % 0.5) - 0.25));
    expect(Math.max(...off.slice(1, -1))).toBeLessThan(0.02);
    expect(b.beats.length).toBeGreaterThanOrEqual(38);
  });

  it('works at other tempos and through a quiet break', () => {
    const slow = trackBeats(envelope(drums(95, 24)), 100)!;
    expect(Math.abs(slow.tempo - 95)).toBeLessThan(2);
    const broken = trackBeats(envelope(drums(120, 24, 0.1, [10, 13])), 100)!;
    expect(broken.beats[0]!).toBeLessThan(0.7); // the beats before the break are kept
    expect(broken.beats.at(-1)!).toBeGreaterThan(23);
  });

  it('places a music clip’s beats on the timeline', () => {
    expect(timelineBeats({ start: 10, duration: 2, trimStart: 1, speed: 1, loop: false }, [0.5, 1, 1.5, 2, 2.5, 3, 3.5])).toEqual([10, 10.5, 11, 11.5, 12]);
    expect(timelineBeats({ start: 0, duration: 5, trimStart: 0, speed: 1, loop: true }, [0, 1], 2)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('re-times clips to start on beats and last whole beats', () => {
    const beats = Array.from({ length: 20 }, (_, i) => i * 0.5 + 0.2);
    const plan = planBeatCuts(
      [
        { id: 'b', start: 3.4, duration: 1.3 },
        { id: 'a', start: 0.3, duration: 2.1 },
        { id: 'c', start: 5, duration: 3, maxDuration: 1.2 }, // a video with 1.2 s left
      ],
      beats,
    );
    expect(plan).toEqual([
      { id: 'a', start: 0.2, duration: 2 },
      { id: 'b', start: 2.2, duration: 1.5 },
      { id: 'c', start: 3.7, duration: 1 },
    ]);
    expect(planBeatCuts([{ id: 'a', start: 0, duration: 5 }], beats, { every: 2 })).toEqual([{ id: 'a', start: 0.2, duration: 1 }]);
    // past the last beat the grid carries on
    expect(planBeatCuts([{ id: 'a', start: 9.5, duration: 2 }], beats).at(0)).toEqual({ id: 'a', start: 9.7, duration: 2 });
  });
});

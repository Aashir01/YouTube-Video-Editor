import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY_DIR } from '../config';
import { floatToWav } from './ffmpeg';

/**
 * Built-in, royalty-free sound library synthesized on first use (no downloads).
 * Sound effects are short one-shots; the two music beds are simple placeholders
 * for drafts — users can upload real music or generate it with ElevenLabs.
 */

const SR = 44100;

interface LibraryItem {
  id: string;
  name: string;
  kind: 'sfx' | 'music';
  description: string;
  tags: string[];
  make: () => Float32Array;
}

const seededRandom = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
};

const buffer = (sec: number) => new Float32Array(Math.round(sec * SR));

/** Simple state-variable band-pass filter with a time-varying center frequency. */
const bandpass = (input: Float32Array, freqAt: (t: number) => number, q = 1.2): Float32Array => {
  const out = new Float32Array(input.length);
  let low = 0;
  let band = 0;
  for (let i = 0; i < input.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(freqAt(i / SR), SR / 6)) / SR);
    const high = input[i]! - low - band / q;
    band += f * high;
    low += f * band;
    out[i] = band;
  }
  return out;
};

const lowpass = (input: Float32Array, cutoff: number): Float32Array => {
  const out = new Float32Array(input.length);
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = 1 / SR / (rc + 1 / SR);
  let y = 0;
  for (let i = 0; i < input.length; i++) {
    y += a * (input[i]! - y);
    out[i] = y;
  }
  return out;
};

const normalize = (b: Float32Array, peak = 0.89): Float32Array => {
  let m = 1e-9;
  for (const v of b) m = Math.max(m, Math.abs(v));
  const g = peak / m;
  for (let i = 0; i < b.length; i++) b[i]! *= g;
  return b;
};

const fadeEdges = (b: Float32Array, inSec = 0.004, outSec = 0.02): Float32Array => {
  const ni = Math.round(inSec * SR);
  const no = Math.round(outSec * SR);
  for (let i = 0; i < ni && i < b.length; i++) b[i]! *= i / ni;
  for (let i = 0; i < no && i < b.length; i++) b[b.length - 1 - i]! *= i / no;
  return b;
};

const noise = (sec: number, seed = 7) => {
  const r = seededRandom(seed);
  const b = buffer(sec);
  for (let i = 0; i < b.length; i++) b[i] = r() * 2 - 1;
  return b;
};

const addReverb = (b: Float32Array, mix = 0.25, decay = 0.45): Float32Array => {
  const delays = [0.029, 0.037, 0.041, 0.053].map((d) => Math.round(d * SR));
  const out = new Float32Array(b.length + Math.round(SR * 0.8));
  out.set(b);
  const wet = new Float32Array(out.length);
  for (const d of delays) {
    for (let i = d; i < out.length; i++) wet[i]! += ((out[i - d] ?? 0) + (wet[i - d] ?? 0) * decay) * 0.25;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * (1 - mix) + wet[i]! * mix;
  return out;
};

const tone = (freq: number, sec: number, opts: { attack?: number; decay?: number; harmonics?: number[]; start?: number; into?: Float32Array; gain?: number; detune?: number }) => {
  const b = opts.into ?? buffer(sec);
  const start = Math.round((opts.start ?? 0) * SR);
  const n = Math.round(sec * SR);
  const harmonics = opts.harmonics ?? [1];
  for (let i = 0; i < n && start + i < b.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / (opts.attack ?? 0.005)) * Math.exp(-t / (opts.decay ?? 0.5));
    let v = 0;
    harmonics.forEach((amp, h) => {
      v += amp * Math.sin(2 * Math.PI * freq * (h + 1) * t * (1 + (opts.detune ?? 0)));
    });
    b[start + i]! += v * env * (opts.gain ?? 1);
  }
  return b;
};

const note = (n: string): number => {
  const map: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const m = /^([A-G])(#|b)?(\d)$/.exec(n);
  if (!m) return 440;
  const semis = map[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semis / 12);
};

const ITEMS: LibraryItem[] = [
  {
    id: 'whoosh',
    name: 'Whoosh',
    kind: 'sfx',
    description: 'Airy swoosh for transitions and fast motion',
    tags: ['transition', 'swoosh', 'motion'],
    make: () => {
      const d = 0.7;
      const n = noise(d, 3);
      const f = bandpass(n, (t) => 300 + 3200 * Math.sin((Math.PI * t) / d) ** 2, 1.5);
      for (let i = 0; i < f.length; i++) {
        const t = i / SR;
        f[i]! *= Math.sin((Math.PI * t) / d) ** 2;
      }
      return fadeEdges(normalize(f, 0.7));
    },
  },
  {
    id: 'whoosh-fast',
    name: 'Fast whip',
    kind: 'sfx',
    description: 'Short whip pan swoosh',
    tags: ['transition', 'whip'],
    make: () => {
      const d = 0.35;
      const n = noise(d, 11);
      const f = bandpass(n, (t) => 800 + 5000 * (t / d), 1.8);
      for (let i = 0; i < f.length; i++) {
        const t = i / SR;
        f[i]! *= Math.sin((Math.PI * t) / d) ** 3;
      }
      return fadeEdges(normalize(f, 0.75));
    },
  },
  {
    id: 'pop',
    name: 'Pop',
    kind: 'sfx',
    description: 'Bubbly pop for text and graphics appearing',
    tags: ['ui', 'text', 'appear'],
    make: () => {
      const b = buffer(0.18);
      let phase = 0;
      for (let i = 0; i < b.length; i++) {
        const t = i / SR;
        const f = 220 + 900 * Math.exp(-t / 0.025);
        phase += (2 * Math.PI * f) / SR;
        b[i] = Math.sin(phase) * Math.exp(-t / 0.05);
      }
      return fadeEdges(normalize(b, 0.8));
    },
  },
  {
    id: 'click',
    name: 'Click',
    kind: 'sfx',
    description: 'Crisp UI click',
    tags: ['ui', 'button', 'cursor'],
    make: () => {
      const n = noise(0.03, 5);
      const b = bandpass(n, () => 3500, 2);
      for (let i = 0; i < b.length; i++) b[i]! *= Math.exp(-(i / SR) / 0.004);
      return fadeEdges(normalize(b, 0.7), 0.0005, 0.005);
    },
  },
  {
    id: 'ding',
    name: 'Ding',
    kind: 'sfx',
    description: 'Bright bell ding for highlights and correct answers',
    tags: ['bell', 'highlight', 'success'],
    make: () => normalize(addReverb(tone(1318.5, 1.6, { attack: 0.003, decay: 0.45, harmonics: [1, 0.35, 0.18, 0.08] }), 0.2), 0.7),
  },
  {
    id: 'chime',
    name: 'Success chime',
    kind: 'sfx',
    description: 'Three-note rising chime',
    tags: ['success', 'reveal', 'positive'],
    make: () => {
      const b = buffer(1.6);
      ['C6', 'E6', 'G6'].forEach((n, i) => tone(note(n), 1.2, { into: b, start: i * 0.11, attack: 0.004, decay: 0.35, harmonics: [1, 0.3, 0.1], gain: 0.6 }));
      return normalize(addReverb(b, 0.25), 0.7);
    },
  },
  {
    id: 'notification',
    name: 'Notification',
    kind: 'sfx',
    description: 'Two-tone notification blip',
    tags: ['ui', 'message', 'alert'],
    make: () => {
      const b = buffer(0.6);
      tone(note('A5'), 0.3, { into: b, decay: 0.12, harmonics: [1, 0.2] });
      tone(note('E6'), 0.4, { into: b, start: 0.12, decay: 0.16, harmonics: [1, 0.2] });
      return normalize(b, 0.65);
    },
  },
  {
    id: 'riser',
    name: 'Riser',
    kind: 'sfx',
    description: '2-second tension riser before a reveal',
    tags: ['build', 'tension', 'reveal'],
    make: () => {
      const d = 2;
      const n = noise(d, 21);
      const f = bandpass(n, (t) => 400 + 4000 * (t / d) ** 2, 2.2);
      let phase = 0;
      for (let i = 0; i < f.length; i++) {
        const t = i / SR;
        phase += (2 * Math.PI * (180 + 900 * (t / d) ** 2)) / SR;
        f[i] = (f[i]! * 0.7 + Math.sin(phase) * 0.25) * (t / d) ** 2;
      }
      return fadeEdges(normalize(f, 0.75), 0.01, 0.01);
    },
  },
  {
    id: 'impact',
    name: 'Impact',
    kind: 'sfx',
    description: 'Deep cinematic hit for big moments',
    tags: ['hit', 'boom', 'drop', 'cinematic'],
    make: () => {
      const d = 1.8;
      const b = buffer(d);
      let phase = 0;
      for (let i = 0; i < b.length; i++) {
        const t = i / SR;
        phase += (2 * Math.PI * (45 + 90 * Math.exp(-t / 0.08))) / SR;
        b[i] = Math.sin(phase) * Math.exp(-t / 0.55);
      }
      const n = lowpass(noise(d, 9), 900);
      for (let i = 0; i < b.length; i++) b[i]! += n[i]! * Math.exp(-(i / SR) / 0.12) * 0.9;
      return fadeEdges(normalize(addReverb(b, 0.2, 0.5), 0.9));
    },
  },
  {
    id: 'glitch',
    name: 'Glitch',
    kind: 'sfx',
    description: 'Digital glitch stutter',
    tags: ['digital', 'tech', 'error'],
    make: () => {
      const r = seededRandom(42);
      const b = buffer(0.5);
      let i = 0;
      while (i < b.length) {
        const len = Math.round((0.01 + r() * 0.04) * SR);
        const f = 80 + r() * 2400;
        const type = r();
        for (let k = 0; k < len && i + k < b.length; k++) {
          const t = k / SR;
          const sq = Math.sign(Math.sin(2 * Math.PI * f * t));
          b[i + k] = type > 0.5 ? sq * 0.6 : (r() * 2 - 1) * 0.5;
        }
        i += len + Math.round(r() * 0.02 * SR);
      }
      return fadeEdges(normalize(b, 0.6));
    },
  },
  {
    id: 'typing',
    name: 'Keyboard typing',
    kind: 'sfx',
    description: '1.5s of keyboard typing (pairs with code/typewriter text)',
    tags: ['keyboard', 'code', 'typewriter'],
    make: () => {
      const r = seededRandom(77);
      const b = buffer(1.6);
      let t = 0.02;
      while (t < 1.5) {
        const start = Math.round(t * SR);
        const n = bandpass(noise(0.03, Math.floor(r() * 1000)), () => 2000 + r() * 2000, 2.5);
        for (let k = 0; k < n.length && start + k < b.length; k++) b[start + k]! += n[k]! * Math.exp(-(k / SR) / 0.006) * (0.6 + r() * 0.4);
        t += 0.06 + r() * 0.11;
      }
      return fadeEdges(normalize(b, 0.6));
    },
  },
  {
    id: 'camera-shutter',
    name: 'Camera shutter',
    kind: 'sfx',
    description: 'Photo snapshot sound',
    tags: ['photo', 'snapshot', 'freeze'],
    make: () => {
      const b = buffer(0.3);
      for (const [at, f] of [
        [0, 2500],
        [0.09, 1800],
      ] as const) {
        const n = bandpass(noise(0.05, at * 1000 + 3), () => f, 1.5);
        const s = Math.round(at * SR);
        for (let k = 0; k < n.length && s + k < b.length; k++) b[s + k]! += n[k]! * Math.exp(-(k / SR) / 0.012);
      }
      return fadeEdges(normalize(b, 0.7));
    },
  },
  {
    id: 'ambient-pad',
    name: 'Ambient pad (placeholder music)',
    kind: 'music',
    description: 'Calm 32-second chord pad loop for explainers. Basic placeholder — replace with real music for publishing.',
    tags: ['music', 'calm', 'background', 'loop'],
    make: () => {
      const bar = 4;
      const chords = [
        ['C4', 'E4', 'G4', 'B4'],
        ['A3', 'C4', 'E4', 'G4'],
        ['F3', 'A3', 'C4', 'E4'],
        ['G3', 'B3', 'D4', 'A4'],
      ];
      const total = bar * chords.length * 2;
      const b = buffer(total);
      for (let rep = 0; rep < 2; rep++) {
        chords.forEach((ch, ci) => {
          const start = (rep * chords.length + ci) * bar;
          for (const n of ch) {
            for (const det of [-0.003, 0.003]) {
              const f = note(n) * (1 + det);
              const len = Math.round(bar * 1.15 * SR);
              const s = Math.round(start * SR);
              for (let k = 0; k < len && s + k < b.length; k++) {
                const t = k / SR;
                const env = Math.min(1, t / 0.9) * Math.min(1, Math.max(0, (bar * 1.15 - t) / 1.2));
                b[s + k]! += (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * env * 0.08;
              }
            }
          }
          // soft bass
          tone(note(ch[0]!) / 2, bar, { into: b, start, attack: 0.3, decay: 3, gain: 0.25 });
        });
      }
      return fadeEdges(normalize(addReverb(lowpass(b, 2400), 0.35, 0.55).subarray(0, b.length), 0.5), 0.5, 0.5);
    },
  },
  {
    id: 'upbeat-pulse',
    name: 'Upbeat pulse (placeholder music)',
    kind: 'music',
    description: '110 BPM upbeat loop with kick, hats and chord stabs (~35s). Basic placeholder — replace with real music for publishing.',
    tags: ['music', 'upbeat', 'energetic', 'loop'],
    make: () => {
      const bpm = 110;
      const beat = 60 / bpm;
      const bars = 16;
      const b = buffer(bars * 4 * beat);
      const r = seededRandom(5);
      const progression = [
        ['A3', 'C4', 'E4'],
        ['F3', 'A3', 'C4'],
        ['C4', 'E4', 'G4'],
        ['G3', 'B3', 'D4'],
      ];
      for (let barI = 0; barI < bars; barI++) {
        for (let q = 0; q < 4; q++) {
          const t0 = (barI * 4 + q) * beat;
          // kick
          let phase = 0;
          const ks = Math.round(t0 * SR);
          for (let k = 0; k < SR * 0.25 && ks + k < b.length; k++) {
            const t = k / SR;
            phase += (2 * Math.PI * (50 + 120 * Math.exp(-t / 0.03))) / SR;
            b[ks + k]! += Math.sin(phase) * Math.exp(-t / 0.12) * 0.55;
          }
          // offbeat hat
          const hs = Math.round((t0 + beat / 2) * SR);
          for (let k = 0; k < SR * 0.05 && hs + k < b.length; k++) b[hs + k]! += (r() * 2 - 1) * Math.exp(-(k / SR) / 0.012) * 0.12;
          // chord stabs on beats 2 and 4
          if (q % 2 === 1) for (const n of progression[barI % 4]!) tone(note(n), beat * 0.9, { into: b, start: t0, attack: 0.005, decay: 0.18, harmonics: [1, 0.5, 0.25], gain: 0.09 });
        }
        tone(note(progression[barI % 4]![0]!) / 2, beat * 4, { into: b, start: barI * 4 * beat, attack: 0.01, decay: 1.2, gain: 0.3 });
      }
      return fadeEdges(normalize(b, 0.6), 0.05, 0.3);
    },
  },
];

const dir = () => {
  const d = path.join(LIBRARY_DIR, 'sounds');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

export const listLibrary = () =>
  ITEMS.map(({ id, name, kind, description, tags }) => ({ id, name, kind, description, tags, file: `${id}.wav` }));

/** Ensure the WAV for an item exists and return its absolute path. */
export const libraryFile = (id: string): string => {
  const item = ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown library sound "${id}". Available: ${ITEMS.map((i) => i.id).join(', ')}`);
  const file = path.join(dir(), `${id}.wav`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, floatToWav(item.make(), SR));
  return file;
};

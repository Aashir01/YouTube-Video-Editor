import React from 'react';
import { Easing, random } from 'remotion';
import type { ColorGrade, KenBurns, Transition, VideoClip } from '../shared/schema';

/** Frame span of a clip; computed from start/end so adjacent clips never gap or overlap. */
export const clipFrames = (clip: { start: number; duration: number }, fps: number) => {
  const from = Math.round(clip.start * fps);
  const end = Math.round((clip.start + clip.duration) * fps);
  return { from, durationInFrames: Math.max(1, end - from) };
};

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

export const ease = (name: string | undefined, t: number): number => {
  const x = clamp01(t);
  switch (name) {
    case 'linear':
      return x;
    case 'ease-in':
      return Easing.in(Easing.cubic)(x);
    case 'ease-out':
      return easeOut(x);
    case 'snappy':
      return Easing.bezier(0.2, 1.4, 0.4, 1)(x);
    case 'spring':
      return 1 - Math.exp(-6 * x) * Math.cos(9 * x);
    default:
      return easeInOut(x);
  }
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface TransitionResult {
  style: React.CSSProperties;
  flash: number;
}

const applyOne = (
  t: Transition,
  p: number,
  dir: 'in' | 'out',
  acc: { opacity: number; transforms: string[]; filters: string[]; clipPath?: string; flash: number },
  u: number,
  frame: number,
) => {
  const q = dir === 'in' ? easeOut(p) : easeInOut(p); // q: 0 = hidden edge, 1 = fully visible
  const r = 1 - q;
  const sign = dir === 'in' ? 1 : -1;
  switch (t.type) {
    case 'fade':
      acc.opacity *= q;
      break;
    case 'slide-left':
      acc.transforms.push(`translateX(${sign * r * 100}%)`);
      break;
    case 'slide-right':
      acc.transforms.push(`translateX(${-sign * r * 100}%)`);
      break;
    case 'slide-up':
      acc.transforms.push(`translateY(${sign * r * 100}%)`);
      break;
    case 'slide-down':
      acc.transforms.push(`translateY(${-sign * r * 100}%)`);
      break;
    case 'zoom-in':
      acc.transforms.push(`scale(${dir === 'in' ? 1 + 0.25 * r : 1 + 0.25 * r})`);
      acc.opacity *= q;
      break;
    case 'zoom-out':
      acc.transforms.push(`scale(${1 - 0.15 * r})`);
      acc.opacity *= q;
      break;
    case 'blur':
      acc.filters.push(`blur(${r * 40 * u}px)`);
      acc.opacity *= clamp01(q * 1.4);
      break;
    case 'wipe-left':
      acc.clipPath = dir === 'in' ? `inset(0 0 0 ${r * 100}%)` : `inset(0 ${r * 100}% 0 0)`;
      break;
    case 'wipe-right':
      acc.clipPath = dir === 'in' ? `inset(0 ${r * 100}% 0 0)` : `inset(0 0 0 ${r * 100}%)`;
      break;
    case 'circle':
      acc.clipPath = `circle(${q * 75}% at 50% 50%)`;
      break;
    case 'flash':
      acc.flash = Math.max(acc.flash, r);
      acc.opacity *= p < 0.5 && dir === 'in' ? 0 : 1;
      break;
    case 'whip': {
      const s = Easing.bezier(0.7, 0, 0.3, 1)(p);
      acc.transforms.push(`translateX(${(dir === 'in' ? -1 : 1) * (1 - s) * 110}%)`);
      acc.filters.push(`blur(${(1 - s) * 60 * u}px)`);
      break;
    }
    case 'glitch': {
      if (q < 1) {
        const jx = (random(`gx${frame}`) - 0.5) * 60 * u * r;
        const jy = (random(`gy${frame}`) - 0.5) * 20 * u * r;
        acc.transforms.push(`translate(${jx}px, ${jy}px)`);
        acc.filters.push(`hue-rotate(${Math.round(r * 90)}deg) saturate(${1 + r * 2})`);
        acc.opacity *= random(`go${frame}`) > r * 0.6 ? 1 : 0.2;
      }
      break;
    }
  }
};

export const transitionStyle = (
  tin: Transition | undefined,
  tout: Transition | undefined,
  frame: number,
  durationInFrames: number,
  fps: number,
  u: number,
): TransitionResult => {
  const acc = { opacity: 1, transforms: [] as string[], filters: [] as string[], clipPath: undefined as string | undefined, flash: 0 };
  if (tin) {
    const n = Math.max(1, Math.round(tin.duration * fps));
    if (frame < n) applyOne(tin, frame / n, 'in', acc, u, frame);
  }
  if (tout) {
    const n = Math.max(1, Math.round(tout.duration * fps));
    const remaining = durationInFrames - frame;
    if (remaining <= n) applyOne(tout, clamp01((remaining - 1) / n), 'out', acc, u, frame);
  }
  const style: React.CSSProperties = {};
  if (acc.opacity !== 1) style.opacity = acc.opacity;
  if (acc.transforms.length) style.transform = acc.transforms.join(' ');
  if (acc.filters.length) style.filter = acc.filters.join(' ');
  if (acc.clipPath) style.clipPath = acc.clipPath;
  return { style, flash: acc.flash };
};

// ---------------------------------------------------------------------------
// Color grading
// ---------------------------------------------------------------------------

const PRESETS: Record<string, { b?: number; c?: number; s?: number; h?: number; sepia?: number; gray?: number; vignette?: number; tint?: string; blend?: string }> = {
  none: {},
  cinematic: { b: 0.97, c: 1.12, s: 0.92, vignette: 0.35, tint: 'linear-gradient(180deg, rgba(0,90,110,0.10), rgba(255,140,60,0.08))', blend: 'soft-light' },
  warm: { s: 1.08, sepia: 0.16, b: 1.02, tint: 'rgba(255,150,60,0.10)', blend: 'soft-light' },
  cool: { s: 0.95, b: 1.02, h: -6, tint: 'rgba(60,140,255,0.12)', blend: 'soft-light' },
  vibrant: { s: 1.35, c: 1.08, b: 1.02 },
  muted: { s: 0.7, c: 0.95, b: 1.02 },
  bw: { gray: 1, c: 1.18 },
  vintage: { sepia: 0.35, c: 0.9, s: 0.85, b: 1.05, vignette: 0.4, tint: 'rgba(255,220,160,0.12)', blend: 'multiply' },
  'teal-orange': { c: 1.1, s: 1.1, tint: 'linear-gradient(135deg, rgba(0,128,128,0.22), rgba(255,128,0,0.18))', blend: 'soft-light' },
  punchy: { c: 1.22, s: 1.2, b: 1.0, vignette: 0.2 },
};

export const gradeFilter = (g: ColorGrade | undefined): { filter?: string; vignette: number; tint?: string; blend?: string } => {
  if (!g) return { vignette: 0 };
  const p = PRESETS[g.preset] ?? {};
  const b = (p.b ?? 1) * g.brightness;
  const c = (p.c ?? 1) * g.contrast;
  const s = (p.s ?? 1) * g.saturation;
  const h = (p.h ?? 0) + g.hue;
  const parts: string[] = [];
  if (b !== 1) parts.push(`brightness(${b.toFixed(3)})`);
  if (c !== 1) parts.push(`contrast(${c.toFixed(3)})`);
  if (s !== 1) parts.push(`saturate(${s.toFixed(3)})`);
  if (h !== 0) parts.push(`hue-rotate(${h}deg)`);
  if (p.sepia) parts.push(`sepia(${p.sepia})`);
  if (p.gray) parts.push(`grayscale(${p.gray})`);
  if (g.blur > 0) parts.push(`blur(${g.blur}px)`);
  return { filter: parts.length ? parts.join(' ') : undefined, vignette: Math.max(g.vignette, p.vignette ?? 0), tint: p.tint, blend: p.blend };
};

export const GradeOverlays: React.FC<{ vignette: number; tint?: string; blend?: string }> = ({ vignette, tint, blend }) => (
  <>
    {tint ? (
      <div style={{ position: 'absolute', inset: 0, background: tint, mixBlendMode: (blend ?? 'soft-light') as React.CSSProperties['mixBlendMode'], pointerEvents: 'none' }} />
    ) : null}
    {vignette > 0 ? (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${(vignette * 0.85).toFixed(3)}) 100%)`,
          pointerEvents: 'none',
        }}
      />
    ) : null}
  </>
);

// ---------------------------------------------------------------------------
// Zoom / Ken Burns
// ---------------------------------------------------------------------------

export interface ZoomState {
  scale: number;
  ox: number;
  oy: number;
}

export const kenBurnsAt = (kb: KenBurns | undefined, t: number, duration: number): ZoomState => {
  if (!kb) return { scale: 1, ox: 0.5, oy: 0.5 };
  const p = ease(kb.easing, duration > 0 ? t / duration : 0);
  return { scale: lerp(kb.fromScale, kb.toScale, p), ox: lerp(kb.fromX, kb.toX, p), oy: lerp(kb.fromY, kb.toY, p) };
};

export const zoomAt = (clip: Pick<VideoClip, 'zooms' | 'kenBurns' | 'duration'>, t: number): ZoomState => {
  const base = kenBurnsAt(clip.kenBurns, t, clip.duration);
  let best = 1;
  let ox = base.ox;
  let oy = base.oy;
  for (const z of clip.zooms) {
    if (t < z.at || t > z.at + z.duration) continue;
    const local = t - z.at;
    let s = 1;
    if (z.style === 'snap') s = z.scale;
    else if (z.style === 'slow-push') s = lerp(1, z.scale, ease('ease-in-out', local / z.duration));
    else {
      const ramp = Math.min(0.35, z.duration / 3);
      const up = ease('ease-out', local / ramp);
      const down = ease('ease-in-out', (z.duration - local) / ramp);
      s = lerp(1, z.scale, Math.min(up, down));
    }
    if (s > best) {
      best = s;
      ox = z.x;
      oy = z.y;
    }
  }
  return { scale: base.scale * best, ox, oy };
};

/**
 * Where things in a video show up on the canvas, at any moment: the inverse of what the renderer
 * does to a clip (picture-in-picture box, object-fit with the focus point, static zoom, punch-in
 * zooms / Ken Burns, all with keyframes). Used to pin graphics and blur boxes to tracked faces
 * and objects.
 */
import type { Clip, ImageClip, Keyframe, Project, VideoClip } from './schema';
import { channelAt } from './keyframes';
import { kenBurnsAt, zoomAt } from '../remotion/effects';

export interface Pt {
  x: number;
  y: number;
}

type Framed = VideoClip | ImageClip;

const clipEnd = (c: { start: number; duration: number }) => c.start + c.duration;

/** The footage a graphic sits on: the topmost visible video clip below it at its start. */
export const baseVideoFor = (p: Project, clip: Clip): VideoClip | null => {
  const ti = p.tracks.findIndex((t) => t.clips.some((c) => c.id === clip.id));
  const at = clip.start + Math.min(0.05, clip.duration / 2);
  for (let i = ti - 1; i >= 0; i--) {
    const t = p.tracks[i]!;
    if (t.hidden) continue;
    const v = t.clips.find((c): c is VideoClip => c.type === 'video' && c.id !== clip.id && c.start <= at && clipEnd(c) > at);
    if (v) return v;
  }
  return null;
};

/** Displayed media size relative to its frame, per axis, for a fit mode. */
export const fitScale = (mediaW: number, mediaH: number, frameW: number, frameH: number, fit: Framed['fit']): { kx: number; ky: number } => {
  const am = mediaW / mediaH;
  const af = frameW / frameH;
  if (fit === 'fill') return { kx: 1, ky: 1 };
  if (fit === 'cover') return { kx: am > af ? am / af : 1, ky: am < af ? af / am : 1 };
  return { kx: am < af ? am / af : 1, ky: am > af ? af / am : 1 };
};

interface Placement {
  box: { x: number; y: number; w: number; h: number };
  kx: number;
  ky: number;
  f: Pt;
  /** total zoom and its origin (frame fractions) */
  s: number;
  o: Pt;
}

/** Everything the renderer applies to a clip at clip time t (see mediaFrameStyle and VisualFrame). */
const placement = (p: Project, clip: Framed, media: { width: number; height: number }, t: number): Placement => {
  const box = clip.box ? { x: channelAt(clip, 'box.x', t), y: channelAt(clip, 'box.y', t), w: channelAt(clip, 'box.w', t), h: channelAt(clip, 'box.h', t) } : { x: 0, y: 0, w: 1, h: 1 };
  const { kx, ky } = fitScale(media.width, media.height, box.w * p.canvas.width, box.h * p.canvas.height, clip.fit);
  const f = { x: channelAt(clip, 'focus.x', t), y: channelAt(clip, 'focus.y', t) };
  const z = clip.type === 'video' ? zoomAt(clip, t) : kenBurnsAt(clip.kenBurns, t, clip.duration);
  const s = z.scale * channelAt(clip, 'scale', t);
  return { box, kx, ky, f, s, o: z.scale !== 1 ? { x: z.ox, y: z.oy } : f };
};

/** A point of the media (fractions of the picture) → the canvas (fractions), at clip time t. */
export const mediaToCanvas = (p: Project, clip: Framed, media: { width: number; height: number }, t: number, pt: Pt): Pt => {
  const { box, kx, ky, f, s, o } = placement(p, clip, media, t);
  // object-fit places media point c at f·(1−k) + c·k of the frame; the zoom maps q to o + s·(q − o)
  const qx = o.x + s * (f.x * (1 - kx) + pt.x * kx - o.x);
  const qy = o.y + s * (f.y * (1 - ky) + pt.y * ky - o.y);
  return { x: box.x + qx * box.w, y: box.y + qy * box.h };
};

/** A point of the canvas (fractions) → the media (fractions), at clip time t. */
export const canvasToMedia = (p: Project, clip: Framed, media: { width: number; height: number }, t: number, pt: Pt): Pt => {
  const { box, kx, ky, f, s, o } = placement(p, clip, media, t);
  const qx = (pt.x - box.x) / box.w;
  const qy = (pt.y - box.y) / box.h;
  return { x: ((o.x + (qx - o.x) / s) - f.x * (1 - kx)) / kx, y: ((o.y + (qy - o.y) / s) - f.y * (1 - ky)) / ky };
};

/** How big a media length looks on the canvas (fractions of the canvas), at clip time t. */
export const mediaSizeOnCanvas = (p: Project, clip: Framed, media: { width: number; height: number }, t: number, size: { w: number; h: number }) => {
  const { box, kx, ky, s } = placement(p, clip, media, t);
  return { w: size.w * kx * s * box.w, h: size.h * ky * s * box.h };
};

/** Fewest points that stay within `tol` of a path (Ramer–Douglas–Peucker on two values per point). */
export const simplifyPath = <T extends { t: number; x: number; y: number }>(pts: T[], tol: number): T[] => {
  if (pts.length <= 2) return pts;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  let worst = -1;
  let idx = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const q = pts[i]!;
    const k = b.t === a.t ? 0 : (q.t - a.t) / (b.t - a.t);
    const d = Math.max(Math.abs(q.x - (a.x + (b.x - a.x) * k)), Math.abs(q.y - (a.y + (b.y - a.y) * k)));
    if (d > worst) {
      worst = d;
      idx = i;
    }
  }
  if (worst <= tol) return [a, b];
  return [...simplifyPath(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplifyPath(pts.slice(idx), tol)];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Keyframes for two channels from a path (linear between points, like the tracked motion). */
export const pathKeyframes = (pts: { t: number; x: number; y: number }[], tol = 0.004): { x: Keyframe[]; y: Keyframe[] } => {
  const simple = simplifyPath(pts, tol);
  return {
    x: simple.map((q) => ({ t: r3(q.t), v: r4(q.x), ease: 'linear' as const })),
    y: simple.map((q) => ({ t: r3(q.t), v: r4(q.y), ease: 'linear' as const })),
  };
};

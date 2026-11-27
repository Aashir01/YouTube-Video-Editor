/**
 * Motion tracking for graphics: make text, picture-in-picture and blur boxes follow a face or an
 * object in the video under them, and blur every face in a clip. Tracking runs on the footage
 * (faces: the YuNet detector; objects: template matching); positions are mapped onto the canvas
 * through the clip's crop, zoom and keyframes (shared/motion.ts) and written as keyframes.
 */
import type { BlurClip, Clip, ImageClip, Project, TextClip, VideoClip } from '../shared/schema';
import { channelAt } from '../shared/keyframes';
import { baseVideoFor, canvasToMedia, mediaSizeOnCanvas, mediaToCanvas, pathKeyframes } from '../shared/motion';
import { clipEnd, getAsset } from '../shared/timeline';
import type { EditOp } from '../shared/ops';
import { analyzeTalking } from './media/faces';
import { trackRegion } from './media/track';
import { store } from './storage/projects';

type Graphic = TextClip | VideoClip | ImageClip | BlurClip;
const isGraphic = (c: Clip): c is Graphic => c.type === 'text' || c.type === 'blur' || ((c.type === 'video' || c.type === 'image') && Boolean(c.box));

const findClip = (p: Project, id: string) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id);

/** Moving average over ±r samples: takes the detector's frame-to-frame jitter out of a path. */
const smooth = (xs: number[], r: number) =>
  xs.map((_, i) => {
    const w = xs.slice(Math.max(0, i - r), i + r + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
const smoothPath = <T extends { x: number; y: number }>(pts: T[], r: number): T[] => {
  const xs = smooth(pts.map((q) => q.x), r);
  const ys = smooth(pts.map((q) => q.y), r);
  return pts.map((q, i) => ({ ...q, x: xs[i]!, y: ys[i]! }));
};

const srcAt = (v: VideoClip, T: number) => v.trimStart + (T - v.start) * v.speed;
const timelineAt = (v: VideoClip, s: number) => v.start + (s - v.trimStart) / v.speed;

const footage = (p: Project, v: VideoClip) => {
  const asset = getAsset(p, v.assetId);
  const width = asset?.meta.width;
  const height = asset?.meta.height;
  if (!asset || !width || !height) throw new Error('The video under it is missing or its size is unknown');
  return { file: store.mediaPath(p.id, asset.file), size: { width, height } };
};

/** Where a graphic is at its clip time τ: its anchor (text) or box center, on the canvas. */
const anchorAt = (g: Graphic, tau: number) =>
  g.type === 'text'
    ? { x: channelAt(g, 'x', tau), y: channelAt(g, 'y', tau) }
    : { x: channelAt(g, 'box.x', tau) + channelAt(g, 'box.w', tau) / 2, y: channelAt(g, 'box.y', tau) + channelAt(g, 'box.h', tau) / 2 };

/** Faces through [T0, T1] of the timeline: tracks in picture coordinates with source times. */
const faceTracks = async (p: Project, v: VideoClip, T0: number, T1: number, signal?: AbortSignal) => {
  const { file, size } = footage(p, v);
  const r = await analyzeTalking(file, size, srcAt(v, T0), srcAt(v, T1), { fps: 5, detectEvery: 1, signal });
  if (!r) throw new Error('Face detection is not available on this computer (optional onnxruntime-node is not installed)');
  return { tracks: r.tracks, size };
};

export interface FollowResult {
  patch: Record<string, unknown>;
  summary: string;
}

/**
 * Make a graphic follow the nearest face, or whatever is under it, in the video below.
 * Returns the updateClip patch (position keyframes); the graphic keeps its place relative to the target.
 */
export const followTarget = async (p: Project, clipId: string, target: 'face' | 'under', signal?: AbortSignal): Promise<FollowResult> => {
  const g = findClip(p, clipId);
  if (!g || !isGraphic(g)) throw new Error('Only text, picture-in-picture and blur clips can follow something');
  const v = baseVideoFor(p, g);
  if (!v) throw new Error('There is no video under this clip to follow');
  const T0 = g.start;
  const T1 = Math.min(clipEnd(g), clipEnd(v));
  const anchor = anchorAt(g, 0);
  let path: { T: number; x: number; y: number }[];
  let lostAt: number | null = null;
  if (target === 'face') {
    const { tracks, size } = await faceTracks(p, v, T0, T1, signal);
    const near = tracks
      .map((tr) => {
        const first = tr.faces[0];
        if (!first || timelineAt(v, first.t) > T0 + 1) return null;
        const q = mediaToCanvas(p, v, size, timelineAt(v, first.t) - v.start, { x: first.face.cx, y: first.face.cy });
        return { tr, d: Math.hypot(q.x - anchor.x, q.y - anchor.y) };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => a.d - b.d)[0];
    if (!near) throw new Error('No face in the video at the start of this clip');
    path = near.tr.faces.map(({ t, face }) => {
      const T = timelineAt(v, t);
      return { T, ...mediaToCanvas(p, v, size, T - v.start, { x: face.cx, y: face.cy }) };
    });
  } else {
    const { file, size } = footage(p, v);
    // the region under the graphic at its start, in picture coordinates
    const half = g.type === 'text' ? { w: 0.06, h: 0.06 * (p.canvas.width / p.canvas.height) } : { w: channelAt(g, 'box.w', 0) / 2, h: channelAt(g, 'box.h', 0) / 2 };
    const tb = T0 - v.start;
    const c = canvasToMedia(p, v, size, tb, anchor);
    const a = canvasToMedia(p, v, size, tb, { x: anchor.x - half.w, y: anchor.y - half.h });
    const b = canvasToMedia(p, v, size, tb, { x: anchor.x + half.w, y: anchor.y + half.h });
    const pts = await trackRegion(file, size, srcAt(v, T0), srcAt(v, T1), { cx: c.x, cy: c.y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }, { fps: 10, signal });
    const lost = pts.findIndex((q, i) => i > 0 && q.score === 0);
    if (lost > 0) lostAt = Math.round((timelineAt(v, pts[lost]!.t) - g.start) * 10) / 10;
    path = pts.map((q) => {
      const T = timelineAt(v, q.t);
      return { T, ...mediaToCanvas(p, v, size, T - v.start, { x: q.cx, y: q.cy }) };
    });
  }
  if (!path.length) throw new Error('Nothing to follow in this part of the video');
  path = smoothPath(path, target === 'face' ? 2 : 1);
  // keep the graphic where it is relative to the target
  const dx = anchor.x - path[0]!.x;
  const dy = anchor.y - path[0]!.y;
  const pts = path.filter((q) => q.T >= T0 - 0.001 && q.T <= T1 + 0.001).map((q) => ({ t: q.T - g.start, x: q.x + dx, y: q.y + dy }));
  let keyframes: Record<string, unknown>;
  if (g.type === 'text') {
    const k = pathKeyframes(pts, 0.003);
    keyframes = { x: k.x, y: k.y };
  } else {
    const w = channelAt(g, 'box.w', 0);
    const h = channelAt(g, 'box.h', 0);
    const k = pathKeyframes(pts.map((q) => ({ t: q.t, x: q.x - w / 2, y: q.y - h / 2 })), 0.003);
    keyframes = { 'box.x': k.x, 'box.y': k.y };
  }
  const secs = Math.round((T1 - T0) * 10) / 10;
  const what = target === 'face' ? 'the face' : 'what is under it';
  return {
    patch: { keyframes },
    summary: `following ${what} for ${secs}s${lostAt !== null ? `; lost it at ${lostAt}s and held the last position` : ''}`,
  };
};

/** Ops that blur every face in a video clip: one blur box per person, following them. */
export const blurFacesOps = async (p: Project, clipId: string, opts: { strength?: number; signal?: AbortSignal } = {}): Promise<{ ops: EditOp[]; summary: string }> => {
  const v = findClip(p, clipId);
  if (!v || v.type !== 'video') throw new Error('Pick a video clip to blur the faces in');
  const { tracks, size } = await faceTracks(p, v, v.start, clipEnd(v), opts.signal);
  const people = tracks.filter((tr) => tr.faces.length >= 3);
  const ops: EditOp[] = people.map((tr) => {
    const raw = tr.faces.map(({ t, face }) => {
      const T = timelineAt(v, t);
      const tb = T - v.start;
      // a little above the face center and bigger than the face: forehead, hair and chin too
      const c = mediaToCanvas(p, v, size, tb, { x: face.cx, y: face.cy - face.h * 0.08 });
      const s = mediaSizeOnCanvas(p, v, size, tb, { w: face.w * 1.8, h: face.h * 1.6 });
      return { T, cx: c.x, cy: c.y, w: s.w, h: s.h };
    });
    // steady the path (±1 s) and the size (±2 s): the blur glides instead of jittering or pulsing
    const cx = smooth(raw.map((q) => q.cx), 2);
    const cy = smooth(raw.map((q) => q.cy), 2);
    const ws = smooth(raw.map((q) => q.w), 5);
    const hs = smooth(raw.map((q) => q.h), 5);
    const pts = raw.map((q, i) => ({ T: q.T, x: cx[i]! - ws[i]! / 2, y: cy[i]! - hs[i]! / 2, w: ws[i]!, h: hs[i]! }));
    const start = Math.max(v.start, pts[0]!.T - 0.15);
    const end = Math.min(clipEnd(v), pts[pts.length - 1]!.T + 0.25);
    const pos = pathKeyframes(pts.map((q) => ({ t: q.T - start, x: q.x, y: q.y })), 0.004);
    const dim = pathKeyframes(pts.map((q) => ({ t: q.T - start, x: q.w, y: q.h })), 0.01);
    const first = pts[0]!;
    return {
      op: 'addClip',
      clip: {
        id: '',
        type: 'blur',
        name: `Face blur ${tr.id}`,
        start: Math.round(start * 1000) / 1000,
        duration: Math.round((end - start) * 1000) / 1000,
        box: { x: first.x, y: first.y, w: first.w, h: first.h },
        shape: 'ellipse',
        strength: opts.strength ?? 36,
        keyframes: { 'box.x': pos.x, 'box.y': pos.y, 'box.w': dim.x, 'box.h': dim.y },
      },
    } as EditOp;
  });
  return { ops, summary: people.length ? `blurred ${people.length} face${people.length === 1 ? '' : 's'}, each followed through the clip` : 'found no faces to blur' };
};

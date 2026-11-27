import { describe, expect, it } from 'vitest';
import { createProject } from './timeline';
import { VideoClipSchema, type Project, type VideoClip } from './schema';
import { canvasToMedia, mediaSizeOnCanvas, mediaToCanvas, pathKeyframes } from './motion';

const HD = { width: 1920, height: 1080 };
const project = (w: number, h: number): Project => {
  const p = createProject({ name: 'm' });
  p.canvas = { ...p.canvas, width: w, height: h };
  return p;
};
const video = (extra: Partial<VideoClip> = {}): VideoClip => VideoClipSchema.parse({ id: 'v', type: 'video', assetId: 'a', start: 0, duration: 10, ...extra });
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
};

describe('media ↔ canvas mapping', () => {
  it('is the identity for full-frame footage of the same shape', () => {
    close(mediaToCanvas(project(1920, 1080), video(), HD, 1, { x: 0.3, y: 0.7 }), { x: 0.3, y: 0.7 });
  });

  it('follows the 9:16 crop and its focus point', () => {
    const p = project(1080, 1920);
    const k = 1920 / 1080 / (1080 / 1920); // the picture is ~3.16 frames wide
    close(mediaToCanvas(p, video(), HD, 0, { x: 0.5, y: 0.5 }), { x: 0.5, y: 0.5 });
    close(mediaToCanvas(p, video(), HD, 0, { x: 0.5 + 0.5 / k, y: 0.5 }), { x: 1, y: 0.5 });
    // focus 0: the left edge of the picture is on the left edge of the frame
    close(mediaToCanvas(p, video({ focus: { x: 0, y: 0.5 } }), HD, 0, { x: 0, y: 0.2 }), { x: 0, y: 0.2 });
  });

  it('places picture-in-picture and zoomed footage', () => {
    const p = project(1920, 1080);
    const pip = video({ box: { x: 0.6, y: 0.1, w: 0.3, h: 0.3 } });
    close(mediaToCanvas(p, pip, HD, 0, { x: 0, y: 0 }), { x: 0.6, y: 0.1 });
    close(mediaToCanvas(p, pip, HD, 0, { x: 1, y: 1 }), { x: 0.9, y: 0.4 });
    close(mediaToCanvas(p, video({ scale: 2 }), HD, 0, { x: 0.75, y: 0.5 }), { x: 1, y: 0.5 });
    expect(mediaSizeOnCanvas(p, video({ scale: 2 }), HD, 0, { w: 0.1, h: 0.1 }).w).toBeCloseTo(0.2, 5);
  });

  it('includes punch-in zooms and keyframed focus, and inverts exactly', () => {
    const p = project(1080, 1920);
    const v = video({ zooms: [{ at: 1, duration: 3, scale: 1.5, x: 0.3, y: 0.4, style: 'snap' }], keyframes: { 'focus.x': [{ t: 0, v: 0.2 }, { t: 10, v: 0.8 }] } });
    // during the snap zoom its origin stays put
    const o = canvasToMedia(p, v, HD, 2, { x: 0.3, y: 0.4 });
    close(mediaToCanvas(p, v, HD, 2, o), { x: 0.3, y: 0.4 });
    for (const t of [0, 2, 5, 9]) {
      const pt = { x: 0.37, y: 0.61 };
      close(canvasToMedia(p, v, HD, t, mediaToCanvas(p, v, HD, t, pt)), pt);
    }
  });

  it('turns a tracked path into a few linear keyframes', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ t: i * 0.5, x: 0.2 + i * 0.03, y: 0.5 }));
    const k = pathKeyframes(pts);
    expect(k.x).toHaveLength(2);
    expect(k.x[1]).toMatchObject({ t: 10, v: 0.8 });
  });
});

/**
 * Remove the background of a video clip: the person (local segmentation model) or a green/blue
 * screen (color key). The result is a new video with transparency (VP9 + alpha in WebM, which the
 * editor plays and the renderer keeps); the clip switches to it and can be restored. Only the part
 * of the source the clip uses is processed.
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uid } from '../shared/ids';
import { hex, maskToAlpha, screenColor, steadyMask, toModelInput, toRgba } from '../shared/matte';
import { addTrack, findClip, placeClip } from '../shared/timeline';
import type { Asset, ClipInput, Project, VideoClip } from '../shared/schema';
import { analysisQueue } from './jobs';
import { readFrames } from './media/faces';
import { ff, runFf } from './media/ffmpeg';
import { registerAsset } from './media/ingest';
import { loadSegmenter, segmenterFor } from './media/segment';
import { store } from './storage/projects';

export interface BackgroundOptions {
  /** person: find the person with the segmentation model; screen: key out a green or blue screen */
  mode: 'person' | 'screen';
  /** screen color (#rrggbb); found from the frame's edges when left out */
  color?: string;
  /** how far from the screen color still counts as screen, 0.05–0.6 (default 0.3) */
  similarity?: number;
  /** put a blurred copy of the original underneath ("portrait mode") */
  behind?: 'none' | 'blur';
  signal?: AbortSignal;
}

type Report = (progress: number, detail?: string) => void;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const VP9_ALPHA = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '30', '-b:v', '0'];

const clipOf = (p: Project, clipId: string) => findClip(p, clipId)?.clip;

const sourceOf = (p: Project, clipId: string) => {
  const ref = clipOf(p, clipId);
  if (!ref || ref.type !== 'video') throw new Error('Pick a video clip');
  if (ref.multicam) throw new Error('This is a multicam cut: remove the background of the camera files before making the multicam edit');
  const asset = p.assets.find((a) => a.id === ref.assetId);
  if (!asset?.meta.duration || !asset.meta.width || !asset.meta.height) throw new Error('The video is still being analyzed; try again in a moment');
  if (asset.derived?.kind === 'background' || asset.derived?.kind === 'greenscreen') throw new Error('This clip already has its background removed');
  return { clip: ref as VideoClip, asset };
};

/** The person, frame by frame: model mask -> steadied -> soft alpha -> RGBA into the encoder. */
const keyPerson = async (file: string, asset: Asset, from: number, to: number, size: { w: number; h: number }, out: string, report: Report, signal?: AbortSignal) => {
  const kind = segmenterFor(size.w, size.h);
  const seg = await loadSegmenter(kind);
  if (!seg) throw new Error('Background removal needs the optional onnxruntime-node package (npm install onnxruntime-node)');
  const fps = Math.min(60, asset.meta.fps || 30);
  const b = ff();
  const enc = spawn(
    b.ffmpeg,
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${size.w}x${size.h}`, '-r', String(fps), '-i', 'pipe:0', '-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', file, '-map', '0:v', '-map', '1:a?', ...VP9_ALPHA, '-c:a', 'libopus', '-b:a', '128k', '-shortest', out],
    { cwd: b.cwd, env: b.env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let encErr = '';
  enc.stderr.on('data', (d) => (encErr += String(d)));
  const encDone = new Promise<void>((resolve, reject) => {
    enc.on('error', reject);
    enc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Encoding the video failed: ${encErr.trim().split('\n').pop() ?? code}`))));
  });
  const input = new Float32Array(seg.width * seg.height * 3);
  const alpha = new Uint8Array(size.w * size.h);
  const rgba = new Uint8Array(size.w * size.h * 4);
  let prev: Float32Array | null = null;
  const total = Math.max(1, Math.round((to - from) * fps));
  let n = 0;
  try {
    await readFrames(
      file,
      size.w,
      size.h,
      from,
      to,
      fps,
      async (_t, frame) => {
        toModelInput(frame, size.w, size.h, seg.width, seg.height, input);
        const mask = steadyMask(Float32Array.from(await seg.mask(input)), prev);
        prev = mask;
        maskToAlpha(mask, seg.width, seg.height, size.w, size.h, 0.35, 0.65, alpha);
        toRgba(frame, alpha, rgba);
        if (!enc.stdin.write(rgba)) await new Promise((r) => enc.stdin.once('drain', r));
        if (++n % 10 === 0) report(Math.min(0.99, n / total), `${n}/${total} frames`);
      },
      signal,
    );
  } finally {
    enc.stdin.end();
  }
  await encDone;
};

/** A green or blue screen: FFmpeg's color key, with the color spill on the edges removed. */
const keyScreen = async (file: string, from: number, to: number, size: { w: number; h: number }, out: string, color: string, similarity: number, report: Report, signal?: AbortSignal) => {
  const [, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as [number, number, number];
  const spill = b > g ? 'blue' : 'green';
  const len = to - from;
  const res = await runFf(
    'ffmpeg',
    ['-y', '-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', file, '-vf', `scale=${size.w}:${size.h},format=rgba,colorkey=0x${color.slice(1)}:${similarity}:0.12,despill=type=${spill},format=yuva420p`, ...VP9_ALPHA, '-c:a', 'libopus', '-b:a', '128k', '-stats_period', '0.5', out],
    {
      signal,
      onStderrLine: (line) => {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
        if (m) report(Math.min(0.99, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / len));
      },
    },
  );
  if (res.code !== 0) throw new Error(`Keying the screen failed: ${res.stderr.trim().split('\n').pop()}`);
};

export interface BackgroundResult {
  assetId: string;
  summary: string;
}

/** Process the clip's part of its video and switch the clip to the result (one undo step). */
export const removeBackground = async (projectId: string, clipId: string, opts: BackgroundOptions, source: 'user' | 'agent' | 'mcp' = 'user'): Promise<BackgroundResult> => {
  const p = await store.get(projectId);
  const { clip, asset } = sourceOf(p, clipId);
  const file = store.mediaPath(projectId, asset.file);
  const from = Math.max(0, clip.trimStart - 0.5);
  const to = Math.min(asset.meta.duration!, clip.trimStart + clip.duration * clip.speed + 0.5);
  // at most 1920 on the long side and 1080 on the short one
  const scale = Math.min(1, 1920 / Math.max(asset.meta.width!, asset.meta.height!), 1080 / Math.min(asset.meta.width!, asset.meta.height!));
  const size = { w: even(asset.meta.width! * scale), h: even(asset.meta.height! * scale) };
  const tmp = path.join(os.tmpdir(), `cutroom-matte-${uid('m')}.webm`);
  let color = opts.color;
  try {
    await analysisQueue.add(projectId, opts.mode === 'person' ? 'Removing the background' : 'Removing the green screen', async (report) => {
      if (opts.mode === 'person') await keyPerson(file, asset, from, to, size, tmp, report, opts.signal);
      else {
        if (!color || color === 'auto') {
          let first: Uint8Array | null = null;
          await readFrames(file, 160, even((160 * size.h) / size.w), clip.trimStart, clip.trimStart + 0.2, 5, async (_t, f) => void (first ??= Uint8Array.from(f)), opts.signal);
          if (!first) throw new Error('Could not read the video');
          color = hex(screenColor(first, 160, even((160 * size.h) / size.w)));
        }
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`"${color}" is not a color like #00b140`);
        await keyScreen(file, from, to, size, tmp, color.toLowerCase(), Math.min(0.6, Math.max(0.05, opts.similarity ?? 0.3)), report, opts.signal);
      }
    });
    const base = asset.name.replace(/\.[^.]+$/, '');
    const made = await registerAsset(projectId, {
      sourcePath: tmp,
      originalName: `${base} (${opts.mode === 'person' ? 'no background' : 'keyed'}).webm`,
      origin: 'processed',
      alpha: true,
      derived: { from: asset.id, kind: opts.mode === 'person' ? 'background' : 'greenscreen', offset: r3(from), ...(color ? { note: color } : {}) },
      label: 'Add video without background',
      updateSource: source,
    });
    let behind = '';
    await store.update(
      projectId,
      opts.mode === 'person' ? 'Remove background' : 'Remove green screen',
      (d) => {
        const c = clipOf(d, clipId);
        if (!c || c.type !== 'video') return;
        c.assetId = made.id;
        c.trimStart = r3(c.trimStart - from);
        if (opts.behind === 'blur') {
          // the original, blurred and a touch larger (no soft edges), underneath everything
          const track = addTrack(d, { name: 'Background', kind: 'video', index: 0 });
          placeClip(d, { id: '', type: 'video', assetId: asset.id, start: c.start, duration: c.duration, trimStart: r3(c.trimStart + from), speed: c.speed, volume: 0, scale: 1.08, grade: { blur: 28 } } as ClipInput, { trackId: track.id });
          behind = ' with a blurred copy of the original behind it';
        }
      },
      { source },
    );
    return {
      assetId: made.id,
      summary: `${opts.mode === 'person' ? 'removed the background' : `keyed out the screen (${color})`} of ${(to - from).toFixed(1)}s of ${asset.name}${behind}; what is behind it now shows through`,
    };
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
};

/** Show the original video in the clip again. */
export const restoreOriginal = async (projectId: string, clipId: string, source: 'user' | 'agent' | 'mcp' = 'user') => {
  const p = await store.get(projectId);
  const c = clipOf(p, clipId);
  if (!c || c.type !== 'video') throw new Error('Pick a video clip');
  const derived = p.assets.find((a) => a.id === c.assetId)?.derived;
  if (!derived) throw new Error('This clip already shows its original video');
  await store.update(
    projectId,
    'Restore original video',
    (d) => {
      const clip = clipOf(d, clipId);
      if (clip?.type !== 'video') return;
      clip.assetId = derived.from;
      clip.trimStart = r3(clip.trimStart + derived.offset);
    },
    { source },
  );
  return { summary: 'the clip shows its original video again' };
};

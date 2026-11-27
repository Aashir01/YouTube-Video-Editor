/**
 * Remove the background of a video clip: the person (local segmentation model) or a green/blue
 * screen (color key). The result is a new video with transparency (VP9 + alpha in WebM, which the
 * editor plays and the renderer keeps); the clip switches to it and can be restored. Only the part
 * of the source the clip uses is processed.
 */
import { spawn } from 'node:child_process';
import { hex, maskToAlpha, screenColor, steadyMask, toModelInput, toRgba } from '../shared/matte';
import { addTrack, placeClip } from '../shared/timeline';
import type { Asset, ClipInput } from '../shared/schema';
import { bakeClip, videoSource, type Report } from './bake';
import { readFrames } from './media/faces';
import { ff, runFf } from './media/ffmpeg';
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


const r3 = (n: number) => Math.round(n * 1000) / 1000;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const VP9_ALPHA = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '30', '-b:v', '0'];

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
  const { asset } = videoSource(await store.get(projectId), clipId);
  if (asset.derived?.kind === 'background' || asset.derived?.kind === 'greenscreen') throw new Error('This clip already has its background removed');
  const person = opts.mode === 'person';
  const r = await bakeClip(
    projectId,
    clipId,
    {
      kind: person ? 'background' : 'greenscreen',
      label: person ? 'Remove background' : 'Remove green screen',
      suffix: person ? 'no background' : 'keyed',
      ext: '.webm',
      alpha: true,
      run: async ({ file, asset: a, clip, from, to, size, out, report, signal }) => {
        if (person) return void (await keyPerson(file, a, from, to, size, out, report, signal));
        let color = opts.color;
        if (!color || color === 'auto') {
          const h = even((160 * size.h) / size.w);
          let first: Uint8Array | null = null;
          await readFrames(file, 160, h, clip.trimStart, clip.trimStart + 0.2, 5, async (_t, f) => void (first ??= Uint8Array.from(f)), signal);
          if (!first) throw new Error('Could not read the video');
          color = hex(screenColor(first, 160, h));
        }
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`"${color}" is not a color like #00b140`);
        await keyScreen(file, from, to, size, out, color.toLowerCase(), Math.min(0.6, Math.max(0.05, opts.similarity ?? 0.3)), report, signal);
        return color.toLowerCase();
      },
      after:
        opts.behind === 'blur'
          ? (d, c, original, offset) => {
              // the original, blurred and a touch larger (no soft edges), underneath everything
              const track = addTrack(d, { name: 'Background', kind: 'video', index: 0 });
              placeClip(d, { id: '', type: 'video', assetId: original.id, start: c.start, duration: c.duration, trimStart: r3(c.trimStart + offset), speed: c.speed, volume: 0, scale: 1.08, grade: { blur: 28 } } as ClipInput, { trackId: track.id });
              return ' with a blurred copy of the original behind it';
            }
          : undefined,
    },
    source,
    opts.signal,
  );
  return {
    assetId: r.asset.id,
    summary: `${person ? 'removed the background' : `keyed out the screen (${r.note})`} of ${r.seconds.toFixed(1)}s of ${asset.name}${r.extra}; what is behind it now shows through`,
  };
};

export { restoreOriginal } from './bake';

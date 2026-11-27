/**
 * Processed copies of footage (background removed, stabilized, a color look): process the part of
 * the source a clip uses into a new video, register it as derived from the original, and switch the
 * clip to it in one undo step. "Restore the original" switches back.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uid } from '../shared/ids';
import { findClip } from '../shared/timeline';
import type { Asset, Project, VideoClip } from '../shared/schema';
import { analysisQueue } from './jobs';
import { registerAsset } from './media/ingest';
import { store } from './storage/projects';

export type Report = (progress: number, detail?: string) => void;
type Source = 'user' | 'agent' | 'mcp';

export interface BakeContext {
  /** the source file */
  file: string;
  asset: Asset;
  clip: VideoClip;
  /** the part of the source to process (seconds) */
  from: number;
  to: number;
  /** output size (even, at most 1920 on the long side and 1080 on the short one) */
  size: { w: number; h: number };
  out: string;
  report: Report;
  signal?: AbortSignal;
}

export interface BakeJob {
  kind: NonNullable<Asset['derived']>['kind'];
  /** job and history label, e.g. "Stabilize" */
  label: string;
  /** added to the new file's name, e.g. "stabilized" */
  suffix: string;
  ext: '.webm' | '.mp4';
  alpha?: boolean;
  /** does the work; may return a note to keep with the result (a found color, a LUT name) */
  run: (ctx: BakeContext) => Promise<string | void>;
  /** more edits in the same undo step; returns words for the summary */
  after?: (d: Project, clip: VideoClip, original: Asset, offset: number) => string | void;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export const clipOf = (p: Project, clipId: string) => findClip(p, clipId)?.clip;

export const videoSource = (p: Project, clipId: string) => {
  const clip = clipOf(p, clipId);
  if (!clip || clip.type !== 'video') throw new Error('Pick a video clip');
  if (clip.multicam) throw new Error('This is a multicam cut: process the camera files before making the multicam edit');
  const asset = p.assets.find((a) => a.id === clip.assetId);
  if (!asset?.meta.duration || !asset.meta.width || !asset.meta.height) throw new Error('The video is still being analyzed; try again in a moment');
  return { clip, asset };
};

export const bakeClip = async (projectId: string, clipId: string, job: BakeJob, source: Source, signal?: AbortSignal): Promise<{ asset: Asset; note?: string; extra: string; seconds: number }> => {
  const p = await store.get(projectId);
  const { clip, asset } = videoSource(p, clipId);
  const file = store.mediaPath(projectId, asset.file);
  const from = Math.max(0, clip.trimStart - 0.5);
  const to = Math.min(asset.meta.duration!, clip.trimStart + clip.duration * clip.speed + 0.5);
  const scale = Math.min(1, 1920 / Math.max(asset.meta.width!, asset.meta.height!), 1080 / Math.min(asset.meta.width!, asset.meta.height!));
  const size = { w: even(asset.meta.width! * scale), h: even(asset.meta.height! * scale) };
  const out = path.join(os.tmpdir(), `cutroom-bake-${uid('b')}${job.ext}`);
  try {
    const note = (await analysisQueue.add(projectId, job.label, (report) => job.run({ file, asset, clip, from, to, size, out, report, signal }))) || undefined;
    const made = await registerAsset(projectId, {
      sourcePath: out,
      originalName: `${asset.name.replace(/\.[^.]+$/, '')} (${job.suffix})${job.ext}`,
      origin: 'processed',
      alpha: job.alpha,
      derived: { from: asset.id, kind: job.kind, offset: r3(from), ...(note ? { note } : {}) },
      label: `Add ${job.suffix} video`,
      updateSource: source,
    });
    let extra = '';
    await store.update(
      projectId,
      job.label,
      (d) => {
        const c = clipOf(d, clipId);
        if (c?.type !== 'video') return;
        c.assetId = made.id;
        c.trimStart = r3(c.trimStart - from);
        extra = job.after?.(d, c, asset, from) || '';
      },
      { source },
    );
    return { asset: made, note, extra, seconds: r3(to - from) };
  } finally {
    await fsp.rm(out, { force: true }).catch(() => undefined);
  }
};

/** Show the original video in the clip again (one step back). */
export const restoreOriginal = async (projectId: string, clipId: string, source: Source = 'user') => {
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

/**
 * A file path as an FFmpeg filter option inside a filter graph, which unescapes twice: first the
 * graph (where [ ] , ; are special), then the filter's options (where : is special); a quote is
 * special in both. So "[" gets one backslash, ":" two and "'" three.
 */
export const filterPath = (file: string) =>
  file
    .replace(/\\/g, '/')
    .replace(/[[\],;]/g, (c) => `\\${c}`)
    .replace(/:/g, '\\\\:')
    .replace(/'/g, "\\\\\\'");

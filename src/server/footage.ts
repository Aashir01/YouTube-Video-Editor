/**
 * Footage fixes and looks: stabilize shaky footage (vidstab when FFmpeg has it, deshake otherwise),
 * apply a color look from a .cube LUT, and cut clips to the beat of the music.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uid } from '../shared/ids';
import { onsets } from '../shared/dsp';
import { planBeatCuts, timelineBeats, trackBeats, type BeatAnalysis } from '../shared/beats';
import { applyOps, type EditOp } from '../shared/ops';
import { clipEnd } from '../shared/timeline';
import type { AudioClip, Clip, Project } from '../shared/schema';
import { bakeClip, clipOf, filterPath, type BakeContext } from './bake';
import { audioLoudness, LOUDNESS_RATE } from './media/audio';
import { runFf } from './media/ffmpeg';
import { store } from './storage/projects';

type Source = 'user' | 'agent' | 'mcp';

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];

/** Run FFmpeg over the clip's part of its source, reporting progress between `lo` and `hi`. */
const encode = async (ctx: BakeContext, vf: string, out: string | null, lo = 0, hi = 1) => {
  const len = ctx.to - ctx.from;
  const r = await runFf('ffmpeg', ['-y', '-ss', ctx.from.toFixed(3), '-t', len.toFixed(3), '-i', ctx.file, '-vf', vf, '-stats_period', '0.5', ...(out ? [...H264, out] : ['-an', '-f', 'null', '-'])], {
    signal: ctx.signal,
    onStderrLine: (line) => {
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
      if (m) ctx.report(lo + (hi - lo) * Math.min(0.99, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / len));
    },
  });
  if (r.code !== 0) throw new Error(`FFmpeg failed: ${r.stderr.trim().split('\n').pop()}`);
};

// ---------------------------------------------------------------------------
// Stabilize
// ---------------------------------------------------------------------------

export const STABILIZE_STRENGTH = { light: 10, medium: 20, strong: 40 } as const;
export type StabilizeStrength = keyof typeof STABILIZE_STRENGTH;

let vidstab: Promise<boolean> | null = null;
const hasVidstab = () => (vidstab ??= runFf('ffmpeg', ['-filters']).then((r) => /vidstabdetect/.test(r.stdout.toString() + r.stderr), () => false));

export const stabilize = (projectId: string, clipId: string, strength: StabilizeStrength = 'medium', source: Source = 'user', signal?: AbortSignal) =>
  bakeClip(
    projectId,
    clipId,
    {
      kind: 'stabilized',
      label: 'Stabilize',
      suffix: 'stabilized',
      ext: '.mp4',
      run: async (ctx) => {
        const scale = `scale=${ctx.size.w}:${ctx.size.h}`;
        if (await hasVidstab()) {
          // two passes: measure the shake, then smooth the camera path (zooming just enough to hide the edges)
          const trf = path.join(os.tmpdir(), `cutroom-${uid('stab')}.trf`);
          try {
            await encode(ctx, `${scale},vidstabdetect=shakiness=6:accuracy=15:result=${filterPath(trf)}`, null, 0, 0.4);
            await encode(ctx, `${scale},vidstabtransform=input=${filterPath(trf)}:smoothing=${STABILIZE_STRENGTH[strength]}:optzoom=1:interpol=bicubic,unsharp=5:5:0.6:3:3:0.3`, ctx.out, 0.4, 1);
          } finally {
            await fsp.rm(trf, { force: true }).catch(() => undefined);
          }
          return `${strength} (vidstab)`;
        }
        await encode(ctx, `${scale},deshake=rx=48:ry=48:edge=mirror`, ctx.out);
        return `${strength} (deshake)`;
      },
    },
    source,
    signal,
  );

// ---------------------------------------------------------------------------
// Color looks (.cube LUTs)
// ---------------------------------------------------------------------------

/** Check a .cube file: a 3D LUT with as many entries as its size says. */
export const parseCube = (text: string): { size: number; title?: string } => {
  let size = 0;
  let title: string | undefined;
  let rows = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^LUT_1D_SIZE/i.test(line)) throw new Error('This is a 1D LUT; export a 3D .cube (LUT_3D_SIZE) instead');
    const m = /^LUT_3D_SIZE\s+(\d+)/i.exec(line);
    if (m) size = Number(m[1]);
    else if (/^TITLE\s+/i.test(line)) title = line.replace(/^TITLE\s+/i, '').replace(/^"|"$/g, '');
    else if (/^-?[\d.]+(e-?\d+)?\s+-?[\d.]+(e-?\d+)?\s+-?[\d.]+(e-?\d+)?$/i.test(line)) rows++;
  }
  if (size < 2 || size > 256) throw new Error('Not a 3D .cube LUT (LUT_3D_SIZE missing or out of range)');
  if (rows !== size ** 3) throw new Error(`The LUT is incomplete: ${rows} of ${size ** 3} entries`);
  return { size, title };
};

export const applyLut = async (projectId: string, clipId: string, lutAssetId: string, intensity = 1, source: Source = 'user', signal?: AbortSignal) => {
  const p = await store.get(projectId);
  const lut = p.assets.find((a) => a.id === lutAssetId);
  if (!lut || !/\.cube$/i.test(lut.file)) throw new Error('Pick a .cube LUT file from the project media');
  const lutFile = store.mediaPath(projectId, lut.file);
  const info = parseCube(await fsp.readFile(lutFile, 'utf8'));
  const k = Math.min(1, Math.max(0, intensity));
  const name = (info.title || lut.name.replace(/\.cube$/i, '')).slice(0, 60);
  return bakeClip(
    projectId,
    clipId,
    {
      kind: 'lut',
      label: 'Color look',
      suffix: name.replace(/[^\w\- ]+/g, '').trim() || 'look',
      ext: '.mp4',
      run: async (ctx) => {
        const lut3d = `lut3d=file=${filterPath(lutFile)}:interp=tetrahedral`;
        const scale = `scale=${ctx.size.w}:${ctx.size.h}`;
        // below full strength, mix the graded picture with the original
        await encode(ctx, k >= 0.999 ? `${scale},${lut3d}` : `${scale},split[a][b];[b]${lut3d}[c];[a][c]blend=all_expr=A*${(1 - k).toFixed(3)}+B*${k.toFixed(3)}`, ctx.out);
        return k >= 0.999 ? name : `${name} at ${Math.round(k * 100)}%`;
      },
    },
    source,
    signal,
  );
};

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

/** The beats of a music asset (found once, then kept with the asset). */
export const beatsFor = async (projectId: string, assetId: string, signal?: AbortSignal): Promise<BeatAnalysis> => {
  const p = await store.get(projectId);
  const a = p.assets.find((x) => x.id === assetId);
  if (!a || (a.kind !== 'audio' && a.kind !== 'video')) throw new Error('Pick a music clip');
  if (a.analysis.beats?.length && a.analysis.tempo) return { tempo: a.analysis.tempo, beats: a.analysis.beats, confidence: 0 };
  const found = trackBeats(onsets(await audioLoudness(store.mediaPath(projectId, a.file), signal)), LOUDNESS_RATE);
  if (!found) throw new Error(`${a.name} is too short to find a beat in`);
  await store.update(
    projectId,
    'Beats found',
    (d) => {
      const x = d.assets.find((y) => y.id === assetId);
      if (x) x.analysis = { ...x.analysis, beats: found.beats, tempo: found.tempo };
    },
    { history: false, source: 'system' },
  );
  return found;
};

const isMusic = (c: Clip): c is AudioClip => c.type === 'audio' && c.role === 'music';

/**
 * Re-time clips so each starts on a beat of the music and lasts whole beats (about as long as before,
 * or `every` beats), back to back from the beat nearest the first one. One undo step.
 */
export const cutToBeat = async (projectId: string, clipIds: string[], opts: { every?: number; musicClipId?: string } = {}, source: Source = 'user', signal?: AbortSignal) => {
  let p = await store.get(projectId);
  const refs = clipIds.map((id) => ({ id, ref: p.tracks.find((t) => t.clips.some((c) => c.id === id)) }));
  const missing = refs.find((r) => !r.ref);
  if (missing) throw new Error(`Clip ${missing.id} not found`);
  const trackIds = new Set(refs.map((r) => r.ref!.id));
  if (trackIds.size > 1) throw new Error('Pick clips on one track (the b-roll or pictures to cut to the music)');
  const chosen = clipIds.map((id) => clipOf(p, id)!).sort((a, b) => a.start - b.start);
  if (chosen.some((c) => c.type === 'audio' || c.type === 'captions')) throw new Error('Cut pictures and video to the beat, not sound or captions');
  const span: [number, number] = [chosen[0]!.start, clipEnd(chosen[chosen.length - 1]!)];
  const music =
    (opts.musicClipId ? p.tracks.flatMap((t) => t.clips).find((c) => c.id === opts.musicClipId) : undefined) ??
    p.tracks
      .flatMap((t) => t.clips)
      .filter(isMusic)
      .sort((a, b) => Math.max(0, Math.min(clipEnd(b), span[1]) - Math.max(b.start, span[0])) - Math.max(0, Math.min(clipEnd(a), span[1]) - Math.max(a.start, span[0])))[0];
  if (!music || music.type !== 'audio') throw new Error('Add music first: cutting to the beat needs a music clip (role "music") on the timeline');
  const analysis = await beatsFor(projectId, music.assetId, signal);
  p = await store.get(projectId);
  const asset = p.assets.find((a) => a.id === music.assetId);
  const beats = timelineBeats(music, analysis.beats, asset?.meta.duration);
  if (beats.length < 2) throw new Error('The music clip has no beats where these clips are');
  const plan = planBeatCuts(
    chosen.map((c) => {
      const src = c.type === 'video' ? p.assets.find((a) => a.id === c.assetId)?.meta.duration : undefined;
      return { id: c.id, start: c.start, duration: c.duration, ...(c.type === 'video' && src ? { maxDuration: (src - c.trimStart) / c.speed } : {}) };
    }),
    beats,
    { every: opts.every },
  );
  const trackId = [...trackIds][0]!;
  const ops: EditOp[] = [
    { op: 'removeClips', clipIds: chosen.map((c) => c.id) },
    ...plan.map((n) => ({ op: 'addClip' as const, trackId, clip: { ...structuredClone(chosen.find((c) => c.id === n.id)!), start: n.start, duration: n.duration } as never })),
  ];
  try {
    applyOps(structuredClone(p), ops);
  } catch (err) {
    throw new Error(`The clips cut to the beat would not fit on their track (${(err as Error).message}); pick the clips that come after them too, or make room`);
  }
  await store.update(projectId, 'Cut to the beat', (d) => void applyOps(d, ops), { source });
  return { tempo: analysis.tempo, clips: plan.length, summary: `${plan.length} clip${plan.length === 1 ? '' : 's'} now change on the beat (${Math.round(analysis.tempo)} BPM), from ${plan[0]!.start.toFixed(2)}s to ${(plan.at(-1)!.start + plan.at(-1)!.duration).toFixed(2)}s` };
};

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import {
  ensureBrowser,
  makeCancelSignal,
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
  type HeadlessBrowser,
} from '@remotion/renderer';
import { RenderRecordSchema, type CompositionInput, type Project, type RenderRecord, type ThumbnailInput } from '../../shared/schema';
import { captionWords, projectDuration, timelineWords } from '../../shared/timeline';
import { uid } from '../../shared/ids';
import { APP_ROOT, CACHE_DIR, getSettings } from '../config';
import { bus } from '../events';
import { store } from '../storage/projects';
import { normalizeLoudness, probe } from '../media/ffmpeg';
import { wordsToSrt } from '../services/documents';
import { resolveBrowserExecutable } from './browser';

// ---------------------------------------------------------------------------
// Origin the headless browser uses to fetch media from this server
// ---------------------------------------------------------------------------

let serverOrigin = 'http://127.0.0.1:3333';
export const setServerOrigin = (origin: string) => {
  serverOrigin = origin.replace(/\/$/, '');
};
export const getServerOrigin = () => serverOrigin;

export const assetUrlMap = (project: Project, base: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const a of project.assets) out[a.id] = `${base}/media/${project.id}/${encodeURIComponent(a.file)}`;
  return out;
};

export const buildCompositionInput = async (project: Project, mode: CompositionInput['mode'], base = serverOrigin): Promise<CompositionInput> => ({
  project,
  assetUrls: assetUrlMap(project, base),
  transcripts: await store.transcriptsFor(project),
  mode,
});

// ---------------------------------------------------------------------------
// Bundle (cached by a hash of the composition sources)
// ---------------------------------------------------------------------------

const SOURCE_DIRS = [path.join(APP_ROOT, 'src', 'remotion'), path.join(APP_ROOT, 'src', 'shared')];

const hashSources = (): string => {
  const h = crypto.createHash('sha1');
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|css|json)$/.test(e.name) && !e.name.includes('.test.')) {
        h.update(p);
        h.update(fs.readFileSync(p));
      }
    }
  };
  for (const d of SOURCE_DIRS) if (fs.existsSync(d)) walk(d);
  h.update(JSON.stringify(Object.keys(JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).dependencies ?? {})));
  return h.digest('hex').slice(0, 12);
};

let bundleState: { hash: string; promise: Promise<string> } | null = null;

export const getBundle = (onProgress?: (p: number) => void): Promise<string> => {
  const hash = hashSources();
  if (bundleState && bundleState.hash === hash) return bundleState.promise;
  const outDir = path.join(CACHE_DIR, `bundle-${hash}`);
  const promise = (async () => {
    if (fs.existsSync(path.join(outDir, 'index.html'))) return outDir;
    const tmp = `${outDir}.tmp-${process.pid}`;
    await fsp.rm(tmp, { recursive: true, force: true });
    const started = Date.now();
    await bundle({ entryPoint: path.join(APP_ROOT, 'src', 'remotion', 'index.ts'), outDir: tmp, onProgress: (p) => onProgress?.(p / 100), enableCaching: true });
    await fsp.rm(outDir, { recursive: true, force: true });
    await fsp.rename(tmp, outDir);
    // drop older bundles
    for (const d of await fsp.readdir(CACHE_DIR)) if (d.startsWith('bundle-') && d !== `bundle-${hash}`) await fsp.rm(path.join(CACHE_DIR, d), { recursive: true, force: true }).catch(() => undefined);
    console.log(`[render] composition bundled in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return outDir;
  })();
  bundleState = { hash, promise };
  promise.catch(() => {
    if (bundleState?.promise === promise) bundleState = null;
  });
  return promise;
};

// ---------------------------------------------------------------------------
// Browser (shared for stills; renders open their own)
// ---------------------------------------------------------------------------

let browserReady: Promise<string | null> | null = null;

/** Returns an explicit executable, or null after making sure Remotion's own browser is installed. */
export const prepareBrowser = (): Promise<string | null> => {
  if (!browserReady) {
    browserReady = (async () => {
      const explicit = resolveBrowserExecutable(getSettings().render.browserExecutable);
      if (explicit) return explicit;
      await ensureBrowser({
        onBrowserDownload: () => {
          console.log('[render] downloading Chrome Headless Shell (one-time)…');
          return { onProgress: () => undefined, version: null };
        },
      });
      return null;
    })();
    browserReady.catch(() => (browserReady = null));
  }
  return browserReady;
};

let stillBrowser: { promise: Promise<HeadlessBrowser>; timer: NodeJS.Timeout | null } | null = null;

const getStillBrowser = async (): Promise<HeadlessBrowser> => {
  if (!stillBrowser) {
    const exe = await prepareBrowser();
    stillBrowser = { promise: openBrowser('chrome', { browserExecutable: exe }), timer: null };
    stillBrowser.promise.catch(() => (stillBrowser = null));
  }
  if (stillBrowser.timer) clearTimeout(stillBrowser.timer);
  const current = stillBrowser;
  current.timer = setTimeout(() => {
    void current.promise.then((b) => b.close({ silent: true })).catch(() => undefined);
    if (stillBrowser === current) stillBrowser = null;
  }, 120_000);
  return current.promise;
};

// ---------------------------------------------------------------------------
// Video renders
// ---------------------------------------------------------------------------

export const RENDER_PRESETS = {
  draft: { scale: 0.5, crf: 28, x264Preset: 'veryfast', jpegQuality: 70, label: 'Draft (half resolution, fast)' },
  standard: { scale: 1, crf: 20, x264Preset: 'medium', jpegQuality: 88, label: 'Standard (full resolution)' },
  high: { scale: 1, crf: 16, x264Preset: 'slow', jpegQuality: 95, label: 'High quality (larger file)' },
  '4k': { scale: 2, crf: 18, x264Preset: 'medium', jpegQuality: 92, label: '4K (2x canvas size)' },
} as const;
export type RenderPreset = keyof typeof RENDER_PRESETS;

interface ActiveRender {
  projectId: string;
  record: RenderRecord;
  cancel: () => void;
}

const active = new Map<string, ActiveRender>();
let queue: Promise<unknown> = Promise.resolve();

const saveRecord = async (projectId: string, record: RenderRecord) => {
  bus.emit(projectId, { type: 'render', render: record });
  await store.update(
    projectId,
    'Render status',
    (p) => {
      const i = p.renders.findIndex((r) => r.id === record.id);
      if (i >= 0) p.renders[i] = record;
      else p.renders.unshift(record);
      p.renders = p.renders.slice(0, 30);
    },
    { history: false, source: 'system' },
  );
};

export interface RenderOptions {
  preset?: RenderPreset;
  /** Render only part of the timeline (seconds) */
  range?: [number, number];
  normalize?: boolean;
}

export const startRender = async (projectId: string, opts: RenderOptions = {}): Promise<RenderRecord> => {
  const project = await store.get(projectId);
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty — add clips before rendering.');
  const preset = opts.preset ?? getSettings().render.quality;
  const record = RenderRecordSchema.parse({ id: uid('render'), kind: 'video', createdAt: new Date().toISOString(), status: 'queued', progress: 0, preset });
  await saveRecord(projectId, record);
  const { cancelSignal, cancel } = makeCancelSignal();
  let cancelled = false;
  active.set(record.id, {
    projectId,
    record,
    cancel: () => {
      cancelled = true;
      cancel();
    },
  });

  const run = async () => {
    const started = Date.now();
    const update = async (patch: Partial<RenderRecord>) => {
      Object.assign(record, patch);
      await saveRecord(projectId, { ...record });
    };
    try {
      if (cancelled) throw new Error('Cancelled');
      await update({ status: 'bundling', progress: 0 });
      const serveUrl = await getBundle();
      const browserExecutable = await prepareBrowser();
      const fresh = await store.get(projectId);
      const inputProps = await buildCompositionInput(fresh, 'render');
      const composition = await selectComposition({ serveUrl, id: 'Main', inputProps, browserExecutable, logLevel: 'error' });
      const p = RENDER_PRESETS[preset as RenderPreset] ?? RENDER_PRESETS.standard;
      const fps = composition.fps;
      const frameRange: [number, number] | null = opts.range
        ? [Math.max(0, Math.round(opts.range[0] * fps)), Math.min(composition.durationInFrames - 1, Math.round(opts.range[1] * fps) - 1)]
        : null;
      const raw = store.renderPath(projectId, `${record.id}.raw.mp4`);
      const final = store.renderPath(projectId, `${record.id}.mp4`);
      await fsp.mkdir(path.dirname(raw), { recursive: true });
      await update({ status: 'rendering', progress: 0, width: Math.round(composition.width * p.scale), height: Math.round(composition.height * p.scale) });
      let lastEmit = 0;
      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: raw,
        inputProps,
        browserExecutable,
        crf: p.crf,
        x264Preset: p.x264Preset,
        jpegQuality: p.jpegQuality,
        scale: p.scale,
        pixelFormat: 'yuv420p',
        audioCodec: 'aac',
        audioBitrate: '320k',
        frameRange,
        concurrency: getSettings().render.concurrency ?? null,
        cancelSignal,
        logLevel: 'error',
        enforceAudioTrack: true,
        onBrowserLog: (log) => {
          if (log.text.includes('[DIRECTOR_SCENE_ERROR]')) bus.toast(projectId, 'warning', log.text.replace('[DIRECTOR_SCENE_ERROR] ', 'Scene error: '));
        },
        onProgress: ({ progress }) => {
          const now = Date.now();
          if (now - lastEmit > 300) {
            lastEmit = now;
            record.progress = Math.min(0.97, progress * 0.95);
            bus.emit(projectId, { type: 'render', render: { ...record } });
          }
        },
      });
      await update({ status: 'finishing', progress: 0.96 });
      const normalize = opts.normalize ?? fresh.audio.normalize;
      if (normalize) {
        try {
          await normalizeLoudness(raw, final, fresh.audio.loudnessTarget);
          await fsp.rm(raw, { force: true });
        } catch (err) {
          console.warn('[render] loudness normalization failed, keeping raw render:', (err as Error).message);
          await fsp.rename(raw, final);
        }
      } else await fsp.rename(raw, final);
      // captions file next to the video (handy for YouTube upload)
      const transcripts = inputProps.transcripts;
      const capClip = fresh.tracks.flatMap((t) => t.clips).find((c) => c.type === 'captions');
      const words = capClip && capClip.type === 'captions' ? captionWords(fresh, capClip, transcripts) : timelineWords(fresh, transcripts);
      const offset = opts.range?.[0] ?? 0;
      const inRange = words.filter((w) => !opts.range || (w.start >= opts.range[0] && w.end <= opts.range[1])).map((w) => ({ ...w, start: w.start - offset, end: w.end - offset }));
      if (inRange.length) await fsp.writeFile(store.renderPath(projectId, `${record.id}.srt`), wordsToSrt(inRange));
      const info = await probe(final).catch(() => null);
      const stat = await fsp.stat(final);
      await update({ status: 'done', progress: 1, file: `${record.id}.mp4`, sizeBytes: stat.size, durationSec: info?.duration ?? duration, elapsedSec: Math.round((Date.now() - started) / 100) / 10 });
      bus.toast(projectId, 'success', `Render finished (${(stat.size / 1e6).toFixed(1)} MB)`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const isCancel = cancelled || /cancel/i.test(msg);
      await update({ status: isCancel ? 'cancelled' : 'error', error: isCancel ? undefined : msg.slice(0, 600) });
      if (!isCancel) bus.toast(projectId, 'error', `Render failed: ${msg.slice(0, 160)}`);
    } finally {
      active.delete(record.id);
      await fsp.rm(store.renderPath(projectId, `${record.id}.raw.mp4`), { force: true }).catch(() => undefined);
    }
  };
  queue = queue.then(run, run);
  return record;
};

export const cancelRender = (renderId: string): boolean => {
  const a = active.get(renderId);
  if (!a) return false;
  a.cancel();
  return true;
};

/** Waits for a render to finish (used by agent tools and MCP). */
export const waitForRender = async (projectId: string, renderId: string, timeoutMs = 60 * 60_000): Promise<RenderRecord> => {
  const started = Date.now();
  for (;;) {
    const p = await store.get(projectId);
    const r = p.renders.find((x) => x.id === renderId);
    if (r && (r.status === 'done' || r.status === 'error' || r.status === 'cancelled')) return r;
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for render');
    await new Promise((res) => setTimeout(res, 1000));
  }
};

// ---------------------------------------------------------------------------
// Stills (visual QA) and thumbnails
// ---------------------------------------------------------------------------

export interface StillFrame {
  time: number;
  file: string;
  jpeg: Buffer;
}

export const renderFrames = async (projectId: string, times: number[], opts: { scale?: number; project?: Project } = {}): Promise<{ frames: StillFrame[]; errors: string[] }> => {
  const project = opts.project ?? (await store.get(projectId));
  const serveUrl = await getBundle();
  const browser = await getStillBrowser();
  const inputProps = await buildCompositionInput(project, 'still');
  const composition = await selectComposition({ serveUrl, id: 'Main', inputProps, puppeteerInstance: browser, logLevel: 'error' });
  const dir = path.join(store.rendersDir(projectId), 'frames');
  await fsp.mkdir(dir, { recursive: true });
  const frames: StillFrame[] = [];
  const errors: string[] = [];
  for (const t of times) {
    const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(t * composition.fps)));
    const file = path.join(dir, `f-${Date.now()}-${frame}.jpg`);
    try {
      await renderStill({
        composition,
        serveUrl,
        inputProps,
        frame,
        output: file,
        imageFormat: 'jpeg',
        jpegQuality: 80,
        scale: opts.scale ?? Math.min(1, 960 / composition.width),
        puppeteerInstance: browser,
        logLevel: 'error',
        onBrowserLog: (log) => {
          if (log.text.includes('[DIRECTOR_SCENE_ERROR]')) errors.push(`@${t.toFixed(2)}s ${log.text.replace('[DIRECTOR_SCENE_ERROR] ', '')}`);
        },
      });
      frames.push({ time: t, file: path.relative(store.rendersDir(projectId), file), jpeg: await fsp.readFile(file) });
    } catch (err) {
      errors.push(`@${t.toFixed(2)}s ${(err as Error).message.split('\n')[0]}`);
    }
  }
  // keep the frames folder small
  const all = (await fsp.readdir(dir)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 60))) await fsp.rm(path.join(dir, f), { force: true });
  return { frames, errors };
};

export const renderThumbnail = async (projectId: string): Promise<string> => {
  const project = await store.get(projectId);
  const serveUrl = await getBundle();
  const browser = await getStillBrowser();
  const input: ThumbnailInput = { project, assetUrls: assetUrlMap(project, serveUrlOrigin()), thumbnail: project.youtube.thumbnail };
  const composition = await selectComposition({ serveUrl, id: 'Thumbnail', inputProps: input, puppeteerInstance: browser, logLevel: 'error' });
  const file = `thumbnail-${Date.now()}.png`;
  const out = store.mediaPath(projectId, file);
  await renderStill({ composition, serveUrl, inputProps: input, output: out, imageFormat: 'png', puppeteerInstance: browser, logLevel: 'error' });
  await store.update(
    projectId,
    'Thumbnail rendered',
    async (p) => {
      const old = p.youtube.thumbnail.file;
      p.youtube.thumbnail.file = file;
      if (old && old !== file) await fsp.rm(store.mediaPath(projectId, old), { force: true }).catch(() => undefined);
    },
    { history: false, source: 'system' },
  );
  return out;
};

const serveUrlOrigin = () => serverOrigin;

/** Warm the bundle in the background so the first render/QA frame is fast. */
export const warmup = () => {
  void getBundle().catch((err) => console.warn('[render] bundle warmup failed:', (err as Error).message));
};

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AssetSchema, type Asset, type AssetKind } from '../../shared/schema';
import { uid } from '../../shared/ids';
import { getSettings } from '../config';
import { bus } from '../events';
import { analysisQueue, transcriptionQueue } from '../jobs';
import { store } from '../storage/projects';
import { DOCUMENT_EXTENSIONS, extractDocumentText, parseSubtitles } from '../services/documents';
import { probe, thumbnail, waveformPeaks } from './ffmpeg';

const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mts', '.m2ts', '.3gp', '.wmv', '.flv', '.mpg', '.mpeg'];
const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.aiff', '.aif', '.wma', '.weba'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.svg', '.heic', '.tif', '.tiff'];

export const kindFromName = (name: string, mime = ''): AssetKind => {
  const ext = path.extname(name).toLowerCase();
  if (VIDEO_EXT.includes(ext) || mime.startsWith('video/')) return 'video';
  if (AUDIO_EXT.includes(ext) || mime.startsWith('audio/')) return 'audio';
  if (IMAGE_EXT.includes(ext) || mime.startsWith('image/')) return 'image';
  if (DOCUMENT_EXTENSIONS.includes(ext) || mime.startsWith('text/') || mime === 'application/pdf') return 'document';
  return 'other';
};

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv', '.srt': 'application/x-subrip', '.vtt': 'text/vtt', '.html': 'text/html',
};
export const mimeFor = (name: string): string => MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';

const safeName = (name: string) => path.basename(name).replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 120) || 'file';

export interface RegisterOptions {
  /** existing file on disk to take over */
  sourcePath: string;
  originalName: string;
  /** move (default) or copy the source file */
  copy?: boolean;
  origin?: Asset['origin'];
  description?: string;
  tags?: string[];
  source?: Asset['source'];
  voice?: Asset['voice'];
  /** pre-computed word timings (e.g. from TTS) */
  words?: { text: string; start: number; end: number }[];
  /** wait for probing/thumbnails before resolving */
  wait?: boolean;
  /** label for the history entry */
  label?: string;
  updateSource?: 'user' | 'agent' | 'system' | 'mcp';
}

/** Adds a file to the project media folder, registers the asset and queues analysis. */
export const registerAsset = async (projectId: string, opts: RegisterOptions): Promise<Asset> => {
  const id = uid('asset');
  let ext = path.extname(opts.originalName).toLowerCase() || path.extname(opts.sourcePath).toLowerCase();
  if (ext === '.jpeg') ext = '.jpg';
  const file = `${id}${ext}`;
  const dest = store.mediaPath(projectId, file);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (opts.copy) await fsp.copyFile(opts.sourcePath, dest);
  else {
    try {
      await fsp.rename(opts.sourcePath, dest);
    } catch {
      await fsp.copyFile(opts.sourcePath, dest);
      await fsp.rm(opts.sourcePath, { force: true });
    }
  }
  const stat = await fsp.stat(dest);
  const asset = AssetSchema.parse({
    id,
    name: safeName(opts.originalName),
    kind: kindFromName(opts.originalName),
    file,
    mime: mimeFor(opts.originalName),
    size: stat.size,
    origin: opts.origin ?? 'upload',
    createdAt: new Date().toISOString(),
    status: 'processing',
    description: opts.description,
    tags: opts.tags ?? [],
    source: opts.source,
    voice: opts.voice,
  });
  if (opts.words?.length) {
    const tf = await store.writeTranscript(projectId, id, opts.words);
    asset.transcript = { status: 'done', engine: 'tts-alignment', file: tf, wordCount: opts.words.length, preview: opts.words.slice(0, 40).map((w) => w.text).join(' ') };
  }
  await store.update(projectId, opts.label ?? `Add ${asset.name}`, (p) => void p.assets.push(asset), { source: opts.updateSource ?? 'system' });
  const job = analysisQueue.add(projectId, `Analyzing ${asset.name}`, () => analyzeAsset(projectId, id));
  if (opts.wait) {
    await job.catch(() => undefined);
    return (await store.get(projectId)).assets.find((a) => a.id === id) ?? asset;
  }
  job.catch((err) => console.warn(`[ingest] analysis failed for ${id}:`, err.message));
  return asset;
};

const patchAsset = (projectId: string, assetId: string, label: string, fn: (a: Asset) => void) =>
  store.update(
    projectId,
    label,
    (p) => {
      const a = p.assets.find((x) => x.id === assetId);
      if (a) fn(a);
    },
    { history: false, source: 'system' },
  );

export const analyzeAsset = async (projectId: string, assetId: string): Promise<void> => {
  const project = await store.get(projectId);
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) return;
  const file = store.mediaPath(projectId, asset.file);
  try {
    if (asset.kind === 'document' || asset.kind === 'other') {
      const ext = path.extname(asset.file).toLowerCase();
      if (DOCUMENT_EXTENSIONS.includes(ext)) {
        const { text, pages, title } = await extractDocumentText(file);
        const textFile = `${assetId}.txt`;
        await fsp.writeFile(store.mediaPath(projectId, textFile), text);
        await patchAsset(projectId, assetId, 'Document analyzed', (a) => {
          a.status = 'ready';
          a.kind = 'document';
          a.text = { file: textFile, chars: text.length, preview: text.slice(0, 500) };
          if (title && !a.description) a.description = title;
          if (pages) a.tags = [...new Set([...a.tags, `${pages} pages`])];
          if (ext === '.srt' || ext === '.vtt') a.tags = [...new Set([...a.tags, 'subtitles'])];
        });
      } else {
        await patchAsset(projectId, assetId, 'Asset ready', (a) => void (a.status = 'ready'));
      }
      return;
    }
    const info = await probe(file);
    let thumbFile: string | undefined;
    if (info.hasVideo || info.isImage || asset.kind === 'image') {
      thumbFile = `${assetId}.thumb.jpg`;
      const at = info.duration ? Math.min(info.duration * 0.15, 3) : 0;
      await thumbnail(file, store.mediaPath(projectId, thumbFile), at).catch(() => (thumbFile = undefined));
    }
    let peaksFile: string | undefined;
    if (info.hasAudio && info.duration) {
      peaksFile = `${assetId}.peaks.json`;
      const peaks = await waveformPeaks(file).catch(() => null);
      if (peaks) await fsp.writeFile(store.mediaPath(projectId, peaksFile), JSON.stringify(peaks));
      else peaksFile = undefined;
    }
    await patchAsset(projectId, assetId, 'Media analyzed', (a) => {
      a.status = 'ready';
      a.kind = info.isImage ? 'image' : info.hasVideo ? 'video' : info.hasAudio ? 'audio' : a.kind;
      a.meta = { duration: info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio, hasVideo: info.hasVideo, codec: info.codec };
      a.thumb = thumbFile;
      a.waveform = peaksFile;
    });
    const settings = getSettings();
    const fresh = (await store.get(projectId)).assets.find((a) => a.id === assetId);
    if (
      fresh &&
      settings.speech.autoTranscribe &&
      info.hasAudio &&
      fresh.transcript.status === 'none' &&
      (fresh.origin === 'upload' || fresh.origin === 'url') &&
      (info.duration ?? 0) > 1.5
    ) {
      void queueTranscription(projectId, assetId).catch(() => undefined);
    }
  } catch (err) {
    await patchAsset(projectId, assetId, 'Asset failed', (a) => {
      a.status = 'error';
      a.error = (err as Error).message.slice(0, 300);
    });
    throw err;
  }
};

/** Queue a transcription (no-op if no engine is available). Resolves with the word count. */
export const queueTranscription = async (projectId: string, assetId: string, opts: { language?: string; force?: boolean } = {}): Promise<number> => {
  const { transcribeFile, pickTranscriptionEngine } = await import('../services/transcribe');
  const engine = await pickTranscriptionEngine(getSettings());
  if (!engine) {
    if (opts.force) throw new Error('No transcription engine available. Add an OpenAI/Groq/ElevenLabs key in Settings, or install the local Whisper model (Settings → Speech).');
    return 0;
  }
  const project = await store.get(projectId);
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  // Subtitles uploaded alongside are cheaper and more accurate than transcription
  await patchAsset(projectId, assetId, 'Transcribing', (a) => {
    a.transcript = { ...a.transcript, status: 'pending', engine: engine.id, error: undefined };
  });
  return transcriptionQueue.add(projectId, `Transcribing ${asset.name} (${engine.label})`, async (report) => {
    try {
      const result = await transcribeFile(store.mediaPath(projectId, asset.file), engine, { language: opts.language ?? getSettings().speech.language, onProgress: (p) => report(p) });
      const tf = await store.writeTranscript(projectId, assetId, result.words);
      await patchAsset(projectId, assetId, 'Transcript ready', (a) => {
        a.transcript = { status: 'done', engine: engine.id, language: result.language, file: tf, wordCount: result.words.length, preview: result.words.slice(0, 60).map((w) => w.text).join(' ') };
      });
      bus.toast(projectId, 'success', `Transcribed ${asset.name} (${result.words.length} words)`);
      return result.words.length;
    } catch (err) {
      await patchAsset(projectId, assetId, 'Transcript failed', (a) => {
        a.transcript = { ...a.transcript, status: 'error', error: (err as Error).message.slice(0, 300) };
      });
      throw err;
    }
  });
};

/** Use an uploaded .srt/.vtt document as the transcript of a media asset. */
export const attachSubtitles = async (projectId: string, mediaAssetId: string, subtitleAssetId: string): Promise<number> => {
  const project = await store.get(projectId);
  const sub = project.assets.find((a) => a.id === subtitleAssetId);
  if (!sub) throw new Error(`Subtitle asset ${subtitleAssetId} not found`);
  const raw = await fsp.readFile(store.mediaPath(projectId, sub.file), 'utf8');
  const { cuesToWords } = await import('../services/documents');
  const words = cuesToWords(parseSubtitles(raw));
  if (!words.length) throw new Error('No subtitle cues found');
  const tf = await store.writeTranscript(projectId, mediaAssetId, words);
  await patchAsset(projectId, mediaAssetId, 'Subtitles attached', (a) => {
    a.transcript = { status: 'done', engine: 'subtitles', file: tf, wordCount: words.length, preview: words.slice(0, 60).map((w) => w.text).join(' ') };
  });
  return words.length;
};

/** Download a URL into the project (used for stock media and generated images). */
export const downloadToProject = async (
  projectId: string,
  url: string,
  name: string,
  opts: Omit<RegisterOptions, 'sourcePath' | 'originalName'> = {},
): Promise<Asset> => {
  const res = await fetch(url, { headers: { 'User-Agent': 'DirectorStudio/1.0' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const tmp = path.join(store.mediaDir(projectId), `.dl-${uid('t')}${path.extname(name) || ''}`);
  await fsp.mkdir(path.dirname(tmp), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(tmp, buf);
  return registerAsset(projectId, { ...opts, sourcePath: tmp, originalName: name });
};

export const fileSize = (p: string) => {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
};

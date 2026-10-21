import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Word } from '../../../shared/schema';
import { formatTime, summarizeAsset } from '../../../shared/timeline';
import { applyOp } from '../../../shared/ops';
import { store } from '../../storage/projects';
import { queueTranscription } from '../../media/ingest';
import { detectScenes, detectSilence, extractFrames, measureLoudness, resizeImage } from '../../media/ffmpeg';
import { defineTool, j } from '../types';
import { getProject, mutate } from './helpers';

const SENTENCE_END = /[.!?…]["')\]]?$/;

export interface Sentence {
  index: number;
  start: number;
  end: number;
  fromWord: number;
  toWord: number;
  text: string;
}

export const toSentences = (words: Word[]): Sentence[] => {
  const out: Sentence[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (!cur.length) return;
    const ws = cur.map((i) => words[i]!);
    out.push({ index: out.length, start: ws[0]!.start, end: ws[ws.length - 1]!.end, fromWord: cur[0]!, toWord: cur[cur.length - 1]!, text: ws.map((w) => w.text).join(' ') });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && prev && (w.start - prev.end > 1.2 || cur.length >= 40)) flush();
    cur.push(i);
    if (SENTENCE_END.test(w.text.trim())) flush();
  });
  flush();
  return out;
};

export const inspectAssets = defineTool({
  name: 'inspect_assets',
  category: 'media',
  readOnly: true,
  description: 'List project assets (no ids) or get full details for specific assets: metadata, analysis, transcript status/preview, document preview, description, source/license.',
  schema: z.object({ assetIds: z.array(z.string()).optional(), kind: z.enum(['video', 'audio', 'image', 'document', 'other']).optional() }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    if (!input.assetIds?.length) {
      const list = p.assets.filter((a) => !input.kind || a.kind === input.kind);
      return { text: list.length ? list.map((a) => `- ${summarizeAsset(a)}`).join('\n') : 'No assets yet. Ask the user to upload media (ask_user with kind "files") or use stock/generated media.', summary: `${list.length} assets` };
    }
    const out = input.assetIds.map((id) => {
      const a = p.assets.find((x) => x.id === id);
      if (!a) return { id, error: 'not found' };
      const usedIn = p.tracks.flatMap((t) => t.clips.filter((c) => 'assetId' in c && c.assetId === id).map((c) => `${c.id}@${t.name} ${c.start}-${(c.start + c.duration).toFixed(2)}s`));
      return { ...a, usedIn };
    });
    return { text: j(out), summary: `${out.length} asset(s)` };
  },
});

export const getTranscript = defineTool({
  name: 'get_transcript',
  category: 'media',
  readOnly: true,
  description:
    'Read the transcript of an audio/video asset with timestamps (source time). Format "sentences" (default) gives [s#] start–end and word-index ranges (w#-#) for precise cuts; "words" gives every word with times; "text" plain text. Paginate long transcripts with from/to (seconds) or offset.',
  schema: z.object({
    assetId: z.string(),
    format: z.enum(['sentences', 'words', 'text']).default('sentences'),
    from: z.number().optional(),
    to: z.number().optional(),
    offset: z.number().int().min(0).default(0).describe('Skip this many sentences/words'),
    maxChars: z.number().int().min(500).max(60000).default(16000),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const a = p.assets.find((x) => x.id === input.assetId);
    if (!a) return { text: `Asset ${input.assetId} not found`, isError: true };
    const words = await store.readTranscript(ctx.projectId, input.assetId);
    if (!words) return { text: `No transcript for ${a.name} (status: ${a.transcript.status}${a.transcript.error ? `, error: ${a.transcript.error}` : ''}). Run the transcribe tool first.`, isError: true };
    const inRange = (s: number, e: number) => (input.from === undefined || e > input.from) && (input.to === undefined || s < input.to);
    let out = '';
    let shown = 0;
    let total = 0;
    if (input.format === 'words') {
      const list = words.map((w, i) => ({ ...w, i })).filter((w) => inRange(w.start, w.end));
      total = list.length;
      for (const w of list.slice(input.offset)) {
        const line = `${w.i}:${w.text}@${w.start.toFixed(2)}-${w.end.toFixed(2)} `;
        if (out.length + line.length > input.maxChars) break;
        out += line;
        shown++;
      }
    } else if (input.format === 'text') {
      const text = words.filter((w) => inRange(w.start, w.end)).map((w) => w.text).join(' ');
      total = text.length;
      out = text.slice(input.offset, input.offset + input.maxChars);
      shown = out.length;
    } else {
      const sentences = toSentences(words).filter((s) => inRange(s.start, s.end));
      total = sentences.length;
      for (const s of sentences.slice(input.offset)) {
        const line = `[s${s.index} ${formatTime(s.start)}–${formatTime(s.end)} w${s.fromWord}-${s.toWord}] ${s.text}\n`;
        if (out.length + line.length > input.maxChars) break;
        out += line;
        shown++;
      }
    }
    const more = input.offset + shown < total ? `\n… ${total - input.offset - shown} more (use offset=${input.offset + shown})` : '';
    return { text: `Transcript of ${a.name} (${words.length} words, ${formatTime(a.meta.duration ?? 0)}):\n${out}${more}`, summary: `${shown} ${input.format}` };
  },
});

export const searchTranscript = defineTool({
  name: 'search_transcript',
  category: 'media',
  readOnly: true,
  description: 'Find where something is said: case-insensitive phrase search across transcripts (all assets or one). Returns asset, source times, word indices and context.',
  schema: z.object({ query: z.string().min(1), assetId: z.string().optional(), maxResults: z.number().int().min(1).max(50).default(15) }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const q = input.query.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, '').split(/\s+/).filter(Boolean);
    const results: string[] = [];
    for (const a of p.assets) {
      if (input.assetId && a.id !== input.assetId) continue;
      const words = await store.readTranscript(ctx.projectId, a.id);
      if (!words) continue;
      const norm = words.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''));
      for (let i = 0; i + q.length <= norm.length && results.length < input.maxResults; i++) {
        if (q.every((t, k) => norm[i + k]!.startsWith(t) && (k < q.length - 1 ? norm[i + k] === t : true))) {
          const ctxText = words.slice(Math.max(0, i - 8), Math.min(words.length, i + q.length + 8)).map((w) => w.text).join(' ');
          results.push(`${a.id} w${i}-${i + q.length - 1} @ ${words[i]!.start.toFixed(2)}–${words[i + q.length - 1]!.end.toFixed(2)}s: "…${ctxText}…"`);
        }
      }
    }
    return { text: results.length ? results.join('\n') : `No match for "${input.query}".`, summary: `${results.length} match(es)` };
  },
});

export const transcribe = defineTool({
  name: 'transcribe',
  category: 'media',
  description: 'Transcribe an audio/video asset (word-level timestamps) and wait for it. Needed for captions, auto_cut and transcript-based editing. Uses the configured engine (cloud Whisper/Scribe or local).',
  schema: z.object({ assetId: z.string(), language: z.string().optional().describe('ISO code, e.g. "en", "es"; omit for the project default') }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const a = p.assets.find((x) => x.id === input.assetId);
    if (!a) return { text: `Asset ${input.assetId} not found`, isError: true };
    if (a.transcript.status === 'done') return { text: `Already transcribed (${a.transcript.wordCount} words): "${a.transcript.preview?.slice(0, 300)}…"`, summary: 'already done' };
    ctx.progress(`Transcribing ${a.name}…`);
    const count = await queueTranscription(ctx.projectId, a.id, { language: input.language, force: true });
    const fresh = (await getProject(ctx)).assets.find((x) => x.id === a.id);
    return { text: `Transcribed ${a.name}: ${count} words. Preview: "${fresh?.transcript.preview?.slice(0, 400) ?? ''}…"`, summary: `${count} words` };
  },
});

export const analyzeMedia = defineTool({
  name: 'analyze_media',
  category: 'media',
  readOnly: true,
  description: 'Analyze an audio/video asset with FFmpeg: silences (pauses), scene cuts (shot changes) and loudness (LUFS). Results are saved on the asset.',
  schema: z.object({
    assetId: z.string(),
    detect: z.array(z.enum(['silences', 'scenes', 'loudness'])).default(['silences']),
    silenceDb: z.number().default(-35).describe('Noise floor for silence detection (dB)'),
    minSilence: z.number().default(0.4),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const a = p.assets.find((x) => x.id === input.assetId);
    if (!a) return { text: `Asset ${input.assetId} not found`, isError: true };
    const file = store.mediaPath(ctx.projectId, a.file);
    const result: Record<string, unknown> = {};
    if (input.detect.includes('silences')) {
      ctx.progress('Detecting silences…');
      result.silences = await detectSilence(file, input.silenceDb, input.minSilence);
    }
    if (input.detect.includes('scenes')) {
      ctx.progress('Detecting scene cuts…');
      result.scenes = (await detectScenes(file)) ?? 'unavailable (needs a full FFmpeg install with the select filter)';
    }
    if (input.detect.includes('loudness')) {
      const l = await measureLoudness(file);
      result.loudnessLufs = l?.i;
    }
    await store.update(
      ctx.projectId,
      'Media analysis',
      (d) => {
        const x = d.assets.find((y) => y.id === a.id);
        if (!x) return;
        if (Array.isArray(result.silences)) x.analysis.silences = result.silences as [number, number][];
        if (Array.isArray(result.scenes)) x.analysis.scenes = result.scenes as number[];
        if (typeof result.loudnessLufs === 'number') x.analysis.loudnessLufs = result.loudnessLufs;
      },
      { history: false },
    );
    const silences = result.silences as [number, number][] | undefined;
    const silentTotal = silences?.reduce((n, [s, e]) => n + (e - s), 0) ?? 0;
    return { text: j({ ...result, silentTotalSec: silences ? Math.round(silentTotal * 10) / 10 : undefined }), summary: silences ? `${silences.length} pauses` : 'done' };
  },
});

export const viewMedia = defineTool({
  name: 'view_media',
  category: 'media',
  readOnly: true,
  description:
    'Look at an image or at frames from a video (vision). Use it to understand footage (framing, where the face is for zoom focus, what is shown for b-roll matching), check uploaded images/logos, or pick thumbnail moments. Default: 4 evenly spaced frames.',
  schema: z.object({
    assetId: z.string(),
    times: z.array(z.number().min(0)).max(8).optional().describe('Source times in seconds'),
    count: z.number().int().min(1).max(8).default(4),
    width: z.number().int().min(256).max(1280).default(640),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const a = p.assets.find((x) => x.id === input.assetId);
    if (!a) return { text: `Asset ${input.assetId} not found`, isError: true };
    const file = store.mediaPath(ctx.projectId, a.file);
    const framesDir = path.join(store.rendersDir(ctx.projectId), 'frames');
    await fsp.mkdir(framesDir, { recursive: true });
    if (a.kind === 'image') {
      const jpeg = await resizeImage(file, input.width);
      const name = `view-${a.id}-${Date.now()}.jpg`;
      await fsp.writeFile(path.join(framesDir, name), jpeg);
      return { text: `${a.name} (${a.meta.width}x${a.meta.height})`, images: [{ mime: 'image/jpeg', data: jpeg.toString('base64') }], imageUrls: [`/renders/${ctx.projectId}/frames/${name}`], summary: a.name };
    }
    if (a.kind !== 'video') return { text: `${a.name} is ${a.kind}; nothing to look at. Use get_transcript/read_document instead.`, isError: true };
    const dur = a.meta.duration ?? 0;
    const times = input.times?.length ? input.times : Array.from({ length: input.count }, (_, i) => Math.round(((dur * (i + 0.5)) / input.count) * 100) / 100);
    const frames = await extractFrames(file, times, input.width);
    const urls: string[] = [];
    for (const f of frames) {
      const name = `view-${a.id}-${Math.round(f.time * 1000)}.jpg`;
      await fsp.writeFile(path.join(framesDir, name), f.jpeg);
      urls.push(`/renders/${ctx.projectId}/frames/${name}`);
    }
    return {
      text: `${frames.length} frame(s) from ${a.name} at ${frames.map((f) => `${f.time.toFixed(2)}s`).join(', ')} (${a.meta.width}x${a.meta.height}).`,
      images: frames.map((f) => ({ mime: 'image/jpeg', data: f.jpeg.toString('base64') })),
      imageUrls: urls,
      summary: `${frames.length} frames`,
    };
  },
});

export const readDocument = defineTool({
  name: 'read_document',
  category: 'media',
  readOnly: true,
  description: 'Read the text of an uploaded document (PDF, DOCX, TXT, MD, CSV, HTML, SRT…). Paginate with offset/limit (characters).',
  schema: z.object({ assetId: z.string(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(500).max(80000).default(20000) }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const a = p.assets.find((x) => x.id === input.assetId);
    if (!a) return { text: `Asset ${input.assetId} not found`, isError: true };
    const text = await store.readAssetText(ctx.projectId, a);
    if (text === null) return { text: `${a.name} has no extracted text (kind ${a.kind}, status ${a.status}).`, isError: true };
    const slice = text.slice(input.offset, input.offset + input.limit);
    const more = input.offset + input.limit < text.length ? `\n… ${text.length - input.offset - input.limit} more characters (offset=${input.offset + input.limit})` : '';
    return { text: `${a.name}:\n${slice}${more}`, summary: `${slice.length} chars` };
  },
});

export const annotateAsset = defineTool({
  name: 'annotate_asset',
  category: 'media',
  description: 'Save what you learned about an asset (description of contents, tags, a better name). Descriptions appear in the project summary, so future steps (and the user) benefit.',
  schema: z.object({ assetId: z.string(), description: z.string().optional(), tags: z.array(z.string()).optional(), name: z.string().optional() }),
  execute: async (input, ctx) => {
    await mutate(ctx, 'Annotate asset', (d) => void applyOp(d, { op: 'updateAsset', assetId: input.assetId, patch: { description: input.description, tags: input.tags, name: input.name } }));
    return { text: 'Saved.', summary: 'saved' };
  },
});

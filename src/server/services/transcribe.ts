import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import type { Word } from '../../shared/schema';
import { uid } from '../../shared/ids';
import { CACHE_DIR, type Settings } from '../config';
import { runFf } from '../media/ffmpeg';

export interface TranscriptionEngine {
  id: 'openai' | 'groq' | 'elevenlabs' | 'local' | 'whisper-cpp';
  label: string;
  apiKey?: string;
  model?: string;
}

export interface TranscriptionResult {
  words: Word[];
  language?: string;
  text: string;
}

const WHISPER_CPP_VERSION = '1.7.6';
const whisperCppDir = () => path.join(CACHE_DIR, 'whisper.cpp');

export const localWhisperAvailable = async (): Promise<boolean> => {
  try {
    await import('@huggingface/transformers');
    return true;
  } catch {
    return false;
  }
};

const whisperCppInstalled = (): boolean => fs.existsSync(path.join(whisperCppDir(), 'main')) || fs.existsSync(path.join(whisperCppDir(), 'build', 'bin', 'whisper-cli')) || fs.existsSync(path.join(whisperCppDir(), 'main.exe'));

/** Resolves the engine to use from settings + available keys (null = none available). */
export const pickTranscriptionEngine = async (s: Settings): Promise<TranscriptionEngine | null> => {
  const pref = s.speech.transcription;
  const k = s.keys;
  const candidates: (TranscriptionEngine | null)[] = [];
  const groq = k.groq ? ({ id: 'groq', label: 'Groq Whisper', apiKey: k.groq, model: s.speech.groqTranscribeModel } as const) : null;
  const eleven = k.elevenlabs ? ({ id: 'elevenlabs', label: 'ElevenLabs Scribe', apiKey: k.elevenlabs, model: 'scribe_v1' } as const) : null;
  const openai = k.openai ? ({ id: 'openai', label: 'OpenAI Whisper', apiKey: k.openai, model: s.speech.openaiTranscribeModel } as const) : null;
  const local = (await localWhisperAvailable()) ? ({ id: 'local', label: 'Local Whisper', model: s.speech.localWhisperModel } as const) : null;
  const cpp = whisperCppInstalled() ? ({ id: 'whisper-cpp', label: 'whisper.cpp', model: s.speech.whisperCppModel } as const) : null;
  switch (pref) {
    case 'groq':
      candidates.push(groq);
      break;
    case 'elevenlabs':
      candidates.push(eleven);
      break;
    case 'openai':
      candidates.push(openai);
      break;
    case 'local':
      candidates.push(local);
      break;
    case 'whisper-cpp':
      candidates.push(cpp ?? ({ id: 'whisper-cpp', label: 'whisper.cpp', model: s.speech.whisperCppModel } as const));
      break;
    default:
      candidates.push(groq, eleven, openai, cpp, local);
  }
  return candidates.find((c): c is TranscriptionEngine => c !== null) ?? null;
};

// ---------------------------------------------------------------------------
// Word cleanup
// ---------------------------------------------------------------------------

/** Merge punctuation-only tokens, trim, enforce monotonic non-zero timings. */
export const cleanWords = (raw: Word[]): Word[] => {
  const out: Word[] = [];
  for (const w of raw) {
    const text = w.text.trim();
    if (!text) continue;
    if (/^[^\p{L}\p{N}]+$/u.test(text) && out.length) {
      out[out.length - 1]!.text += text;
      out[out.length - 1]!.end = Math.max(out[out.length - 1]!.end, w.end);
      continue;
    }
    let start = Math.max(0, w.start);
    let end = Math.max(start + 0.04, w.end);
    const prev = out[out.length - 1];
    if (prev && start < prev.end) {
      start = prev.end;
      end = Math.max(end, start + 0.04);
    }
    out.push({ text, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, ...(w.confidence !== undefined ? { confidence: w.confidence } : {}) });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Cloud engines
// ---------------------------------------------------------------------------

const tmpDir = async () => {
  const d = path.join(CACHE_DIR, 'tmp', uid('stt'));
  await fsp.mkdir(d, { recursive: true });
  return d;
};

/** Compressed mono audio chunks (<= ~20 min each) to stay under API upload limits. */
const audioChunks = async (input: string, chunkSec = 1200): Promise<{ file: string; offset: number }[]> => {
  const dir = await tmpDir();
  const pattern = path.join(dir, 'chunk-%03d.mp3');
  const r = await runFf('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'segment', '-segment_time', String(chunkSec), '-reset_timestamps', '1', pattern]);
  if (r.code !== 0) throw new Error(`Audio extraction failed: ${r.stderr.split('\n').slice(-3).join(' ')}`);
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.mp3')).sort();
  return files.map((f, i) => ({ file: path.join(dir, f), offset: i * chunkSec }));
};

const openAiCompatibleTranscribe = async (input: string, engine: TranscriptionEngine, language?: string, onProgress?: (p: number) => void): Promise<TranscriptionResult> => {
  const client = new OpenAI({ apiKey: engine.apiKey, baseURL: engine.id === 'groq' ? 'https://api.groq.com/openai/v1' : undefined, maxRetries: 2, timeout: 10 * 60_000 });
  const chunks = await audioChunks(input);
  const words: Word[] = [];
  let lang: string | undefined;
  let text = '';
  try {
    for (const [i, c] of chunks.entries()) {
      const res = (await client.audio.transcriptions.create({
        file: fs.createReadStream(c.file),
        model: engine.model ?? 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
        ...(language && language !== 'auto' ? { language } : {}),
      })) as unknown as { text: string; language?: string; words?: { word: string; start: number; end: number }[] };
      lang ??= res.language;
      text += `${res.text} `;
      for (const w of res.words ?? []) words.push({ text: w.word, start: w.start + c.offset, end: w.end + c.offset });
      onProgress?.((i + 1) / chunks.length);
    }
  } finally {
    await fsp.rm(path.dirname(chunks[0]?.file ?? ''), { recursive: true, force: true }).catch(() => undefined);
  }
  if (!words.length && text.trim()) throw new Error(`${engine.label} returned no word timestamps (model ${engine.model} may not support them; use whisper-1 / whisper-large-v3-turbo)`);
  return { words: cleanWords(words), language: lang, text: text.trim() };
};

const elevenLabsTranscribe = async (input: string, engine: TranscriptionEngine, language?: string, onProgress?: (p: number) => void): Promise<TranscriptionResult> => {
  const chunks = await audioChunks(input, 3600);
  const words: Word[] = [];
  let lang: string | undefined;
  let text = '';
  try {
    for (const [i, c] of chunks.entries()) {
      const form = new FormData();
      form.append('file', new Blob([await fsp.readFile(c.file)], { type: 'audio/mpeg' }), 'audio.mp3');
      form.append('model_id', engine.model ?? 'scribe_v1');
      form.append('timestamps_granularity', 'word');
      form.append('tag_audio_events', 'false');
      if (language && language !== 'auto') form.append('language_code', language);
      const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': engine.apiKey ?? '' }, body: form });
      if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { language_code?: string; text: string; words?: { text: string; start: number; end: number; type?: string }[] };
      lang ??= j.language_code;
      text += `${j.text} `;
      for (const w of j.words ?? []) if (!w.type || w.type === 'word') words.push({ text: w.text, start: w.start + c.offset, end: w.end + c.offset });
      onProgress?.((i + 1) / chunks.length);
    }
  } finally {
    await fsp.rm(path.dirname(chunks[0]?.file ?? ''), { recursive: true, force: true }).catch(() => undefined);
  }
  return { words: cleanWords(words), language: lang, text: text.trim() };
};

// ---------------------------------------------------------------------------
// Local engines
// ---------------------------------------------------------------------------

const decodePcm16k = async (input: string): Promise<Float32Array> => {
  const r = await runFf('ffmpeg', ['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], { timeoutMs: 30 * 60_000 });
  if (r.code !== 0) throw new Error(`Audio decode failed: ${r.stderr.split('\n').slice(-3).join(' ')}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length - (r.stdout.length % 4)));
};

type AsrPipe = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
const pipes = new Map<string, Promise<AsrPipe>>();

const getLocalPipe = (model: string, onProgress?: (p: number) => void): Promise<AsrPipe> => {
  let p = pipes.get(model);
  if (!p) {
    p = (async () => {
      const tf = await import('@huggingface/transformers');
      tf.env.cacheDir = path.join(CACHE_DIR, 'models');
      const pipe = await tf.pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        progress_callback: (e: { status?: string; progress?: number }) => {
          if (e.status === 'progress' && typeof e.progress === 'number') onProgress?.(Math.min(0.3, (e.progress / 100) * 0.3));
        },
      } as never);
      return pipe as unknown as AsrPipe;
    })();
    pipes.set(model, p);
    p.catch(() => pipes.delete(model));
  }
  return p;
};

const localTranscribe = async (input: string, engine: TranscriptionEngine, language?: string, onProgress?: (p: number) => void): Promise<TranscriptionResult> => {
  const pipe = await getLocalPipe(engine.model ?? 'onnx-community/whisper-base_timestamped', onProgress);
  const audio = await decodePcm16k(input);
  const english = /\.en\b|_en\b/.test(engine.model ?? '');
  const sliceSec = 600;
  const words: Word[] = [];
  let text = '';
  const total = Math.max(1, Math.ceil(audio.length / (16000 * sliceSec)));
  for (let i = 0; i < total; i++) {
    const slice = audio.subarray(i * 16000 * sliceSec, (i + 1) * 16000 * sliceSec);
    const out = await pipe(slice, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(english || !language || language === 'auto' ? {} : { language, task: 'transcribe' }),
    });
    text += `${out.text} `;
    for (const c of out.chunks ?? []) {
      const [s, e] = c.timestamp;
      words.push({ text: c.text, start: s + i * sliceSec, end: (e ?? s + 0.3) + i * sliceSec });
    }
    onProgress?.(0.3 + (0.7 * (i + 1)) / total);
  }
  return { words: cleanWords(words), language, text: text.trim() };
};

export const installWhisperCppEngine = async (model: string, onLog?: (l: string) => void) => {
  const { installWhisperCpp, downloadWhisperModel } = await import('@remotion/install-whisper-cpp');
  onLog?.('Installing whisper.cpp (builds from source on macOS/Linux; needs git, make and a C++ compiler)…');
  await installWhisperCpp({ version: WHISPER_CPP_VERSION, to: whisperCppDir(), printOutput: false });
  onLog?.(`Downloading model ${model}…`);
  await downloadWhisperModel({ model: model as never, folder: whisperCppDir(), printOutput: false });
};

const whisperCppTranscribe = async (input: string, engine: TranscriptionEngine, language?: string, onProgress?: (p: number) => void): Promise<TranscriptionResult> => {
  const { transcribe, toCaptions } = await import('@remotion/install-whisper-cpp');
  const model = (engine.model ?? 'base.en') as 'base.en';
  if (!whisperCppInstalled()) await installWhisperCppEngine(model);
  const dir = await tmpDir();
  const wav = path.join(dir, 'audio.wav');
  try {
    const r = await runFf('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    if (r.code !== 0) throw new Error('Audio extraction failed');
    const out = await transcribe({
      inputPath: wav,
      whisperPath: whisperCppDir(),
      whisperCppVersion: WHISPER_CPP_VERSION,
      model,
      tokenLevelTimestamps: true,
      language: (language && language !== 'auto' && !model.endsWith('.en') ? language : null) as never,
      splitOnWord: true,
      onProgress,
    });
    const { captions } = toCaptions({ whisperCppOutput: out });
    const words = captions.map((c) => ({ text: c.text, start: c.startMs / 1000, end: c.endMs / 1000, confidence: c.confidence ?? undefined }));
    return { words: cleanWords(words), language, text: captions.map((c) => c.text).join('').trim() };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const transcribeFile = async (
  input: string,
  engine: TranscriptionEngine,
  opts: { language?: string; onProgress?: (p: number) => void } = {},
): Promise<TranscriptionResult> => {
  switch (engine.id) {
    case 'openai':
    case 'groq':
      return openAiCompatibleTranscribe(input, engine, opts.language, opts.onProgress);
    case 'elevenlabs':
      return elevenLabsTranscribe(input, engine, opts.language, opts.onProgress);
    case 'whisper-cpp':
      return whisperCppTranscribe(input, engine, opts.language, opts.onProgress);
    case 'local':
      return localTranscribe(input, engine, opts.language, opts.onProgress);
  }
};

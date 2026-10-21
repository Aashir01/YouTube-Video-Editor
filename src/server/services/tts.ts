import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { Word } from '../../shared/schema';
import { uid } from '../../shared/ids';
import { CACHE_DIR, type Settings } from '../config';
import { floatToWav, pcmToWav, probe, runFf } from '../media/ffmpeg';
import { cleanWords, pickTranscriptionEngine, transcribeFile } from './transcribe';

export type TtsEngineId = 'elevenlabs' | 'openai' | 'gemini' | 'kokoro' | 'system';

export interface TtsEngine {
  id: TtsEngineId;
  label: string;
  apiKey?: string;
}

export interface Voice {
  id: string;
  name: string;
  description?: string;
  gender?: string;
  accent?: string;
  preview?: string;
}

export interface SpeechResult {
  file: string;
  words: Word[];
  duration: number;
  engine: TtsEngineId;
  voice: string;
  /** how the word timings were obtained */
  alignment: 'native' | 'transcribed' | 'estimated';
}

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const GEMINI_VOICES: [string, string][] = [
  ['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'], ['Fenrir', 'Excitable'], ['Leda', 'Youthful'], ['Orus', 'Firm'], ['Aoede', 'Breezy'],
  ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'], ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'],
  ['Erinome', 'Clear'], ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'], ['Alnilam', 'Firm'], ['Schedar', 'Even'],
  ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'], ['Achird', 'Friendly'], ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'], ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm'],
];

export const kokoroAvailable = async () => {
  try {
    await import('kokoro-js');
    return true;
  } catch {
    return false;
  }
};

const systemTtsCommand = (): 'say' | 'powershell' | 'espeak-ng' | 'espeak' | null => {
  const which = (bin: string) => {
    const paths = (process.env.PATH ?? '').split(path.delimiter);
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
    return paths.some((p) => exts.some((e) => fs.existsSync(path.join(p, bin + e))));
  };
  if (process.platform === 'darwin' && which('say')) return 'say';
  if (process.platform === 'win32') return 'powershell';
  if (which('espeak-ng')) return 'espeak-ng';
  if (which('espeak')) return 'espeak';
  return null;
};

export const pickTtsEngine = async (s: Settings, prefer?: string): Promise<TtsEngine | null> => {
  const k = s.keys;
  const all: Record<TtsEngineId, TtsEngine | null> = {
    elevenlabs: k.elevenlabs ? { id: 'elevenlabs', label: 'ElevenLabs', apiKey: k.elevenlabs } : null,
    openai: k.openai ? { id: 'openai', label: 'OpenAI TTS', apiKey: k.openai } : null,
    gemini: k.gemini ? { id: 'gemini', label: 'Gemini TTS', apiKey: k.gemini } : null,
    kokoro: (await kokoroAvailable()) ? { id: 'kokoro', label: 'Kokoro (local)' } : null,
    system: systemTtsCommand() ? { id: 'system', label: 'System voice' } : null,
  };
  const pref = (prefer ?? s.speech.tts) as TtsEngineId | 'auto';
  if (pref !== 'auto' && pref in all) return all[pref as TtsEngineId];
  return all.elevenlabs ?? all.openai ?? all.gemini ?? all.kokoro ?? all.system;
};

export const listVoices = async (s: Settings): Promise<{ engine: TtsEngineId; label: string; default: string; voices: Voice[] }[]> => {
  const out: { engine: TtsEngineId; label: string; default: string; voices: Voice[] }[] = [];
  if (s.keys.elevenlabs) {
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': s.keys.elevenlabs } });
      if (res.ok) {
        const j = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string; description?: string }[] };
        out.push({
          engine: 'elevenlabs',
          label: 'ElevenLabs',
          default: s.speech.elevenVoiceId,
          voices: j.voices.map((v) => ({ id: v.voice_id, name: v.name, description: [v.labels?.description, v.labels?.use_case, v.description].filter(Boolean).join(' · '), gender: v.labels?.gender, accent: v.labels?.accent, preview: v.preview_url })),
        });
      }
    } catch {
      /* offline */
    }
  }
  if (s.keys.openai) out.push({ engine: 'openai', label: 'OpenAI TTS', default: s.speech.openaiVoice, voices: OPENAI_VOICES.map((v) => ({ id: v, name: v[0]!.toUpperCase() + v.slice(1) })) });
  if (s.keys.gemini) out.push({ engine: 'gemini', label: 'Gemini TTS', default: s.speech.geminiVoice, voices: GEMINI_VOICES.map(([id, d]) => ({ id, name: id, description: d })) });
  if (await kokoroAvailable()) {
    try {
      const { VOICES } = (await import('kokoro-js')) as unknown as { VOICES: Record<string, { name: string; language: string; gender: string; traits?: string; overallGrade?: string }> };
      out.push({
        engine: 'kokoro',
        label: 'Kokoro (local, free)',
        default: s.speech.kokoroVoice,
        voices: Object.entries(VOICES).map(([id, v]) => ({ id, name: v.name, gender: v.gender, accent: v.language, description: [v.traits, v.overallGrade && `grade ${v.overallGrade}`].filter(Boolean).join(' · ') })),
      });
    } catch {
      /* ignore */
    }
  }
  if (systemTtsCommand()) out.push({ engine: 'system', label: 'System voice (basic)', default: '', voices: [{ id: '', name: 'Default system voice' }] });
  return out;
};

// ---------------------------------------------------------------------------
// Word timing helpers
// ---------------------------------------------------------------------------

/** Distribute words over a duration, weighting by length and pausing at punctuation. */
export const estimateWordTimings = (text: string, duration: number, offset = 0): Word[] => {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || duration <= 0) return [];
  const weight = (w: string) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + (/[.!?]$/.test(w) ? 5 : /[,;:]$/.test(w) ? 2.5 : 0.8);
  const total = words.reduce((n, w) => n + weight(w), 0);
  let t = offset;
  return words.map((w) => {
    const d = (duration * weight(w)) / total;
    const pause = /[.!?]$/.test(w) ? d * 0.35 : /[,;:]$/.test(w) ? d * 0.2 : 0;
    const word = { text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + d - pause) * 1000) / 1000 };
    t += d;
    return word;
  });
};

/** Convert ElevenLabs character alignment into word timings. */
export const alignmentToWords = (a: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }): Word[] => {
  const words: Word[] = [];
  let cur = '';
  let start = 0;
  let end = 0;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push({ text: cur, start, end });
      cur = '';
      return;
    }
    if (!cur) start = a.character_start_times_seconds[i] ?? end;
    cur += ch;
    end = a.character_end_times_seconds[i] ?? end;
  });
  if (cur) words.push({ text: cur, start, end });
  return cleanWords(words);
};

const tmpFile = async (ext: string) => {
  const dir = path.join(CACHE_DIR, 'tmp');
  await fsp.mkdir(dir, { recursive: true });
  return path.join(dir, `${uid('tts')}${ext}`);
};

/** Strip markup that should not be spoken (emphasis asterisks, stage directions in [brackets]). */
export const speakableText = (text: string) =>
  text
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[(?:pause|beat|music|sfx)[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

const elevenlabs = async (text: string, engine: TtsEngine, s: Settings, voice?: string, style?: string, speed?: number): Promise<Omit<SpeechResult, 'duration'>> => {
  const voiceId = voice || s.speech.elevenVoiceId;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': engine.apiKey ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: s.speech.elevenModel,
      voice_settings: { stability: style === 'calm' ? 0.7 : 0.45, similarity_boost: 0.8, style: style === 'energetic' ? 0.45 : 0.2, use_speaker_boost: true, ...(speed ? { speed } : {}) },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }; normalized_alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
  const file = await tmpFile('.mp3');
  await fsp.writeFile(file, Buffer.from(j.audio_base64, 'base64'));
  const alignment = j.alignment ?? j.normalized_alignment;
  return { file, words: alignment ? alignmentToWords(alignment) : [], engine: 'elevenlabs', voice: voiceId, alignment: alignment ? 'native' : 'estimated' };
};

const openai = async (text: string, engine: TtsEngine, s: Settings, voice?: string, style?: string, speed?: number): Promise<Omit<SpeechResult, 'duration'>> => {
  const client = new OpenAI({ apiKey: engine.apiKey });
  const model = s.speech.openaiTtsModel;
  const v = voice || s.speech.openaiVoice;
  const instructions = style ? `Voice direction: ${style}. You are narrating a YouTube video; sound natural and engaging.` : 'You are narrating a YouTube video. Sound natural, clear and engaging.';
  const res = await client.audio.speech.create({
    model,
    voice: v as 'alloy',
    input: text,
    response_format: 'mp3',
    ...(model.includes('gpt-4o') ? { instructions } : {}),
    ...(speed ? { speed } : {}),
  });
  const file = await tmpFile('.mp3');
  await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return { file, words: [], engine: 'openai', voice: v, alignment: 'estimated' };
};

const gemini = async (text: string, engine: TtsEngine, s: Settings, voice?: string, style?: string): Promise<Omit<SpeechResult, 'duration'>> => {
  const ai = new GoogleGenAI({ apiKey: engine.apiKey ?? '' });
  const v = voice || s.speech.geminiVoice;
  const prompt = style ? `Read this as a YouTube narrator (${style}):\n\n${text}` : `Read this as an engaging YouTube narrator:\n\n${text}`;
  const res = await ai.models.generateContent({
    model: s.speech.geminiTtsModel,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } },
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error('Gemini TTS returned no audio');
  const mime = part.inlineData.mimeType ?? 'audio/L16;rate=24000';
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  const file = await tmpFile('.wav');
  await fsp.writeFile(file, pcmToWav(Buffer.from(part.inlineData.data, 'base64'), rate));
  return { file, words: [], engine: 'gemini', voice: v, alignment: 'estimated' };
};

type KokoroInstance = {
  stream: (text: string, opts: { voice?: string; speed?: number }) => AsyncGenerator<{ text: string; audio: { audio: Float32Array; sampling_rate: number } }>;
};
let kokoroPromise: Promise<KokoroInstance> | null = null;

const kokoro = async (text: string, s: Settings, voice?: string, speed?: number): Promise<Omit<SpeechResult, 'duration'>> => {
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      const tf = await import('@huggingface/transformers');
      tf.env.cacheDir = path.join(CACHE_DIR, 'models');
      const { KokoroTTS } = (await import('kokoro-js')) as unknown as { KokoroTTS: { from_pretrained: (id: string, o: Record<string, unknown>) => Promise<KokoroInstance> } };
      return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
    })();
    kokoroPromise.catch(() => (kokoroPromise = null));
  }
  const tts = await kokoroPromise;
  const v = voice || s.speech.kokoroVoice;
  const chunks: Float32Array[] = [];
  const words: Word[] = [];
  let sr = 24000;
  let t = 0;
  for await (const piece of tts.stream(text, { voice: v, speed: speed ?? 1 })) {
    sr = piece.audio.sampling_rate;
    const dur = piece.audio.audio.length / sr;
    words.push(...estimateWordTimings(piece.text, dur, t));
    chunks.push(piece.audio.audio);
    t += dur;
  }
  const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const file = await tmpFile('.wav');
  await fsp.writeFile(file, floatToWav(all, sr));
  return { file, words: cleanWords(words), engine: 'kokoro', voice: v, alignment: 'estimated' };
};

const system = async (text: string, voice?: string): Promise<Omit<SpeechResult, 'duration'>> => {
  const cmd = systemTtsCommand();
  if (!cmd) throw new Error('No system speech synthesizer found');
  const out = await tmpFile('.wav');
  const run = (bin: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const p = spawn(bin, args, { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} failed: ${err.slice(0, 200)}`))));
    });
  if (cmd === 'say') {
    const aiff = out.replace('.wav', '.aiff');
    await run('say', [...(voice ? ['-v', voice] : []), '-o', aiff, text]);
    await runFf('ffmpeg', ['-y', '-i', aiff, out]);
    await fsp.rm(aiff, { force: true });
  } else if (cmd === 'powershell') {
    const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${out.replace(/'/g, "''")}'); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()`;
    await new Promise<void>((resolve, reject) => {
      const p = spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
      p.stdin.end(text);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('PowerShell speech failed'))));
    });
  } else {
    await run(cmd, ['-w', out, ...(voice ? ['-v', voice] : []), text]);
  }
  return { file: out, words: [], engine: 'system', voice: voice ?? 'default', alignment: 'estimated' };
};

export interface SpeechOptions {
  engine?: TtsEngineId;
  voice?: string;
  /** natural-language voice direction, e.g. "energetic", "calm documentary" */
  style?: string;
  speed?: number;
  /** transcribe the result for exact word timings when the engine has none */
  align?: boolean;
}

export const synthesizeSpeech = async (rawText: string, s: Settings, opts: SpeechOptions = {}): Promise<SpeechResult> => {
  const text = speakableText(rawText);
  if (!text) throw new Error('Nothing to say: the narration text is empty');
  const engine = await pickTtsEngine(s, opts.engine);
  if (!engine) throw new Error('No voice engine available. Add an ElevenLabs, OpenAI or Gemini key in Settings, or install the free local Kokoro voice.');
  let result: Omit<SpeechResult, 'duration'>;
  switch (engine.id) {
    case 'elevenlabs':
      result = await elevenlabs(text, engine, s, opts.voice, opts.style, opts.speed);
      break;
    case 'openai':
      result = await openai(text, engine, s, opts.voice, opts.style, opts.speed);
      break;
    case 'gemini':
      result = await gemini(text, engine, s, opts.voice, opts.style);
      break;
    case 'kokoro':
      result = await kokoro(text, s, opts.voice, opts.speed);
      break;
    default:
      result = await system(text, opts.voice);
  }
  const info = await probe(result.file);
  const duration = info.duration ?? 0;
  if (result.words.length === 0 || (opts.align !== false && result.alignment === 'estimated' && engine.id !== 'kokoro')) {
    const stt = opts.align === false ? null : await pickTranscriptionEngine(s);
    if (stt) {
      try {
        const tr = await transcribeFile(result.file, stt, { language: s.speech.language });
        if (tr.words.length >= Math.max(1, text.split(/\s+/).length * 0.6)) return { ...result, words: tr.words, duration, alignment: 'transcribed' };
      } catch (err) {
        console.warn('[tts] alignment transcription failed, estimating:', (err as Error).message);
      }
    }
    if (result.words.length === 0) result.words = estimateWordTimings(text, duration);
  }
  return { ...result, duration };
};


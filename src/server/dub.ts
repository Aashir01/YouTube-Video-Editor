/**
 * Dubbed versions: a copy of the project in another language. The subtitles are translated, each
 * line is voiced at the moment the original was said (sped up a little when the translation runs
 * longer), the original speech is lowered or silenced, and the captions show the translation.
 */
import { getSettings } from './config';
import { generationQueue } from './jobs';
import { registerAsset } from './media/ingest';
import { pickTtsEngine, synthesizeSpeech } from './services/tts';
import { store } from './storage/projects';
import { readTranslations, subtitleSource, translateSubtitles } from './subtitles';
import { addTrack, clipEnd, placeClip } from '../shared/timeline';
import { LANGUAGES, language, subtitleSentences, translatedWords } from '../shared/subtitles';
import type { ClipInput, Project } from '../shared/schema';

export interface DubOptions {
  /** voice id of the chosen engine (default: the engine's default voice) */
  voice?: string;
  /** what happens to the original speech: lowered under the dub (default) or silent */
  original?: 'duck' | 'mute';
  signal?: AbortSignal;
}

interface Line {
  start: number;
  end: number;
  text: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const MAX_SPEEDUP = 1.35;

export const createDub = async (projectId: string, lang: string, opts: DubOptions = {}): Promise<{ project: Project; lines: number; cut: number; engine: string }> => {
  const code = LANGUAGES.find((l) => l.code.toLowerCase() === lang.toLowerCase())?.code;
  if (!code) throw new Error(`Unknown language "${lang}"`);
  const settings = getSettings();
  const engine = await pickTtsEngine(settings);
  if (!engine) throw new Error('A dubbed version needs a voice engine: add an ElevenLabs, OpenAI or Gemini key in Settings, or install the local Kokoro voice');
  await translateSubtitles(projectId, [code], { signal: opts.signal });

  const p = await store.get(projectId);
  const words = subtitleSource(p, await store.transcriptsFor(p));
  const table = (await readTranslations(projectId)).table[code] ?? {};
  // voice lines: sentences, with very short ones joined to their neighbor
  const lines: Line[] = [];
  for (const s of subtitleSentences(words)) {
    const text = table[s.key] ?? s.key;
    const last = lines[lines.length - 1];
    if (last && s.start - last.end < 0.35 && s.end - last.start < 8 && (last.end - last.start < 1.5 || s.end - s.start < 1.5)) {
      last.end = s.end;
      last.text = `${last.text} ${text}`;
    } else lines.push({ start: s.start, end: s.end, text });
  }
  if (!lines.length) throw new Error('There is nothing to dub: the video has no transcript');

  const name = language(code).name;
  const voiced = await generationQueue.add(projectId, `Dubbing into ${name}`, async (report) => {
    const out: { line: Line; file: string; duration: number; voice: string; words: { text: string; start: number; end: number }[] }[] = [];
    for (const [i, line] of lines.entries()) {
      if (opts.signal?.aborted) throw new Error('Cancelled');
      const speech = await synthesizeSpeech(line.text, settings, { engine: engine.id, voice: opts.voice, align: false });
      out.push({ line, file: speech.file, duration: speech.duration, voice: speech.voice, words: speech.words });
      report((i + 1) / lines.length, `${i + 1}/${lines.length}`);
    }
    return out;
  });

  // the copy: original speech lowered (or silent), captions showing the translation
  const meta = (await readTranslations(projectId)).meta?.[code];
  const shown = translatedWords(words, table, code);
  const dub = await store.derive(projectId, `${p.name} (${name})`, (d) => {
    for (const t of d.tracks) {
      for (const c of t.clips) {
        const speech = (c.type === 'video' && !c.muted && c.volume > 0) || (c.type === 'audio' && (c.role === 'voiceover' || c.role === 'original'));
        if (speech && (c.type === 'video' || c.type === 'audio')) c.volume = opts.original === 'mute' ? 0 : r3(c.volume * 0.12);
        if (c.type === 'captions') {
          c.mode = 'manual';
          c.words = shown.filter((w) => w.end > c.start && w.start < clipEnd(c));
          delete c.language;
        }
      }
    }
    d.brief.language = code;
    if (meta) {
      d.youtube.title = meta.title;
      d.youtube.description = meta.description;
    }
  });

  // the voices, each at the moment its line was said
  const placed: { assetId: string; start: number; duration: number; speed: number }[] = [];
  let cut = 0;
  for (const [i, v] of voiced.entries()) {
    const asset = await registerAsset(dub.id, {
      sourcePath: v.file,
      originalName: `Dub ${code} ${String(i + 1).padStart(3, '0')}${v.file.endsWith('.wav') ? '.wav' : '.mp3'}`,
      origin: 'tts',
      voice: { engine: engine.id, voice: v.voice, text: v.line.text },
      // its words (timed by estimate) make it a speech track: music ducks under it, captions can follow it
      words: v.words,
      label: 'Add dubbed voice',
    });
    const next = voiced[i + 1]?.line.start ?? v.line.end + 2;
    const slot = Math.max(0.3, next - v.line.start - 0.05);
    const speed = v.duration > slot ? Math.min(MAX_SPEEDUP, v.duration / slot) : 1;
    let duration = v.duration / speed;
    if (duration > slot + 0.01) {
      duration = slot;
      cut++;
    }
    placed.push({ assetId: asset.id, start: r3(v.line.start), duration: r3(duration), speed: Math.round(speed * 100) / 100 });
  }
  const project = await store.update(dub.id, `Dubbed voice (${name})`, (d) => {
    const firstAudio = d.tracks.findIndex((t) => t.kind === 'audio');
    const track = addTrack(d, { name: `Dub (${name})`, kind: 'audio', index: firstAudio < 0 ? undefined : firstAudio });
    for (const c of placed) placeClip(d, { id: '', type: 'audio', role: 'voiceover', assetId: c.assetId, start: c.start, duration: c.duration, speed: c.speed } as ClipInput, { trackId: track.id });
  });
  return { project, lines: placed.length, cut, engine: engine.label };
};

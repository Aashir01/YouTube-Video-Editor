/**
 * Subtitles in other languages: the user's AI translates the captions sentence by sentence
 * (shared/subtitles.ts holds the prompts and the timing). Translations are kept next to the
 * project as a cache, so later edits only need their new sentences translated.
 */
import fs from 'node:fs';
import { complete } from './ai/llm';
import { aiQueue } from './jobs';
import { bus } from './events';
import { store } from './storage/projects';
import { wordsToSrt } from './services/documents';
import {
  LANGUAGES,
  TRANSLATE_SYSTEM,
  language,
  metadataPrompt,
  parseMetadataReply,
  parseTranslationReply,
  subtitleSentences,
  subtitleSource,
  translatedWords,
  translationPrompt,
  type TranslationsState,
} from '../shared/subtitles';
import type { Project } from '../shared/schema';

const FILE = 'translations.json';

export const readTranslations = async (projectId: string): Promise<TranslationsState> => (await store.readSideFile<TranslationsState>(projectId, FILE)) ?? { languages: [], table: {} };

// one writer at a time per project (several languages can finish at once)
const locks = new Map<string, Promise<unknown>>();
const withState = <T>(projectId: string, fn: (s: TranslationsState) => T | Promise<T>): Promise<T> => {
  const run = (locks.get(projectId) ?? Promise.resolve()).then(async () => {
    const state = await readTranslations(projectId);
    const out = await fn(state);
    await store.writeSideFile(projectId, FILE, state);
    bus.emit(projectId, { type: 'translations', state });
    return out;
  });
  locks.set(projectId, run.catch(() => undefined));
  return run;
};

export { subtitleSource };

const known = (code: string) => LANGUAGES.find((l) => l.code.toLowerCase() === code.trim().toLowerCase())?.code;
const metaSource = (p: Project) => `${p.youtube.title}\n${p.youtube.description}`;

const pool = async <T>(items: T[], limit: number, fn: (item: T) => Promise<void>) => {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
};

export interface TranslateResult {
  state: TranslationsState;
  /** sentences translated now */
  translated: number;
  /** sentences the AI left out (they show in the original language until translated again) */
  missing: number;
}

/** Translate the subtitles (and the YouTube title and description) into these languages; only what is new. */
export const translateSubtitles = async (projectId: string, langs: string[], opts: { metadata?: boolean; signal?: AbortSignal } = {}): Promise<TranslateResult> => {
  const codes = [...new Set(langs.map((l) => known(l)).filter((l): l is string => Boolean(l)))];
  const unknown = langs.filter((l) => !known(l));
  if (unknown.length) throw new Error(`Unknown language${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Use codes like ${LANGUAGES.slice(1, 6).map((l) => l.code).join(', ')}`);
  if (!codes.length) throw new Error('Pick at least one language');
  const p = await store.get(projectId);
  const words = subtitleSource(p, await store.transcriptsFor(p));
  if (!words.length) throw new Error('Subtitles are made from the transcript: transcribe the footage first');
  const keys = [...new Set(subtitleSentences(words).map((s) => s.key))];

  // the languages show up at once (as "translating"), then fill in batch by batch
  const before = await withState(projectId, (s) => {
    s.languages = [...new Set([...s.languages, ...codes])];
    return structuredClone(s);
  });
  const batches: { lang: string; lines: string[] }[] = [];
  for (const lang of codes) {
    const todo = keys.filter((k) => !before.table[lang]?.[k]);
    let cur: string[] = [];
    let chars = 0;
    for (const k of todo) {
      if (cur.length && (chars + k.length > 3500 || cur.length >= 60)) {
        batches.push({ lang, lines: cur });
        cur = [];
        chars = 0;
      }
      cur.push(k);
      chars += k.length;
    }
    if (cur.length) batches.push({ lang, lines: cur });
  }
  const metaLangs = opts.metadata !== false && p.youtube.title.trim() ? codes.filter((l) => before.meta?.[l]?.source !== metaSource(p)) : [];
  const total = batches.length + metaLangs.length;
  let translated = 0;
  let missing = 0;
  if (total) {
    await aiQueue.add(projectId, `Translating subtitles (${codes.map((l) => language(l).name).join(', ')})`, async (report) => {
      let done = 0;
      const tick = () => report(++done / total, `${done}/${total}`);
      await pool(batches, 2, async (b) => {
        const reply = await complete({ system: TRANSLATE_SYSTEM, prompt: translationPrompt(b.lines, b.lang, p.name), kind: 'fast', maxTokens: 8000, signal: opts.signal });
        const out = parseTranslationReply(reply, b.lines.length);
        await withState(projectId, (s) => {
          const table = (s.table[b.lang] ??= {});
          b.lines.forEach((k, i) => {
            if (out[i]) {
              table[k] = out[i]!;
              translated++;
            } else missing++;
          });
        });
        tick();
      });
      for (const lang of metaLangs) {
        const reply = await complete({ system: TRANSLATE_SYSTEM, prompt: metadataPrompt(p.youtube.title, p.youtube.description, lang), kind: 'fast', maxTokens: 4000, signal: opts.signal });
        const meta = parseMetadataReply(reply);
        if (meta) await withState(projectId, (s) => void ((s.meta ??= {})[lang] = { ...meta, source: metaSource(p) }));
        tick();
      }
    });
  }
  return { state: await readTranslations(projectId), translated, missing };
};

export const removeLanguage = (projectId: string, lang: string) =>
  withState(projectId, (s) => {
    s.languages = s.languages.filter((l) => l !== lang);
    delete s.table[lang];
    if (s.meta) delete s.meta[lang];
  });

/** The subtitles of the current edit in `lang`, as SRT (sentences not yet translated stay in the original). */
export const subtitlesSrt = async (projectId: string, lang: string): Promise<string> => {
  const p = await store.get(projectId);
  const state = await readTranslations(projectId);
  const words = subtitleSource(p, await store.transcriptsFor(p));
  return wordsToSrt(translatedWords(words, state.table[lang], lang));
};

/** What a YouTube upload of this render adds: its subtitle files and the title/description in each language. */
export const youtubeExtras = async (p: Project, renderFile: string) => {
  const state = await readTranslations(p.id);
  const render = p.renders.find((r) => r.file === renderFile);
  const subtitles = (render?.subtitles ?? [])
    .map((lang) => ({ language: lang, name: language(lang).native, file: store.renderPath(p.id, renderFile.replace(/\.mp4$/, `.${lang}.srt`)) }))
    .filter((t) => fs.existsSync(t.file));
  const localizations = Object.fromEntries(
    Object.entries(state.meta ?? {})
      .filter(([lang, m]) => state.languages.includes(lang) && m.source === metaSource(p))
      .map(([lang, m]) => [lang, { title: m.title, description: m.description }]),
  );
  return { subtitles, localizations };
};

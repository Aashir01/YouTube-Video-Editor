/**
 * Subtitles in other languages. Translations are a cache from sentence text to translated text,
 * per language; subtitles are always rebuilt from the current timeline words, so they stay in sync
 * after any edit and only new sentences need translating. Each translated sentence takes the time
 * span of the original, with its words spread over it by length.
 */
import type { CaptionsClip, Project, Word } from './schema';
import { sentenceRanges } from './moments';
import { captionWords, timelineWords } from './timeline';

export interface Language {
  code: string;
  /** English name (what the AI is told) */
  name: string;
  /** the name in that language */
  native: string;
  rtl?: boolean;
  /** written without spaces between words */
  noSpaces?: boolean;
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
  { code: 'he', name: 'Hebrew', native: 'עברית', rtl: true },
  { code: 'fa', name: 'Persian', native: 'فارسی', rtl: true },
  { code: 'ur', name: 'Urdu', native: 'اردو', rtl: true },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', name: 'Thai', native: 'ไทย', noSpaces: true },
  { code: 'ja', name: 'Japanese', native: '日本語', noSpaces: true },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', native: '简体中文', noSpaces: true },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文', noSpaces: true },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'fil', name: 'Filipino', native: 'Filipino' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
];

export const language = (code: string): Language => LANGUAGES.find((l) => l.code.toLowerCase() === code.toLowerCase()) ?? { code, name: code, native: code };

export interface TranslationsState {
  /** the languages the creator wants subtitles in, in their order */
  languages: string[];
  /** language -> sentence key -> translated sentence */
  table: Record<string, Record<string, string>>;
  /** translated YouTube title and description, per language (source = the text they were made from) */
  meta?: Record<string, { title: string; description: string; source: string }>;
}

/**
 * The words subtitles are made of: what the captions show (every captions clip, in order: an edit
 * can split one into several), or else everything spoken on the timeline.
 */
export const subtitleSource = (p: Project, transcripts: Record<string, Word[]>): Word[] => {
  const caps = p.tracks
    .flatMap((t) => t.clips)
    .filter((c): c is CaptionsClip => c.type === 'captions')
    .sort((a, b) => a.start - b.start);
  if (!caps.length) return timelineWords(p, transcripts);
  const out: Word[] = [];
  for (const c of caps) for (const w of captionWords(p, c, transcripts)) if (!out.length || w.start > out[out.length - 1]!.start + 1e-6) out.push(w);
  return out;
};

/** The cache key of a sentence: its text with spacing tidied. */
export const sentenceKey = (text: string) => text.replace(/\s+/g, ' ').trim();

export interface SubtitleSentence {
  key: string;
  start: number;
  end: number;
  /** the words it is made of (timeline seconds) */
  words: Word[];
}

export const subtitleSentences = (words: Word[]): SubtitleSentence[] =>
  sentenceRanges(words).flatMap(([a, b]) => {
    const part = words.slice(a, b);
    const key = sentenceKey(part.map((w) => w.text.trim()).join(' '));
    return key ? [{ key, start: part[0]!.start, end: part[part.length - 1]!.end, words: part }] : [];
  });

type Segmenter = { segment: (t: string) => Iterable<{ segment: string; isWordLike?: boolean }> };
const segmenters = new Map<string, Segmenter | null>();
const segmenter = (lang: string, granularity: 'word' | 'grapheme'): Segmenter | null => {
  const key = `${lang}/${granularity}`;
  if (!segmenters.has(key)) {
    const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => Segmenter }).Segmenter;
    segmenters.set(key, Seg ? new Seg(lang, { granularity }) : null);
  }
  return segmenters.get(key)!;
};
const graphemes = (text: string, lang: string) => {
  const g = segmenter(lang, 'grapheme');
  return g ? [...g.segment(text)].length : [...text].length;
};

/**
 * Split translated text into display words. Scripts written without spaces (Chinese, Japanese,
 * Thai) are cut at real word boundaries into chunks of a few characters, never inside a character.
 */
export const splitWords = (text: string, lang?: string): string[] => {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!lang || !language(lang).noSpaces) return tokens;
  const size = lang === 'th' ? 6 : 4;
  const words = segmenter(lang, 'word');
  const out: string[] = [];
  for (const token of tokens) {
    const pieces = words ? [...words.segment(token)] : [...token].map((c) => ({ segment: c, isWordLike: !/\p{P}/u.test(c) }));
    let cur = '';
    for (const p of pieces) {
      // punctuation stays with the words before it
      if (!p.isWordLike && cur) {
        cur += p.segment;
        continue;
      }
      if (cur && graphemes(cur, lang) + graphemes(p.segment, lang) > size) {
        out.push(cur);
        cur = '';
      }
      cur += p.segment;
    }
    if (cur) out.push(cur);
  }
  return out;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Spread a translated sentence over the original's time span, word by word in proportion to length. */
export const spreadWords = (text: string, start: number, end: number, lang?: string): Word[] => {
  const tokens = splitWords(text, lang);
  if (!tokens.length) return [];
  const weights = tokens.map((t) => [...t].length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0.05, end - start);
  let acc = 0;
  return tokens.map((t, i) => {
    const s = start + (acc / total) * span;
    acc += weights[i]!;
    const e = start + ((acc - 1) / total) * span;
    return { text: t, start: r3(s), end: r3(Math.max(s + 0.02, e)) };
  });
};

/** The words of the subtitles in `lang`: translated sentences where known, the original elsewhere. */
export const translatedWords = (words: Word[], table: Record<string, string> | undefined, lang?: string): Word[] => {
  if (!table) return words;
  return subtitleSentences(words).flatMap((s) => {
    const t = table[s.key];
    return t ? spreadWords(t, s.start, s.end, lang) : s.words;
  });
};

/** How many sentences of the current edit still need translating into each language. */
export const missingCounts = (words: Word[], state: TranslationsState | null): Record<string, number> => {
  const keys = subtitleSentences(words).map((s) => s.key);
  return Object.fromEntries((state?.languages ?? []).map((l) => [l, keys.filter((k) => !state?.table[l]?.[k]).length]));
};

// ---------------------------------------------------------------------------
// Asking the AI
// ---------------------------------------------------------------------------

export const TRANSLATE_SYSTEM =
  'You translate video subtitles. Keep the meaning, tone, names and numbers; use natural, spoken language; keep each line about as long as the original so it fits on screen. You only answer with the JSON that is asked for.';

export const translationPrompt = (lines: string[], lang: string, videoName?: string): string => {
  const l = language(lang);
  return [
    videoName ? `Video: "${videoName}"` : '',
    `Translate each numbered subtitle line of this video into ${l.name} (${l.code}).`,
    'Consecutive lines belong together; translate them in context, but keep them as separate lines.',
    `Answer with JSON only: {"lines": ["line 1 in ${l.name}", "line 2 in ${l.name}", ...]} with exactly ${lines.length} lines, in order.`,
    '',
    ...lines.map((t, i) => `${i + 1}. ${t}`),
  ]
    .filter((x, i) => x !== '' || i > 1)
    .join('\n');
};

const jsonIn = (text: string): unknown => {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  for (const [a, b] of [
    [cleaned.indexOf('{'), cleaned.lastIndexOf('}')],
    [cleaned.indexOf('['), cleaned.lastIndexOf(']')],
  ] as const) {
    if (a < 0 || b <= a) continue;
    try {
      return JSON.parse(cleaned.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1'));
    } catch {
      /* try the next shape */
    }
  }
  return null;
};

/** The translated lines (null where one is missing), forgiving fences, objects keyed by number and stray numbering. */
export const parseTranslationReply = (text: string, count: number): (string | null)[] => {
  const data = jsonIn(text) as Record<string, unknown> | unknown[] | null;
  let list: unknown[] = [];
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.lines)) list = data.lines;
  else if (data && Array.isArray(data.translations)) list = data.translations;
  else if (data && typeof data === 'object') list = Array.from({ length: count }, (_, i) => (data as Record<string, unknown>)[String(i + 1)]);
  return Array.from({ length: count }, (_, i) => {
    const v = list[i];
    if (typeof v !== 'string') return null;
    const clean = v.replace(/^\s*\d+[.)]\s+/, '').trim();
    return clean || null;
  });
};

export const metadataPrompt = (title: string, description: string, lang: string): string => {
  const l = language(lang);
  return [
    `Translate this YouTube title and description into ${l.name} (${l.code}). Keep links, timestamps, hashtags and names as they are; keep the title under 100 characters.`,
    'Answer with JSON only: {"title": "...", "description": "..."}',
    '',
    `Title: ${title}`,
    'Description:',
    description,
  ].join('\n');
};

export const parseMetadataReply = (text: string): { title: string; description: string } | null => {
  const data = jsonIn(text) as Record<string, unknown> | null;
  if (!data || typeof data.title !== 'string') return null;
  return { title: data.title.trim().slice(0, 100), description: typeof data.description === 'string' ? data.description.trim().slice(0, 5000) : '' };
};

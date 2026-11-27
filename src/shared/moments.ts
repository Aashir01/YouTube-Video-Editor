/**
 * Find Shorts: pick the moments of a long video that work on their own as YouTube Shorts.
 * The AI reads the timeline transcript as numbered sentences and answers with sentence numbers,
 * so every moment starts and ends exactly on a sentence boundary. Everything here is pure.
 */
import type { Word } from './schema';

/** One sentence of the timeline transcript, in timeline seconds. */
export interface Sentence {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface Moment {
  id: string;
  /** timeline seconds */
  start: number;
  end: number;
  title: string;
  /** its opening line */
  hook: string;
  /** why it works as a Short */
  why: string;
  /** 1–10, how well it should do as a Short */
  score: number;
  /** the Short project made from it */
  shortId?: string;
}

export interface MomentOptions {
  count: number;
  minSec: number;
  maxSec: number;
  /** what to look for, in the user's words */
  focus?: string;
}

export interface MomentsState {
  createdAt: string;
  /** the timeline words when the moments were found: a different signature means the edit changed since */
  signature: string;
  options: MomentOptions;
  moments: Moment[];
}

export const MOMENT_LENGTHS = { short: [15, 30], standard: [20, 60], long: [30, 90] } as const;

const SENTENCE_END = /[.!?…]["')\]]?$/;

/** Group words into sentences: at sentence-ending punctuation, pauses, or ~30 words for run-ons. */
export const toSentences = (words: Word[], maxWords = 30, maxGap = 0.9): Sentence[] => {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    const text = cur
      .map((w) => w.text.trim())
      .filter(Boolean)
      .join(' ');
    if (cur.length && text) out.push({ index: out.length, start: cur[0]!.start, end: cur[cur.length - 1]!.end, text });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && cur.length && (SENTENCE_END.test(prev.text.trim()) || w.start - prev.end > maxGap || cur.length >= maxWords)) flush();
    cur.push(w);
  });
  flush();
  return out;
};

/** A short fingerprint of the timeline words (text and timing). */
export const wordsSignature = (words: Word[]): string => {
  let h = 2166136261;
  for (const w of words) {
    const s = `${w.text}|${Math.round(w.start * 20)}|`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return `${(h >>> 0).toString(36)}-${words.length}`;
};

const clock = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
};

export const MOMENTS_SYSTEM =
  'You are an expert YouTube Shorts editor. You find the moments of a long video that will stop the scroll and hold viewers to the end, and you only answer with the JSON that is asked for.';

/** The request for one stretch of the transcript (sentence numbers are global). */
export const momentsPrompt = (sentences: Sentence[], opts: MomentOptions, videoName?: string): string => {
  const lines: string[] = [];
  if (videoName) lines.push(`Video: "${videoName}"`);
  lines.push(
    `Find the ${opts.count} best moments of this video to post as YouTube Shorts.`,
    '',
    'Rules:',
    '- A Short is a continuous run of sentences, from sentence "from" to sentence "to" (both included).',
    `- It must last ${opts.minSec}–${opts.maxSec} seconds (use the times shown).`,
    '- It starts on a hook that makes viewers stay: a bold claim, a question, a surprising fact or a strong emotion. Never start mid-thought or on words that need earlier context ("so", "and", "as I said", "that one").',
    '- It makes sense on its own and ends on a payoff: an answer, a punchline, an insight or a clear conclusion.',
    '- Prefer surprising, funny, emotional, controversial or very practical moments.',
    '- Moments must not overlap.',
  );
  if (opts.focus) lines.push(`- What the creator wants: ${opts.focus}`);
  lines.push(
    '',
    'Score each moment from 1 to 10 for how well it would do as a Short.',
    '',
    'Answer with JSON only, no other text:',
    '{"shorts":[{"from":12,"to":19,"title":"Catchy title, at most 60 characters","why":"One sentence on why it works","score":8}]}',
    '',
    'Transcript (sentence number, start–end, text):',
    ...sentences.map((s) => `[${s.index}] ${clock(s.start)}–${clock(s.end)} ${s.text}`),
  );
  return lines.join('\n');
};

export interface RawMoment {
  from: number;
  to: number;
  title: string;
  why: string;
  score: number;
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : NaN);

/** Read the moments out of a model reply, forgiving code fences, prose around the JSON and trailing commas. */
export const parseMomentsReply = (text: string): RawMoment[] => {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const spans = [
    [cleaned.indexOf('{'), cleaned.lastIndexOf('}')],
    [cleaned.indexOf('['), cleaned.lastIndexOf(']')],
  ];
  for (const [a, b] of spans) {
    if (a! < 0 || b! <= a!) continue;
    let data: unknown;
    try {
      data = JSON.parse(cleaned.slice(a, b! + 1).replace(/,\s*([}\]])/g, '$1'));
    } catch {
      continue;
    }
    const obj = data as Record<string, unknown>;
    const list = Array.isArray(data) ? data : Array.isArray(obj?.shorts) ? obj.shorts : Array.isArray(obj?.moments) ? obj.moments : null;
    if (!list) continue;
    return list.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const it = item as Record<string, unknown>;
      const from = num(it.from ?? it.start ?? it.first);
      const to = num(it.to ?? it.end ?? it.last);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
      const score = num(it.score);
      return [
        {
          from,
          to,
          title: String(it.title ?? '').trim().slice(0, 90),
          why: String(it.why ?? it.reason ?? '').trim().slice(0, 300),
          score: Number.isFinite(score) ? Math.min(10, Math.max(1, Math.round(score))) : 5,
        },
      ];
    });
  }
  return [];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Turn the model's picks into moments: snap to sentence boundaries with a little air,
 * bring each within the length limits (trimming or extending by whole sentences),
 * drop overlaps (the better score wins) and keep the best `count`.
 */
export const resolveMoments = (raw: RawMoment[], sentences: Sentence[], opts: MomentOptions): Moment[] => {
  const n = sentences.length;
  if (!n) return [];
  const picked: Omit<Moment, 'id'>[] = [];
  for (const m of [...raw].sort((x, y) => y.score - x.score)) {
    let a = Math.round(Math.min(m.from, m.to));
    let b = Math.round(Math.max(m.from, m.to));
    if (b < 0 || a > n - 1) continue;
    a = Math.max(0, a);
    b = Math.min(n - 1, b);
    const len = () => sentences[b]!.end - sentences[a]!.start;
    while (len() > opts.maxSec && b > a) b--;
    // too short: carry on with the next sentences while the speech continues
    while (len() < opts.minSec && b < n - 1 && sentences[b + 1]!.start - sentences[b]!.end < 2.5 && sentences[b + 1]!.end - sentences[a]!.start <= opts.maxSec) b++;
    if (len() < opts.minSec * 0.75 || len() > opts.maxSec * 1.15) continue;
    const prevEnd = a > 0 ? sentences[a - 1]!.end : 0;
    const nextStart = b < n - 1 ? sentences[b + 1]!.start : Infinity;
    const start = r3(Math.max(0, sentences[a]!.start - 0.15, a > 0 ? (prevEnd + sentences[a]!.start) / 2 : 0));
    const end = r3(Math.min(sentences[b]!.end + 0.3, (sentences[b]!.end + nextStart) / 2));
    // overlapping an earlier (better) pick by more than a third of the shorter one: skip it
    const clash = picked.some((p) => Math.min(end, p.end) - Math.max(start, p.start) > Math.min(end - start, p.end - p.start) / 3);
    if (clash) continue;
    const hook = sentences[a]!.text.length > 160 ? `${sentences[a]!.text.slice(0, 157)}…` : sentences[a]!.text;
    const fallbackTitle = sentences[a]!.text.split(/\s+/).slice(0, 7).join(' ').replace(/[,.;:!?…]+$/, '');
    picked.push({ start, end, title: m.title || fallbackTitle, hook, why: m.why, score: m.score });
    if (picked.length >= opts.count) break;
  }
  return picked.map((p, i) => ({ id: `m${i + 1}`, ...p }));
};

/** Split long transcripts into overlapping stretches that fit a modest context window. */
export const transcriptWindows = (sentences: Sentence[], maxChars = 24000, overlap = 12): Sentence[][] => {
  const out: Sentence[][] = [];
  let i = 0;
  while (i < sentences.length) {
    let chars = 0;
    let j = i;
    while (j < sentences.length && (j === i || chars + sentences[j]!.text.length + 24 <= maxChars)) chars += sentences[j++]!.text.length + 24;
    out.push(sentences.slice(i, j));
    if (j >= sentences.length) break;
    i = Math.max(i + 1, j - overlap);
  }
  return out;
};

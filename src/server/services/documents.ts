import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Word } from '../../shared/schema';

export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.srt', '.vtt', '.html', '.htm', '.xml', '.yaml', '.yml', '.rtf'];

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export const decodeEntities = (s: string): string =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Readable text from HTML: drops scripts/styles/nav chrome, keeps paragraph breaks. */
export const htmlToText = (html: string): string => {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<h([1-6])[^>]*>/gi, '\n# ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1]!.length > 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const extractTitle = (html: string): string => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? decodeEntities(m[1]!.replace(/<[^>]+>/g, '')).trim() : '';
};

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const ts = (s: string): number => {
  const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
};

export const parseSubtitles = (content: string): Cue[] => {
  const cues: Cue[] = [];
  const blocks = content.replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() && l.trim() !== 'WEBVTT');
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;
    const [a, b] = lines[idx]!.split('-->');
    const start = ts(a ?? '');
    const end = ts((b ?? '').split(' ').filter(Boolean)[0] ?? '');
    const text = lines
      .slice(idx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (Number.isFinite(start) && Number.isFinite(end) && text) cues.push({ start, end, text: decodeEntities(text) });
  }
  return cues;
};

/** Spread each cue's words across its time span (weighted by word length). */
export const cuesToWords = (cues: Cue[]): Word[] => {
  const words: Word[] = [];
  for (const c of cues) {
    const parts = c.text.split(/\s+/).filter(Boolean);
    const weights = parts.map((w) => Math.max(1, w.length));
    const total = weights.reduce((a, b) => a + b, 0);
    let t = c.start;
    parts.forEach((w, i) => {
      const d = ((c.end - c.start) * weights[i]!) / total;
      words.push({ text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + d) * 1000) / 1000 });
      t += d;
    });
  }
  return words;
};

export const wordsToSrt = (words: Word[], maxWords = 8, maxDur = 4): string => {
  const cues: Cue[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, text: cur.map((w) => w.text.trim()).join(' ') });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && (cur.length >= maxWords || w.end - cur[0]!.start > maxDur || /[.!?]$/.test(cur[cur.length - 1]!.text) || w.start - cur[cur.length - 1]!.end > 0.8)) flush();
    cur.push(w);
  }
  flush();
  const fmt = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join('\n');
};

export const extractDocumentText = async (file: string): Promise<{ text: string; pages?: number; title?: string }> => {
  const ext = path.extname(file).toLowerCase();
  const buf = await fsp.readFile(file);
  if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { text: text.replace(/[ \t]+\n/g, '\n').trim(), pages: totalPages };
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    const r = await mammoth.extractRawText({ buffer: buf });
    return { text: r.value.trim() };
  }
  const raw = buf.toString('utf8');
  if (ext === '.html' || ext === '.htm') return { text: htmlToText(raw), title: extractTitle(raw) };
  if (ext === '.srt' || ext === '.vtt') return { text: parseSubtitles(raw).map((c) => c.text).join(' ') };
  if (ext === '.rtf') return { text: raw.replace(/\\[a-z]+-?\d* ?|[{}]/gi, '').trim() };
  return { text: raw.trim() };
};

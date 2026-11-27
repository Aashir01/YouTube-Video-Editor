import { describe, expect, it } from 'vitest';
import type { Word } from './schema';
import { missingCounts, parseMetadataReply, parseTranslationReply, splitWords, subtitleSentences, subtitleSource, translatedWords, translationPrompt } from './subtitles';
import { applyOps } from './ops';
import { createProject } from './timeline';

/** words 0.3 s long, 0.05 s apart; a sentence ends at "." */
const speak = (text: string, start = 0): Word[] => {
  let t = start;
  return text.split(' ').map((w) => {
    const word = { text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.3) * 1000) / 1000 };
    t += 0.35;
    return word;
  });
};

describe('subtitles in other languages', () => {
  const words = speak('Hello there everyone. This part is not translated yet.');

  it('replace each translated sentence, spread over the time it was said', () => {
    const [first] = subtitleSentences(words);
    expect(first!.key).toBe('Hello there everyone.');
    const out = translatedWords(words, { 'Hello there everyone.': 'Hola a todos.' }, 'es');
    expect(out.map((w) => w.text)).toEqual(['Hola', 'a', 'todos.', 'This', 'part', 'is', 'not', 'translated', 'yet.']);
    const hola = out.slice(0, 3);
    expect(hola[0]!.start).toBe(first!.start);
    expect(hola[2]!.end).toBeLessThanOrEqual(first!.end + 0.001);
    for (let i = 1; i < hola.length; i++) expect(hola[i]!.start).toBeGreaterThanOrEqual(hola[i - 1]!.end);
    // longer words get more time
    expect(hola[2]!.end - hola[2]!.start).toBeGreaterThan(hola[1]!.end - hola[1]!.start);
    // the untranslated sentence keeps its original timing
    expect(out[3]).toEqual(words[3]);
    expect(translatedWords(words, undefined)).toBe(words);
  });

  it('come from every captions clip, also after an edit split them', () => {
    const p = createProject({ name: 'subs' });
    p.assets.push({ id: 'v', kind: 'video', name: 'v.mp4', file: 'v.mp4', meta: { duration: 30, hasAudio: true } } as never);
    applyOps(p, [
      { op: 'addClip', trackId: 'Main', clip: { id: 'talk', type: 'video', assetId: 'v', start: 0, duration: 10 } },
      { op: 'addClip', trackId: 'Captions', clip: { id: 'cap', type: 'captions', mode: 'auto', start: 0, duration: 10 } },
      { op: 'rippleDelete', from: 1, to: 1.5 },
    ]);
    expect(p.tracks.find((t) => t.name === 'Captions')!.clips.length).toBe(2);
    const all = subtitleSource(p, { v: words });
    expect(all.map((w) => w.text).join(' ')).toBe('Hello there everyone. part is not translated yet.');
  });

  it('cut scripts without spaces into a few characters at a time', () => {
    expect(splitWords('你好世界今天天气很好。', 'zh-Hans')).toEqual(['你好世界', '今天天气', '很好。']);
    expect(splitWords('สวัสดีครับทุกคน', 'th')).toEqual(['สวัสดี', 'ครับทุก', 'คน']);
    expect(splitWords('hola  a todos', 'es')).toEqual(['hola', 'a', 'todos']);
  });

  it('count what is new since the last translation', () => {
    expect(missingCounts(words, { languages: ['es', 'fr'], table: { es: { 'Hello there everyone.': 'Hola a todos.' } } })).toEqual({ es: 1, fr: 2 });
    expect(missingCounts(words, null)).toEqual({});
  });

  it('ask with numbered lines and read the answer forgivingly', () => {
    const prompt = translationPrompt(['Hello.', 'Goodbye.'], 'pt', 'Demo');
    expect(prompt).toContain('into Portuguese (pt)');
    expect(prompt).toContain('exactly 2 lines');
    expect(prompt).toMatch(/1\. Hello\.\n2\. Goodbye\./);
    expect(parseTranslationReply('```json\n{"lines": ["Olá.", "Adeus.",]}\n```', 2)).toEqual(['Olá.', 'Adeus.']);
    expect(parseTranslationReply('{"1": "Olá.", "2": "Adeus."}', 2)).toEqual(['Olá.', 'Adeus.']);
    expect(parseTranslationReply('["1. Olá."]', 2)).toEqual(['Olá.', null]);
    expect(parseTranslationReply('Sorry, I cannot.', 2)).toEqual([null, null]);
    expect(parseMetadataReply('{"title": "Título", "description": "Descripción"}')).toEqual({ title: 'Título', description: 'Descripción' });
    expect(parseMetadataReply('no json')).toBeNull();
  });
});

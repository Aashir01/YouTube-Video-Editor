import { describe, expect, it } from 'vitest';
import type { Word } from './schema';
import { momentsPrompt, parseMomentsReply, resolveMoments, toSentences, transcriptWindows, wordsSignature, type Sentence } from './moments';

/** words spoken back to back, 0.3 s each, with an optional pause before some of them */
const speak = (text: string, start = 0, pauses: Record<number, number> = {}): Word[] => {
  let t = start;
  return text.split(' ').map((w, i) => {
    t += pauses[i] ?? 0;
    const word = { text: w, start: t, end: t + 0.3 };
    t += 0.3;
    return word;
  });
};

/** n sentences of `len` seconds each, back to back with 0.2 s between them */
const sentences = (n: number, len = 5): Sentence[] => Array.from({ length: n }, (_, i) => ({ index: i, start: i * (len + 0.2), end: i * (len + 0.2) + len, text: `Sentence number ${i} says something.` }));

describe('find Shorts', () => {
  it('reads the transcript as sentences: punctuation, pauses and very long runs end one', () => {
    const s = toSentences(speak('Hello there. This is a test with no pause and a long pause here then more words', 0, { 13: 1.5 }));
    expect(s.map((x) => x.text)).toEqual(['Hello there.', 'This is a test with no pause and a long pause', 'here then more words']);
    expect(s[1]!.start).toBeCloseTo(0.6);
    expect(toSentences(speak(Array.from({ length: 70 }, () => 'word').join(' '))).length).toBe(3); // 30 + 30 + 10
  });

  it('asks with global sentence numbers, times and the creator’s focus', () => {
    const prompt = momentsPrompt(sentences(3).slice(1), { count: 4, minSec: 20, maxSec: 60, focus: 'the funny parts' }, 'My video');
    expect(prompt).toContain('Video: "My video"');
    expect(prompt).toContain('Find the 4 best moments');
    expect(prompt).toContain('20–60 seconds');
    expect(prompt).toContain('What the creator wants: the funny parts');
    expect(prompt).toContain('[1] 00:05.2–00:10.2 Sentence number 1');
    expect(prompt).not.toContain('[0]');
  });

  it('forgives code fences, prose, trailing commas and numbers in strings', () => {
    const reply = 'Sure! Here you go:\n```json\n{"shorts": [\n {"from": "3", "to": 8, "title": "Big idea", "why": "Strong claim", "score": 9.4},\n {"from": 10, "title": "no end"},\n {"start": 12, "end": 14, "reason": "funny", "score": "7"},\n]}\n```\nHope it helps.';
    expect(parseMomentsReply(reply)).toEqual([
      { from: 3, to: 8, title: 'Big idea', why: 'Strong claim', score: 9 },
      { from: 12, to: 14, title: '', why: 'funny', score: 7 },
    ]);
    expect(parseMomentsReply('[{"from":1,"to":2}]')).toEqual([{ from: 1, to: 2, title: '', why: '', score: 5 }]);
    expect(parseMomentsReply('I could not find anything.')).toEqual([]);
  });

  it('snaps to sentences with a little air, keeps lengths in bounds and drops overlaps', () => {
    const s = sentences(40); // 5 s sentences
    const out = resolveMoments(
      [
        { from: 2, to: 7, title: 'Second best', why: '', score: 7 }, // 6 sentences ≈ 31 s
        { from: 20, to: 39, title: 'Too long', why: '', score: 9 }, // trimmed to ≤ 60 s
        { from: 4, to: 9, title: 'Overlaps the second', why: '', score: 6 },
        { from: 30, to: 30, title: '', why: '', score: 5 }, // 5 s: extended to ≥ 20 s
        { from: 50, to: 60, title: 'Out of range', why: '', score: 10 },
      ],
      s,
      { count: 5, minSec: 20, maxSec: 60 },
    );
    expect(out.map((m) => m.title)).toEqual(['Too long', 'Second best', 'Sentence number 30 says something']);
    const [long, second, short] = out;
    expect(long!.end - long!.start).toBeLessThanOrEqual(60.5);
    expect(long!.start).toBeCloseTo(s[20]!.start - 0.1, 2); // half of the 0.2 s gap before it
    expect(second!.start).toBeCloseTo(s[2]!.start - 0.1, 2);
    expect(second!.end).toBeCloseTo(s[7]!.end + 0.1, 2);
    expect(second!.hook).toBe(s[2]!.text);
    expect(short!.end - short!.start).toBeGreaterThanOrEqual(20);
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(resolveMoments([{ from: 2, to: 7, title: '', why: '', score: 5 }], s, { count: 5, minSec: 40, maxSec: 60 }).length).toBe(1); // extended to fit
    expect(resolveMoments([{ from: 0, to: 39, title: '', why: '', score: 5 }, { from: 0, to: 3, title: '', why: '', score: 4 }], s, { count: 1, minSec: 20, maxSec: 60 }).length).toBe(1);
  });

  it('splits long transcripts into overlapping stretches that cover everything', () => {
    const s = sentences(500);
    const windows = transcriptWindows(s, 6000, 10);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]![0]!.index).toBe(0);
    expect(windows.at(-1)!.at(-1)!.index).toBe(499);
    for (let i = 1; i < windows.length; i++) expect(windows[i]![0]!.index).toBe(windows[i - 1]!.at(-1)!.index + 1 - 10);
    expect(transcriptWindows(sentences(5)).length).toBe(1);
  });

  it('fingerprints the words, so a changed edit is noticed', () => {
    const w = speak('one two three four');
    expect(wordsSignature(w)).toBe(wordsSignature(speak('one two three four')));
    expect(wordsSignature(w)).not.toBe(wordsSignature(speak('one two three five')));
    expect(wordsSignature(w)).not.toBe(wordsSignature(speak('one two three four', 1)));
  });
});

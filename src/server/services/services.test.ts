import { describe, expect, it } from 'vitest';
import { alignmentToWords, estimateWordTimings, speakableText } from './tts';
import { cleanWords } from './transcribe';
import { cuesToWords, htmlToText, parseSubtitles, wordsToSrt } from './documents';
import { checkSceneCode } from '../../shared/code-check';

describe('TTS helpers', () => {
  it('converts ElevenLabs character alignment into words', () => {
    const text = 'Hi there.';
    const chars = text.split('');
    const words = alignmentToWords({
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * 0.1),
      character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1),
    });
    expect(words).toEqual([
      { text: 'Hi', start: 0, end: 0.2 },
      { text: 'there.', start: 0.3, end: 0.9 },
    ]);
  });

  it('estimates word timings that fill the audio and pause at punctuation', () => {
    const w = estimateWordTimings('Hello world. This is a test, okay?', 4);
    expect(w).toHaveLength(7);
    expect(w[0]!.start).toBe(0);
    expect(w[6]!.end).toBeLessThanOrEqual(4);
    expect(w[2]!.start - w[1]!.end).toBeGreaterThan(0.05); // pause after "world."
  });

  it('strips markup that should not be spoken', () => {
    expect(speakableText('This is *huge* [pause] news')).toBe('This is huge news');
  });
});

describe('transcript cleanup', () => {
  it('merges punctuation tokens and fixes overlaps', () => {
    const w = cleanWords([
      { text: ' Hello', start: 0, end: 0.5 },
      { text: ',', start: 0.5, end: 0.5 },
      { text: 'world', start: 0.4, end: 0.9 },
      { text: '', start: 1, end: 1.1 },
    ]);
    expect(w).toEqual([
      { text: 'Hello,', start: 0, end: 0.5 },
      { text: 'world', start: 0.5, end: 0.9 },
    ]);
  });
});

describe('documents & subtitles', () => {
  const srt = `1\n00:00:01,000 --> 00:00:02,500\nHello <i>there</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line`;
  it('parses SRT/VTT cues and spreads words over them', () => {
    const cues = parseSubtitles(srt);
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: 'Hello there' },
      { start: 3, end: 4, text: 'Second line' },
    ]);
    const words = cuesToWords(cues);
    expect(words.map((x) => x.text)).toEqual(['Hello', 'there', 'Second', 'line']);
    expect(words[1]!.end).toBe(2.5);
    const vtt = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHi');
    expect(vtt[0]).toEqual({ start: 1, end: 2, text: 'Hi' });
  });

  it('writes valid SRT from words', () => {
    const out = wordsToSrt([
      { text: 'One', start: 0, end: 0.4 },
      { text: 'two.', start: 0.4, end: 0.9 },
      { text: 'Three', start: 2, end: 2.5 },
    ]);
    expect(out).toContain('1\n00:00:00,000 --> 00:00:00,900\nOne two.');
    expect(out).toContain('2\n00:00:02,000 --> 00:00:02,500\nThree');
  });

  it('extracts readable text from HTML', () => {
    const t = htmlToText('<html><head><style>x{}</style></head><body><nav>menu</nav><h1>Title</h1><p>First &amp; second.</p><script>evil()</script><ul><li>A</li><li>B</li></ul></body></html>');
    expect(t).toContain('# Title');
    expect(t).toContain('First & second.');
    expect(t).toContain('• A');
    expect(t).not.toContain('evil');
    expect(t).not.toContain('menu');
  });
});

describe('code scene checks', () => {
  it('accepts a valid scene', () => {
    const r = checkSceneCode(`import React from 'react';\nimport { AbsoluteFill, useCurrentFrame } from 'remotion';\nimport { useTheme } from 'director';\nexport default function Scene() { const f = useCurrentFrame(); const { u } = useTheme(); return <AbsoluteFill style={{ opacity: f / 30, fontSize: 40 * u }}>Hi</AbsoluteFill>; }`);
    expect(r).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('rejects syntax errors, foreign imports, randomness and timers', () => {
    expect(checkSceneCode('export default function S() { return <div> }').ok).toBe(false);
    const r = checkSceneCode(`import fs from 'fs';\nexport default function S() { setTimeout(() => 0, 1); return Math.random(); }`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/fs/);
    expect(r.errors.join(' ')).toMatch(/Math.random/);
    expect(r.errors.join(' ')).toMatch(/Timers/);
    expect(checkSceneCode(`export const X = () => null;`).errors.join(' ')).toMatch(/export default/);
  });
});

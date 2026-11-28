import { describe, expect, it } from 'vitest';
import { compactNumber, ideaBrief, outlierScore, parseIsoDuration, titlePatterns, type IdeaVideo } from './ideas';

const video = (title: string, extra: Partial<IdeaVideo> = {}): IdeaVideo => ({
  id: title,
  title,
  channelId: 'c',
  channelTitle: 'Chan',
  publishedAt: '2026-11-01T00:00:00Z',
  thumbnail: '',
  views: 100_000,
  likes: 0,
  comments: 0,
  duration: 600,
  isShort: false,
  channelSubscribers: 1000,
  channelAverage: 5000,
  outlier: 20,
  viewsPerDay: 1000,
  ...extra,
});

describe('idea radar', () => {
  it('reads YouTube durations', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('P1DT1M')).toBe(86460);
    expect(parseIsoDuration('nonsense')).toBe(0);
  });

  it('scores views against the channel average, with a floor for tiny channels', () => {
    expect(outlierScore(500_000, 10_000_000, 200)).toEqual({ average: 50000, outlier: 10 });
    expect(outlierScore(5000, 300, 3).outlier).toBe(5);
  });

  it('finds what the outliers share', () => {
    const p = titlePatterns([
      video('How I made $1000 with AI tools in 7 days', { isShort: true, outlier: 30 }),
      video('Make money with AI tools: the honest truth', { outlier: 12 }),
      video('AI tools nobody talks about?', { outlier: 8 }),
      video('Cooking pasta at home', { outlier: 4 }),
    ]);
    expect(p.phrases[0]).toEqual({ text: 'ai tools', count: 3 });
    expect(p.phrases.some((x) => x.text === 'ai')).toBe(false);
    expect(p.withNumber).toBe(25);
    expect(p.withQuestion).toBe(25);
    expect(p.shortsShare).toBe(25);
    expect(p.medianOutlier).toBe(12);
  });

  it('writes a brief that takes the idea, not the video', () => {
    expect(compactNumber(1_234_567)).toBe('1.2M');
    expect(compactNumber(45_600)).toBe('46K');
    const b = ideaBrief(video('Why your channel is stuck', { views: 2_400_000, outlier: 18.5 }), 'youtube growth');
    expect(b).toMatch(/"Why your channel is stuck" by Chan got 2\.4M views, 18\.5× that channel's average/);
    expect(b).toMatch(/Do not copy/);
  });
});

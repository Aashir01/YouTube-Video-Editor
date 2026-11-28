/**
 * Idea radar: videos in a niche that did far better than their channel usually does ("outliers").
 * A video with 10x its channel's average views found an idea people want, whatever the channel's
 * size, so it is a better signal than raw views (big channels get views for anything).
 */

export interface IdeaVideo {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
  views: number;
  likes: number;
  comments: number;
  /** seconds */
  duration: number;
  isShort: boolean;
  channelSubscribers: number;
  /** the channel's average views per video */
  channelAverage: number;
  /** views ÷ the channel's average */
  outlier: number;
  viewsPerDay: number;
}

export interface IdeaPatterns {
  /** words and two-word phrases the outliers' titles share, most common first */
  phrases: { text: string; count: number }[];
  averageTitleLength: number;
  withNumber: number;
  withQuestion: number;
  shortsShare: number;
  medianOutlier: number;
}

export interface IdeasResult {
  /** set when there is no way to read YouTube yet (no Data API key, no connected channel) */
  needsKey?: boolean;
  query: string;
  region?: string;
  language?: string;
  days: number;
  fetchedAt: string;
  videos: IdeaVideo[];
  patterns: IdeaPatterns;
}

/** ISO 8601 duration ("PT1H2M3S") in seconds. */
export const parseIsoDuration = (s: string): number => {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s ?? '');
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
};

/**
 * How far a video beat its channel. Channels with very few videos or views make noisy averages, so
 * the average gets a floor (and tiny channels can't look like giants with a few hundred views).
 */
export const outlierScore = (views: number, channelViews: number, channelVideos: number) => {
  const average = channelVideos > 0 ? channelViews / channelVideos : 0;
  return { average: Math.round(average), outlier: Math.round((views / Math.max(average, 1000)) * 10) / 10 };
};

const STOP = new Set(
  'a an the and or but of to in on for with at by from is are was were be been it its this that these those i you he she we they my your our their me him her us them what how why when who which do does did not no so if as up out about into over than then too very just can will would should could have has had get got make made one two'.split(' '),
);
const words = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

export const titlePatterns = (videos: IdeaVideo[]): IdeaPatterns => {
  const counts = new Map<string, number>();
  for (const v of videos) {
    const w = words(v.title);
    const seen = new Set<string>();
    for (let i = 0; i < w.length; i++) {
      if (!STOP.has(w[i]!) && w[i]!.length > 2) seen.add(w[i]!);
      if (i + 1 < w.length && !STOP.has(w[i]!) && !STOP.has(w[i + 1]!)) seen.add(`${w[i]} ${w[i + 1]}`);
    }
    for (const s of seen) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const min = Math.max(2, Math.ceil(videos.length * 0.15));
  const phrases = [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || b[0].split(' ').length - a[0].split(' ').length)
    // a phrase hides the single words it contains when they are not more common
    .filter(([t, n], _i, all) => t.includes(' ') || !all.some(([o, m]) => o.includes(' ') && o.split(' ').includes(t) && m >= n))
    .slice(0, 12)
    .map(([text, count]) => ({ text, count }));
  const n = Math.max(1, videos.length);
  const sorted = videos.map((v) => v.outlier).sort((a, b) => a - b);
  return {
    phrases,
    averageTitleLength: Math.round(videos.reduce((s, v) => s + v.title.length, 0) / n),
    withNumber: Math.round((videos.filter((v) => /\d/.test(v.title)).length / n) * 100),
    withQuestion: Math.round((videos.filter((v) => /\?/.test(v.title)).length / n) * 100),
    shortsShare: Math.round((videos.filter((v) => v.isShort).length / n) * 100),
    medianOutlier: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0,
  };
};

export const compactNumber = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));

/** A brief for an original video inspired by an outlier (not a copy). */
export const ideaBrief = (v: IdeaVideo, query: string) =>
  `Inspired by an outlier in "${query}": "${v.title}" by ${v.channelTitle} got ${compactNumber(v.views)} views, ${v.outlier}× that channel's average. Make my own original ${v.isShort ? 'Short' : 'video'} on the idea behind it: find what made people click (the promise in the title), then give it a fresh angle, my own examples and a stronger hook. Do not copy the title or the content.`;

/**
 * Idea radar: search YouTube for a niche, keep the videos that beat their channel's average by the
 * most (see shared/ideas.ts), and note what their titles share. Results are cached for a day: a
 * search costs 100 of the API's 10,000 daily quota units, the lookups 1 each.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CACHE_DIR, getSettings } from './config';
import { youtubeApiGet } from './services/youtube';
import { outlierScore, parseIsoDuration, titlePatterns, type IdeasResult, type IdeaVideo } from '../shared/ideas';

export interface IdeaQuery {
  query: string;
  /** ISO country, e.g. "PK", "IN", "US" */
  region?: string;
  /** relevance language, e.g. "ur", "hi", "en" */
  language?: string;
  /** look back this many days (default 90) */
  days?: number;
  kind?: 'any' | 'shorts' | 'long';
  /** skip the day-long cache */
  fresh?: boolean;
}

interface SearchList {
  items?: { id?: { videoId?: string } }[];
}
interface VideoList {
  items?: {
    id: string;
    snippet: { title: string; channelId: string; channelTitle: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
  }[];
}
interface ChannelList {
  items?: { id: string; statistics?: { viewCount?: string; subscriberCount?: string; videoCount?: string } }[];
}

const DAY = 86_400_000;
const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Can the radar read YouTube (a Data API key or a connected channel)? */
export const canReadYouTube = () => Boolean(getSettings().keys.youtube || getSettings().youtube.refreshToken);

export const findIdeas = async (q: IdeaQuery): Promise<IdeasResult> => {
  const query = q.query.trim().slice(0, 120);
  if (query.length < 2) throw new Error('Type a niche or topic to search, e.g. "personal finance Pakistan"');
  const days = Math.min(365, Math.max(7, q.days ?? 90));
  const kind = q.kind ?? 'any';
  const region = q.region?.trim().toUpperCase() || undefined;
  const language = q.language?.trim().toLowerCase() || undefined;
  const key = crypto.createHash('sha1').update(JSON.stringify([query.toLowerCase(), region, language, days, kind])).digest('hex').slice(0, 16);
  const cacheFile = path.join(CACHE_DIR, `ideas-${key}.json`);
  if (!q.fresh) {
    const cached = await fsp.readFile(cacheFile, 'utf8').then((t) => JSON.parse(t) as IdeasResult, () => null);
    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < DAY) return cached;
  }

  const after = new Date(Date.now() - days * DAY).toISOString();
  const search = await youtubeApiGet<SearchList>('search', {
    part: 'id',
    type: 'video',
    q: query,
    order: 'viewCount',
    publishedAfter: after,
    maxResults: 50,
    regionCode: region,
    relevanceLanguage: language,
    videoDuration: kind === 'shorts' ? 'short' : kind === 'long' ? 'medium' : undefined,
  });
  const ids = [...new Set((search.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => Boolean(x)))];
  const videos: VideoList['items'] = [];
  for (const part of chunks(ids, 50)) videos.push(...((await youtubeApiGet<VideoList>('videos', { part: 'snippet,statistics,contentDetails', id: part.join(',') })).items ?? []));
  const channelIds = [...new Set(videos.map((v) => v.snippet.channelId))];
  const channels = new Map<string, NonNullable<ChannelList['items']>[number]>();
  for (const part of chunks(channelIds, 50)) for (const c of (await youtubeApiGet<ChannelList>('channels', { part: 'statistics', id: part.join(',') })).items ?? []) channels.set(c.id, c);

  const now = Date.now();
  const found: IdeaVideo[] = videos.map((v) => {
    const views = Number(v.statistics?.viewCount ?? 0);
    const ch = channels.get(v.snippet.channelId)?.statistics;
    const { average, outlier } = outlierScore(views, Number(ch?.viewCount ?? 0), Number(ch?.videoCount ?? 0));
    const duration = parseIsoDuration(v.contentDetails?.duration ?? '');
    const t = v.snippet.thumbnails ?? {};
    return {
      id: v.id,
      title: v.snippet.title,
      channelId: v.snippet.channelId,
      channelTitle: v.snippet.channelTitle,
      publishedAt: v.snippet.publishedAt,
      thumbnail: (t.medium ?? t.high ?? t.default)?.url ?? '',
      views,
      likes: Number(v.statistics?.likeCount ?? 0),
      comments: Number(v.statistics?.commentCount ?? 0),
      duration,
      isShort: duration > 0 && duration <= 180,
      channelSubscribers: Number(ch?.subscriberCount ?? 0),
      channelAverage: average,
      outlier,
      viewsPerDay: Math.round(views / Math.max(1, (now - new Date(v.snippet.publishedAt).getTime()) / DAY)),
    };
  });
  const picked = found
    .filter((v) => (kind === 'shorts' ? v.isShort : kind === 'long' ? !v.isShort : true))
    .sort((a, b) => b.outlier - a.outlier || b.views - a.views)
    .slice(0, 30);
  const result: IdeasResult = { query, region, language, days, fetchedAt: new Date().toISOString(), videos: picked, patterns: titlePatterns(picked.filter((v) => v.outlier >= 2)) };
  await fsp.writeFile(cacheFile, JSON.stringify(result)).catch(() => undefined);
  return result;
};

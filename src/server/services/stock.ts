import type { Settings } from '../config';

export interface StockResult {
  id: string;
  provider: 'pexels' | 'pixabay' | 'openverse';
  type: 'video' | 'image';
  thumb: string;
  url: string;
  width: number;
  height: number;
  duration?: number;
  author?: string;
  authorUrl?: string;
  pageUrl?: string;
  license: string;
  description?: string;
}

export interface StockQuery {
  query: string;
  type: 'video' | 'image';
  orientation?: 'landscape' | 'portrait' | 'square';
  count?: number;
}

const pickVideoFile = (files: { width?: number | null; height?: number | null; link: string; file_type?: string; quality?: string | null }[], portrait: boolean) => {
  const mp4 = files.filter((f) => (f.file_type ?? 'video/mp4').includes('mp4') && f.width && f.height);
  const target = portrait ? 1080 : 1920;
  const dim = (f: (typeof mp4)[number]) => (portrait ? f.height! : f.width!);
  const ok = mp4.filter((f) => dim(f) <= target * 1.05).sort((a, b) => dim(b) - dim(a));
  return ok[0] ?? mp4.sort((a, b) => dim(a) - dim(b))[0];
};

const pexels = async (q: StockQuery, key: string): Promise<StockResult[]> => {
  const n = Math.min(q.count ?? 8, 30);
  const orientation = q.orientation ? `&orientation=${q.orientation}` : '';
  if (q.type === 'video') {
    const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q.query)}&per_page=${n}${orientation}&size=medium`, { headers: { Authorization: key } });
    if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { videos: { id: number; width: number; height: number; duration: number; url: string; image: string; user?: { name: string; url: string }; video_files: { width: number; height: number; link: string; file_type: string; quality: string }[] }[] };
    return j.videos.flatMap((v) => {
      const f = pickVideoFile(v.video_files, q.orientation === 'portrait');
      if (!f) return [];
      return [{ id: `pexels-video-${v.id}`, provider: 'pexels' as const, type: 'video' as const, thumb: v.image, url: f.link, width: f.width ?? v.width, height: f.height ?? v.height, duration: v.duration, author: v.user?.name, authorUrl: v.user?.url, pageUrl: v.url, license: 'Pexels License (free to use, attribution appreciated)', description: decodeURIComponent(v.url.split('/').filter(Boolean).pop() ?? '').replace(/-\d+$/, '').replace(/-/g, ' ') }];
    });
  }
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q.query)}&per_page=${n}${orientation}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { photos: { id: number; width: number; height: number; url: string; photographer: string; photographer_url: string; alt?: string; src: Record<string, string> }[] };
  return j.photos.map((p) => ({ id: `pexels-photo-${p.id}`, provider: 'pexels', type: 'image', thumb: p.src.medium ?? p.src.small!, url: p.src.large2x ?? p.src.original!, width: p.width, height: p.height, author: p.photographer, authorUrl: p.photographer_url, pageUrl: p.url, license: 'Pexels License (free to use, attribution appreciated)', description: p.alt }));
};

const pixabay = async (q: StockQuery, key: string): Promise<StockResult[]> => {
  const n = Math.max(3, Math.min(q.count ?? 8, 50));
  const orient = q.orientation === 'portrait' ? 'vertical' : q.orientation === 'landscape' ? 'horizontal' : 'all';
  if (q.type === 'video') {
    const res = await fetch(`https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(q.query)}&per_page=${n}&safesearch=true`);
    if (!res.ok) throw new Error(`Pixabay ${res.status}`);
    const j = (await res.json()) as { hits: { id: number; pageURL: string; tags: string; duration: number; user: string; videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }> }[] };
    return j.hits.flatMap((h) => {
      const files = Object.values(h.videos).map((v) => ({ width: v.width, height: v.height, link: v.url, file_type: 'video/mp4' }));
      const f = pickVideoFile(files, q.orientation === 'portrait');
      if (!f) return [];
      const thumb = Object.values(h.videos).find((v) => v.thumbnail)?.thumbnail ?? '';
      return [{ id: `pixabay-video-${h.id}`, provider: 'pixabay' as const, type: 'video' as const, thumb, url: f.link, width: f.width ?? 0, height: f.height ?? 0, duration: h.duration, author: h.user, pageUrl: h.pageURL, license: 'Pixabay Content License (free to use)', description: h.tags }];
    });
  }
  const res = await fetch(`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q.query)}&image_type=photo&orientation=${orient}&per_page=${n}&safesearch=true`);
  if (!res.ok) throw new Error(`Pixabay ${res.status}`);
  const j = (await res.json()) as { hits: { id: number; pageURL: string; tags: string; webformatURL: string; largeImageURL: string; imageWidth: number; imageHeight: number; user: string }[] };
  return j.hits.map((h) => ({ id: `pixabay-photo-${h.id}`, provider: 'pixabay', type: 'image', thumb: h.webformatURL, url: h.largeImageURL, width: h.imageWidth, height: h.imageHeight, author: h.user, pageUrl: h.pageURL, license: 'Pixabay Content License (free to use)', description: h.tags }));
};

/** Openverse: openly licensed images, no key required. */
const openverse = async (q: StockQuery): Promise<StockResult[]> => {
  if (q.type !== 'image') return [];
  const aspect = q.orientation === 'portrait' ? '&aspect_ratio=tall' : q.orientation === 'landscape' ? '&aspect_ratio=wide' : '';
  const res = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q.query)}&page_size=${Math.min(q.count ?? 8, 20)}&license_type=commercial,modification${aspect}&mature=false`, { headers: { 'User-Agent': 'DirectorStudio/1.0' } });
  if (!res.ok) throw new Error(`Openverse ${res.status}`);
  const j = (await res.json()) as { results: { id: string; title?: string; url: string; thumbnail?: string; width?: number; height?: number; creator?: string; creator_url?: string; foreign_landing_url?: string; license: string; license_version?: string }[] };
  return j.results.map((r) => ({ id: `openverse-${r.id}`, provider: 'openverse', type: 'image', thumb: r.thumbnail ?? r.url, url: r.url, width: r.width ?? 0, height: r.height ?? 0, author: r.creator, authorUrl: r.creator_url, pageUrl: r.foreign_landing_url, license: `CC ${r.license.toUpperCase()} ${r.license_version ?? ''} (attribution required)`.trim(), description: r.title }));
};

export const stockProviders = (s: Settings) => ({
  pexels: Boolean(s.keys.pexels),
  pixabay: Boolean(s.keys.pixabay),
  openverse: true,
});

export const searchStock = async (q: StockQuery, s: Settings): Promise<{ results: StockResult[]; errors: string[] }> => {
  const jobs: Promise<StockResult[]>[] = [];
  if (s.keys.pexels) jobs.push(pexels(q, s.keys.pexels));
  if (s.keys.pixabay) jobs.push(pixabay(q, s.keys.pixabay));
  if (q.type === 'image' && jobs.length === 0) jobs.push(openverse(q));
  if (jobs.length === 0) {
    return { results: [], errors: ['No stock video provider configured. Add a free Pexels or Pixabay API key in Settings → Media.'] };
  }
  const settled = await Promise.allSettled(jobs);
  const results: StockResult[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') results.push(...r.value);
    else errors.push((r.reason as Error).message);
  }
  // interleave providers so the best of each shows first
  const byProvider = new Map<string, StockResult[]>();
  for (const r of results) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), r]);
  const mixed: StockResult[] = [];
  const lists = [...byProvider.values()];
  for (let i = 0; mixed.length < results.length; i++) for (const l of lists) if (l[i]) mixed.push(l[i]!);
  return { results: mixed.slice(0, q.count ?? 8), errors };
};

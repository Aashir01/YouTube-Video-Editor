import type { Settings } from '../config';
import { decodeEntities, extractTitle, htmlToText } from './documents';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const UA = 'Mozilla/5.0 (compatible; DirectorStudio/1.0; +https://github.com/aashir01/youtube-video-editor)';

const tavily = async (query: string, key: string, n: number): Promise<{ answer?: string; hits: SearchHit[] }> => {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ api_key: key, query, max_results: n, include_answer: true, search_depth: 'advanced' }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { answer?: string; results: { title: string; url: string; content: string }[] };
  return { answer: j.answer, hits: j.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 600) })) };
};

const brave = async (query: string, key: string, n: number): Promise<{ hits: SearchHit[] }> => {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`, { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const j = (await res.json()) as { web?: { results: { title: string; url: string; description: string }[] } };
  return { hits: (j.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: htmlToText(r.description) })) };
};

/** Keyless fallback: DuckDuckGo's HTML endpoint (best effort). */
const duckduckgo = async (query: string, n: number): Promise<{ hits: SearchHit[] }> => {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();
  const hits: SearchHit[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < n) {
    let url = decodeEntities(m[1]!);
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]!);
    if (url.startsWith('//')) url = `https:${url}`;
    hits.push({ title: htmlToText(m[2] ?? ''), url, snippet: htmlToText(m[3] ?? '') });
  }
  return { hits };
};

export const webSearch = async (query: string, s: Settings, n = 6): Promise<{ provider: string; answer?: string; hits: SearchHit[] }> => {
  if (s.keys.tavily) return { provider: 'tavily', ...(await tavily(query, s.keys.tavily, n)) };
  if (s.keys.brave) return { provider: 'brave', ...(await brave(query, s.keys.brave, n)) };
  return { provider: 'duckduckgo', ...(await duckduckgo(query, n)) };
};

/** Fetch a page as readable text, paginated with offset/limit. */
export const fetchUrlText = async (url: string, opts: { offset?: number; limit?: number } = {}): Promise<{ title: string; text: string; total: number; contentType: string }> => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const contentType = res.headers.get('content-type') ?? '';
  let title = '';
  let text: string;
  if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else {
    const body = await res.text();
    if (contentType.includes('html') || /<html/i.test(body.slice(0, 500))) {
      title = extractTitle(body);
      const main = /<(article|main)[^>]*>([\s\S]*?)<\/\1>/i.exec(body)?.[2];
      text = htmlToText(main && main.length > 800 ? main : body);
    } else text = body;
  }
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 12000;
  return { title, text: text.slice(offset, offset + limit), total: text.length, contentType };
};

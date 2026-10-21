import { z } from 'zod';
import { fetchUrlText, webSearch } from '../../services/web';
import { defineTool } from '../types';

export const webSearchTool = defineTool({
  name: 'web_search',
  category: 'research',
  readOnly: true,
  description: 'Search the web for current, verifiable facts, statistics, quotes and context. Returns titles, URLs and snippets. Follow up with fetch_url to read a source before quoting it.',
  schema: z.object({ query: z.string().min(2), count: z.number().int().min(1).max(10).default(6) }),
  execute: async (input, ctx) => {
    const r = await webSearch(input.query, ctx.settings, input.count);
    const lines = r.hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`);
    return { text: `${r.answer ? `Summary: ${r.answer}\n\n` : ''}${lines.join('\n') || 'No results.'}\n(provider: ${r.provider})`, summary: `${r.hits.length} results` };
  },
});

export const fetchUrl = defineTool({
  name: 'fetch_url',
  category: 'research',
  readOnly: true,
  description: 'Read a web page or PDF as clean text (paginated). Use it to verify facts and collect quotes/data with their source.',
  schema: z.object({ url: z.string().url(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1000).max(40000).default(12000) }),
  execute: async (input) => {
    const r = await fetchUrlText(input.url, { offset: input.offset, limit: input.limit });
    const more = input.offset + input.limit < r.total ? `\n… ${r.total - input.offset - input.limit} more characters (offset=${input.offset + input.limit})` : '';
    return { text: `${r.title ? `# ${r.title}\n` : ''}${r.text}${more}`, summary: r.title || new URL(input.url).hostname };
  },
});

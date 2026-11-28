import { z } from 'zod';
import { defineTool } from '../types';
import { findIdeas } from '../../ideas';
import { compactNumber } from '../../../shared/ideas';

export const findIdeasTool = defineTool({
  name: 'find_ideas',
  category: 'research',
  readOnly: true,
  description:
    'Idea radar: search YouTube for a niche and return the outlier videos of the last months (views far above their channel’s average, so the idea itself pulled people in), with views, the outlier factor, length and what their titles share. Use it to pick topics and title angles that are proven to work right now; then make an original take (never copy). Needs a YouTube Data API key or the connected channel. Each search uses 100 of the 10,000 daily quota units (results are cached for a day).',
  schema: z.object({
    query: z.string().min(2).max(120).describe('The niche or topic, e.g. "budget travel" or "cricket analysis"'),
    region: z.string().length(2).optional().describe('Country code, e.g. PK, IN, US'),
    language: z.string().max(5).optional().describe('Language code, e.g. ur, hi, en'),
    days: z.number().int().min(7).max(365).optional().describe('How far back (default 90)'),
    kind: z.enum(['any', 'shorts', 'long']).optional(),
  }),
  execute: async (input) => {
    const r = await findIdeas(input);
    const p = r.patterns;
    const lines = r.videos.slice(0, 15).map((v, i) => `${i + 1}. ${v.outlier}× "${v.title}" (${v.channelTitle}, ${compactNumber(v.views)} views, ${compactNumber(v.channelSubscribers)} subs, ${v.isShort ? 'Short' : `${Math.round(v.duration / 60)} min`}, ${v.publishedAt.slice(0, 10)})`);
    const shared = p.phrases.length ? `Shared in outlier titles: ${p.phrases.map((x) => `"${x.text}" (${x.count})`).join(', ')}. ` : '';
    return {
      text: `Outliers for "${r.query}" in the last ${r.days} days (views ÷ the channel's average views):\n${lines.join('\n') || 'none found'}\n\n${shared}Average title ${p.averageTitleLength} characters; ${p.withNumber}% have a number, ${p.withQuestion}% a question; ${p.shortsShare}% are Shorts.`,
      summary: `${r.videos.length} videos, best ${r.videos[0]?.outlier ?? 0}×`,
    };
  },
});

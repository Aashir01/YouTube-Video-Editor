import { z } from 'zod';
import { defineTool } from '../types';
import { getProject, mutate, timelineReadout } from './helpers';
import { applyReframes, planReframes } from '../../reframe';

export const autoReframe = defineTool({
  name: 'auto_reframe',
  category: 'edit',
  description:
    'Smart reframe: detect faces in video/image clips and point each crop at the main speaker (a locked crop when they stay put, smooth keyframed moves when they move, hard cuts with the footage). Run it after switching a project to 9:16 or whenever footage is cropped or zoomed, so speakers stay in frame. Runs locally. Default: every full-frame video/image clip.',
  schema: z.object({
    clipIds: z.array(z.string()).max(200).optional().describe('Clips to reframe (default: all full-frame video/image clips)'),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const results = await planReframes(p, input.clipIds, ctx.signal);
    if (!results.length) return { text: 'There are no video or image clips to reframe.', summary: 'nothing to reframe' };
    const changed = results.filter((r) => r.patch).length;
    const after = changed ? await mutate(ctx, 'Smart reframe', (d) => void applyReframes(d, results)) : p;
    const lines = results.map((r) => `- ${r.clipId}: ${r.summary}`).join('\n');
    return { text: `Smart reframe updated ${changed} of ${results.length} clip(s):\n${lines}\n\n${timelineReadout(after)}`, summary: `${changed}/${results.length} clips reframed` };
  },
});

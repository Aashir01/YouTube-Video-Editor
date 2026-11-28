import { z } from 'zod';
import { defineTool } from '../types';
import { readMoments } from '../../moments';
import { startAutopilot, stopAutopilot } from '../../autopilot';
import { youtubeConfigured } from '../../services/youtube';

export const shortsAutopilotTool = defineTool({
  name: 'shorts_autopilot',
  category: 'publish',
  description:
    'Turn every moment found by find_shorts into a Short, render each one and, with YouTube connected, upload them scheduled: best first, one every `everyHours` (default 24) from `firstAt`. Runs in the background (the Shorts tab shows progress); returns at once. Uploading ALWAYS asks the user first. Use mode "stop" to stop a run, "retry" to run the failed ones again.',
  schema: z.object({
    mode: z.enum(['start', 'stop', 'retry']).default('start'),
    momentIds: z.array(z.string()).optional().describe('Only these moments (default: all found)'),
    upload: z.boolean().optional().describe('Upload scheduled to YouTube (default: when YouTube is connected); false only renders'),
    firstAt: z.string().optional().describe('ISO date-time the first Short goes public (default: this time tomorrow)'),
    everyHours: z.number().min(1).max(336).optional().describe('Hours between Shorts (default 24)'),
  }),
  execute: async (input, ctx) => {
    if (input.mode === 'stop') return { text: stopAutopilot(ctx.projectId) ? 'Stopping the Shorts autopilot after the current step.' : 'The Shorts autopilot is not running.' };
    const upload = input.upload ?? youtubeConfigured().connected;
    if (upload) {
      const n = input.momentIds?.length ?? (await readMoments(ctx.projectId))?.moments.length ?? 0;
      const yt = youtubeConfigured();
      const ok = await ctx.approve(`Render ${n} Shorts and upload them to YouTube${yt.channelTitle ? ` (${yt.channelTitle})` : ''}, scheduled one every ${input.everyHours ?? 24} hours${input.firstAt ? ` from ${input.firstAt}` : ' from tomorrow'}`, undefined, { always: true });
      if (!ok) return { text: 'The user declined the scheduled uploads.', isError: true };
    }
    const s = await startAutopilot(ctx.projectId, { retry: input.mode === 'retry', momentIds: input.momentIds, upload, firstAt: input.firstAt, everyHours: input.everyHours });
    const lines = s.items.map((i, n) => `${n + 1}. "${i.title}" ${i.publishAt ? `goes public ${i.publishAt}` : 'render only'} (${i.status})`);
    return { text: `The Shorts autopilot is running (${s.items.length} Shorts, ${s.options.upload ? 'uploading scheduled' : 'rendering only'}). The user can follow it in the Shorts tab.\n${lines.join('\n')}`, summary: `${s.items.length} Shorts queued` };
  },
});

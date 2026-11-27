import { z } from 'zod';
import { defineTool } from '../types';
import { getProject, timelineReadout } from './helpers';
import { removeBackground, restoreOriginal } from '../../background';

export const removeBackgroundTool = defineTool({
  name: 'remove_background',
  category: 'edit',
  description:
    'Remove the background of a video clip so what is behind it shows through: mode "person" finds the person with a local segmentation model (no green screen needed: talking heads, presenters), "screen" keys out a green or blue screen (color found automatically, or pass one). The clip switches to a new video with transparency (one undo step); put an image, video or b-roll on a track below it, or pass behind "blur" for a blurred copy of the original underneath (portrait mode). Mode "restore" shows the original again. Runs locally; takes a while for long clips.',
  schema: z.object({
    clipId: z.string(),
    mode: z.enum(['person', 'screen', 'restore']).default('person'),
    color: z.string().optional().describe('Screen color like "#00b140" (screen mode; default: found automatically)'),
    similarity: z.number().min(0.05).max(0.6).optional().describe('Screen mode: how far from the color still counts as screen (default 0.3)'),
    behind: z.enum(['none', 'blur']).optional().describe('Put a blurred copy of the original underneath'),
  }),
  execute: async (input, ctx) => {
    const r =
      input.mode === 'restore'
        ? await restoreOriginal(ctx.projectId, input.clipId, ctx.source)
        : await removeBackground(ctx.projectId, input.clipId, { mode: input.mode, color: input.color, similarity: input.similarity, behind: input.behind, signal: ctx.signal }, ctx.source);
    return { text: `${input.clipId}: ${r.summary}.\n\n${timelineReadout(await getProject(ctx))}`, summary: r.summary };
  },
});

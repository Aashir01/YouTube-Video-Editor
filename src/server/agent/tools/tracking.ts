import { z } from 'zod';
import { applyOps, updateClip } from '../../../shared/ops';
import { defineTool } from '../types';
import { getProject, mutate, timelineReadout } from './helpers';
import { blurFacesOps, followTarget } from '../../motion';

export const blurFaces = defineTool({
  name: 'blur_faces',
  category: 'edit',
  description:
    'Privacy: blur every face in a video clip. Adds a soft blur box per person (on a "Blur" track) that follows their face through the clip. Runs locally. For other things to hide (licence plates, screens, logos) add a blur clip over it and use track_motion with target "under".',
  schema: z.object({
    clipId: z.string().describe('The video clip'),
    strength: z.number().min(4).max(120).optional().describe('Blur radius in design px (default 36)'),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const { ops, summary } = await blurFacesOps(p, input.clipId, { strength: input.strength, signal: ctx.signal });
    const after = ops.length ? await mutate(ctx, 'Blur faces', (d) => void applyOps(d, ops)) : p;
    return { text: `${summary}.\n\n${timelineReadout(after)}`, summary };
  },
});

export const trackMotion = defineTool({
  name: 'track_motion',
  category: 'edit',
  description:
    'Motion tracking: make a graphic (text, picture-in-picture or blur clip) follow something in the video below it, keeping its current place relative to it. target "face" follows the nearest face (name labels, stickers, face blurs); "under" follows whatever is under the graphic at its start (an object, a licence plate, a screen). Writes position keyframes. Runs locally.',
  schema: z.object({
    clipId: z.string().describe('The text, picture-in-picture or blur clip that should follow'),
    target: z.enum(['face', 'under']).default('face'),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const { patch, summary } = await followTarget(p, input.clipId, input.target, ctx.signal);
    const after = await mutate(ctx, 'Track motion', (d) => void updateClip(d, input.clipId, patch));
    return { text: `${input.clipId}: ${summary}.\n\n${timelineReadout(after)}`, summary };
  },
});

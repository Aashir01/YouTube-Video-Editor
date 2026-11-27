import { z } from 'zod';
import { defineTool } from '../types';
import { getProject, mutate, timelineReadout } from './helpers';
import { applyMulticam, planMulticam } from '../../multicam';

export const createMulticam = defineTool({
  name: 'create_multicam',
  category: 'edit',
  description:
    'Multicam edit for podcasts and interviews filmed with several cameras: lines up the cameras (and separate microphones) by their sound, then cuts between the cameras like a live director: the close-up of whoever is talking (told by one microphone per person, or by mouth movement in each close-up), the wide shot when people talk over each other, an occasional cutaway in long monologues. Places the camera cuts on the main video track (their own sound off) and each microphone on its own audio track, at the end of the timeline unless `at` is given. Afterwards any cut can be switched to another camera with the switchAngle op of apply_edits. Runs locally; long recordings take a while.',
  schema: z.object({
    cameras: z.array(z.string()).min(1).max(9).describe('Video asset ids, one per camera (the first is the reference)'),
    microphones: z.array(z.string()).max(8).optional().describe('Separate audio recordings (lav or desk mics), ideally one per person'),
    follow: z.enum(['speaker', 'first']).optional().describe('speaker (default): cut to whoever is talking; first: stay on the first camera'),
    wide: z.string().optional().describe('The camera that shows everyone (found automatically when left out)'),
    at: z.number().min(0).optional().describe('Timeline time to place the edit (default: end of the timeline)'),
  }),
  execute: async (input, ctx) => {
    const plan = await planMulticam(await getProject(ctx), input, ctx.signal);
    const after = await mutate(ctx, 'Multicam edit', (d) => void applyMulticam(d, plan));
    const notes = plan.warnings.length ? `\nNotes: ${plan.warnings.join('; ')}.` : '';
    return { text: `${plan.summary}${notes}\n\n${timelineReadout(after)}`, summary: `multicam · ${plan.cuts.length} shots` };
  },
});

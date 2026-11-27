import { z } from 'zod';
import { defineTool } from '../types';
import { getProject, timelineReadout } from './helpers';
import { applyLut, cutToBeat, stabilize } from '../../footage';

export const stabilizeTool = defineTool({
  name: 'stabilize_video',
  category: 'edit',
  description:
    'Stabilize shaky footage (handheld, walking shots): smooths the camera path and zooms in just enough to hide the edges. The clip switches to the steadied copy in one undo step (remove_background with mode "restore" shows the original again). Runs locally.',
  schema: z.object({
    clipId: z.string(),
    strength: z.enum(['light', 'medium', 'strong']).optional().describe('How much to smooth (default medium; strong for walking shots)'),
  }),
  execute: async (input, ctx) => {
    const r = await stabilize(ctx.projectId, input.clipId, input.strength, ctx.source, ctx.signal);
    return { text: `${input.clipId}: stabilized ${r.seconds.toFixed(1)}s (${r.note}).\n\n${timelineReadout(await getProject(ctx))}`, summary: r.note ?? 'done' };
  },
});

export const applyLutTool = defineTool({
  name: 'apply_lut',
  category: 'edit',
  description:
    'Apply a color look from a .cube LUT file the user imported (camera log-to-Rec.709 conversions or creative looks) to a video clip, optionally at partial strength. For simple looks the clip grade (brightness, contrast, saturation, presets) is quicker. The clip switches to the graded copy in one undo step (remove_background with mode "restore" shows the original again).',
  schema: z.object({
    clipId: z.string(),
    lutAssetId: z.string().describe('The .cube asset (see inspect_assets)'),
    intensity: z.number().min(0).max(1).optional().describe('Strength of the look, 0–1 (default 1)'),
  }),
  execute: async (input, ctx) => {
    const r = await applyLut(ctx.projectId, input.clipId, input.lutAssetId, input.intensity ?? 1, ctx.source, ctx.signal);
    return { text: `${input.clipId}: color look ${r.note} applied to ${r.seconds.toFixed(1)}s.\n\n${timelineReadout(await getProject(ctx))}`, summary: r.note ?? 'done' };
  },
});

export const cutToBeatTool = defineTool({
  name: 'cut_to_beat',
  category: 'edit',
  description:
    'Cut b-roll or pictures to the music: re-times the given clips (one track) so each starts on a beat and lasts whole beats (about as long as before, or exactly `every` beats), back to back from the beat nearest the first one. Finds the beats of the music clip under them (role "music") the first time. One undo step.',
  schema: z.object({
    clipIds: z.array(z.string()).min(1).max(200),
    every: z.number().int().min(1).max(32).optional().describe('Beats per clip (default: keep each clip about as long as it is)'),
    musicClipId: z.string().optional().describe('The music to follow (default: the music clip under these clips)'),
  }),
  execute: async (input, ctx) => {
    const r = await cutToBeat(ctx.projectId, input.clipIds, { every: input.every, musicClipId: input.musicClipId }, ctx.source, ctx.signal);
    return { text: `${r.summary}.\n\n${timelineReadout(await getProject(ctx))}`, summary: `${r.clips} clips on the beat` };
  },
});

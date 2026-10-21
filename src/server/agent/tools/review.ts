import { z } from 'zod';
import { findClip, formatTime, projectDuration } from '../../../shared/timeline';
import { renderFrames } from '../../render/render';
import { defineTool } from '../types';
import { getProject } from './helpers';

export const previewFrames = defineTool({
  name: 'preview_frames',
  category: 'review',
  readOnly: true,
  description:
    'Render real frames of the edit (exactly as the final video) and look at them. Use for visual QA: text overflow/cut-off, readability over footage, collisions between captions and graphics, wrong crops/zooms, black frames, empty scenes, code-scene errors. Pass times, clipIds (samples each clip after its entrance animation), or count (evenly spaced).',
  schema: z.object({
    times: z.array(z.number().min(0)).max(10).optional(),
    clipIds: z.array(z.string()).max(10).optional(),
    count: z.number().int().min(1).max(10).default(6),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const dur = projectDuration(p);
    if (dur <= 0) return { text: 'The timeline is empty.', isError: true };
    let times = input.times ?? [];
    for (const id of input.clipIds ?? []) {
      const ref = findClip(p, id);
      if (ref) times.push(Math.min(ref.clip.start + ref.clip.duration - 0.05, ref.clip.start + Math.min(1.4, ref.clip.duration * 0.55)));
    }
    if (!times.length) times = Array.from({ length: input.count }, (_, i) => Math.round(((dur * (i + 0.5)) / input.count) * 100) / 100);
    times = [...new Set(times.map((t) => Math.round(Math.min(Math.max(0, t), dur - 0.04) * 100) / 100))].slice(0, 10);
    ctx.progress(`Rendering ${times.length} frame(s)…`);
    const { frames, errors } = await renderFrames(ctx.projectId, times, { project: p });
    return {
      text: `${frames.length} frame(s) at ${frames.map((f) => formatTime(f.time)).join(', ')} (in order).${errors.length ? `\nErrors:\n- ${errors.join('\n- ')}` : ''}`,
      images: frames.map((f) => ({ mime: 'image/jpeg', data: f.jpeg.toString('base64') })),
      imageUrls: frames.map((f) => `/renders/${ctx.projectId}/${f.file.split('\\').join('/')}`),
      isError: errors.length > 0 && frames.length === 0,
      summary: `${frames.length} frames${errors.length ? `, ${errors.length} error(s)` : ''}`,
    };
  },
});

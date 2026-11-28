import { z } from 'zod';
import { findClip, formatTime, projectDuration } from '../../../shared/timeline';
import { renderFrames } from '../../render/render';
import { defineTool } from '../types';
import { getProject, mutate, timelineReadout } from './helpers';
import { analyzeRetention, retentionText, type RetentionFix } from '../../../shared/retention';
import { applyOps } from '../../../shared/ops';
import { store } from '../../storage/projects';

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

const FIX_GROUPS = ['hook', 'pauses', 'fillers', 'long-shots', 'ending'] as const;

export const reviewRetention = defineTool({
  name: 'review_retention',
  category: 'review',
  description:
    'Retention check of the edit as it is now (instant, from the transcript and the timeline): a hook score for the first seconds (talks from the first second, opens on a hook line, brisk pace, something changes, words on screen, captions on Shorts) and the dead spots where viewers leave (long pauses, the same shot held too long, filler words, slow stretches, silence at the end, no call to action). The same report is in the editor’s Coach tab. Pass `apply` to fix groups in one undo step each: "hook" (cut a slow start, punch in, add the hook as a title), "pauses", "fillers", "long-shots" (punch-in zooms) and "ending" (trim silence). Hook lines and slow stretches need your judgment: rework those with your editing tools.',
  schema: z.object({ apply: z.array(z.enum(FIX_GROUPS)).optional() }),
  execute: async (input, ctx) => {
    const analyze = async () => {
      const p = await getProject(ctx);
      return { p, r: analyzeRetention(p, await store.transcriptsFor(p)) };
    };
    const done: string[] = [];
    for (const group of input.apply ?? []) {
      // each group is worked out on the edit as the previous one left it
      const { r } = await analyze();
      const fixes =
        group === 'hook'
          ? r.hook.checks.filter((c) => !c.ok && c.fix?.kind === 'ops').map((c) => c.fix!)
          : group === 'pauses'
            ? [r.bulk.find((b) => /pauses/.test(b.label)) ?? r.issues.find((i) => i.kind === 'pause')?.fix]
            : group === 'fillers'
              ? [r.issues.find((i) => i.kind === 'filler')?.fix]
              : group === 'long-shots'
                ? [r.bulk.find((b) => /long shots/.test(b.label)) ?? r.issues.find((i) => i.kind === 'static')?.fix]
                : [r.issues.find((i) => i.id === 'ending')?.fix];
      for (const fix of fixes.filter((f): f is Extract<RetentionFix, { kind: 'ops' }> => f?.kind === 'ops')) {
        if (group === 'hook') {
          // hook fixes change times: take each one from a fresh look
          const fresh = (await analyze()).r.hook.checks.find((c) => c.fix?.label === fix.label)?.fix;
          if (fresh?.kind !== 'ops') continue;
          await mutate(ctx, `Retention: ${fresh.label}`, (d) => void applyOps(d, fresh.ops));
        } else await mutate(ctx, `Retention: ${fix.label}`, (d) => void applyOps(d, fix.ops));
        done.push(fix.label);
      }
    }
    const { p, r } = await analyze();
    return {
      text: `${done.length ? `Applied: ${done.join('; ')}.\n\n` : ''}${retentionText(r)}${done.length ? `\n\n${timelineReadout(p)}` : ''}`,
      summary: `${r.score}/100, hook ${r.hook.score}/10${done.length ? ` · ${done.length} fixed` : ''}`,
    };
  },
});

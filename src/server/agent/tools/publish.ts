import fsp from 'node:fs/promises';
import { z } from 'zod';
import { applyOp } from '../../../shared/ops';
import { formatTime } from '../../../shared/timeline';
import { bus } from '../../events';
import { RENDER_PRESETS, cancelRender, getServerOrigin, renderThumbnail, startRender, waitForRender, type RenderPreset } from '../../render/render';
import { defineTool } from '../types';
import { getProject, mutate } from './helpers';

const THUMB_TEMPLATES = ['bold-text', 'split', 'face-reaction', 'minimal', 'news', 'number'] as const;

export const setYouTubeMetadata = defineTool({
  name: 'set_youtube_metadata',
  category: 'publish',
  description: 'Set the YouTube publishing metadata: title (≤ 60 chars), titleOptions, description (hook, summary, chapters "00:00 Intro" lines, sources/credits, hashtags), tags, hashtags, chapters (time in seconds), category id, privacy. Load the thumbnails-seo skill first.',
  schema: z.object({
    title: z.string().max(100).optional(),
    titleOptions: z.array(z.string()).optional(),
    description: z.string().max(5000).optional(),
    tags: z.array(z.string()).optional(),
    hashtags: z.array(z.string()).optional(),
    chapters: z.array(z.object({ time: z.number().min(0), title: z.string() })).optional(),
    category: z.string().optional(),
    privacy: z.enum(['private', 'unlisted', 'public']).optional(),
    madeForKids: z.boolean().optional(),
  }),
  execute: async (input, ctx) => {
    const patch = { ...input } as Record<string, unknown>;
    if (input.chapters) {
      const sorted = [...input.chapters].sort((a, b) => a.time - b.time);
      if (sorted.length && sorted[0]!.time !== 0) sorted.unshift({ time: 0, title: 'Intro' });
      patch.chapters = sorted;
    }
    const p = await mutate(ctx, 'YouTube metadata', (d) => void applyOp(d, { op: 'setYoutube', patch }));
    const warn: string[] = [];
    if (p.youtube.title.length > 60) warn.push(`title is ${p.youtube.title.length} chars (truncated in search after ~60)`);
    if (p.youtube.chapters.length && p.youtube.chapters.length < 3) warn.push('YouTube needs at least 3 chapters to show them');
    const gaps = p.youtube.chapters.slice(1).filter((c, i) => c.time - p.youtube.chapters[i]!.time < 10);
    if (gaps.length) warn.push('chapters must be at least 10s apart');
    return { text: `Saved. Title: "${p.youtube.title}". ${p.youtube.chapters.length} chapters, ${p.youtube.tags.length} tags.${warn.length ? ` Warnings: ${warn.join('; ')}` : ''}`, summary: p.youtube.title || 'metadata saved' };
  },
});

export const designThumbnail = defineTool({
  name: 'design_thumbnail',
  category: 'publish',
  description: `Design and render the YouTube thumbnail (1280x720, or 1080x1920 for Shorts) and look at the result. Templates: ${THUMB_TEMPLATES.join(', ')}. props: text (2-5 words, *word* = accent), subtext?, imageAssetId? (subject/face), image2AssetId? (split), videoAssetId + time? (use a video frame), emoji?, badge?, number? (number template), highlight? (color), background? (gradient|dark|light|brand|image), arrow? (bool). Or pass custom TSX in code (same API as code scenes).`,
  schema: z.object({
    template: z.enum(THUMB_TEMPLATES).default('bold-text'),
    props: z.record(z.string(), z.unknown()).default({}),
    code: z.string().optional(),
  }),
  execute: async (input, ctx) => {
    await mutate(ctx, 'Design thumbnail', (d) => {
      d.youtube.thumbnail = { ...d.youtube.thumbnail, template: input.template, props: input.props, code: input.code };
    });
    ctx.progress('Rendering thumbnail…');
    const file = await renderThumbnail(ctx.projectId);
    const p = await getProject(ctx);
    const data = await fsp.readFile(file);
    return {
      text: `Thumbnail rendered (${p.canvas.height > p.canvas.width ? '1080x1920' : '1280x720'}). Look at it critically at small size: is the text readable, is there one clear focal point?`,
      images: [{ mime: 'image/png', data: data.toString('base64') }],
      imageUrls: [`/media/${ctx.projectId}/${p.youtube.thumbnail.file}`],
      summary: 'thumbnail',
    };
  },
});

export const renderVideo = defineTool({
  name: 'render_video',
  category: 'publish',
  description: `Render the final MP4 (H.264/AAC, loudness-normalized to YouTube's -14 LUFS, with an .srt captions file) and wait for it. Presets: ${Object.entries(RENDER_PRESETS)
    .map(([k, v]) => `${k} — ${v.label}`)
    .join('; ')}. Use "draft" for quick checks of a section via range [start, end].`,
  schema: z.object({
    preset: z.enum(Object.keys(RENDER_PRESETS) as [RenderPreset, ...RenderPreset[]]).default('standard'),
    range: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  }),
  execute: async (input, ctx) => {
    const record = await startRender(ctx.projectId, { preset: input.preset, range: input.range });
    const unsubscribe = bus.subscribe(ctx.projectId, (e) => {
      if (e.type === 'render' && e.render.id === record.id) ctx.progress(`${e.render.status} ${Math.round(e.render.progress * 100)}%`);
    });
    const onAbort = () => cancelRender(record.id);
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const done = await waitForRender(ctx.projectId, record.id);
      if (done.status !== 'done') return { text: `Render ${done.status}${done.error ? `: ${done.error}` : ''}`, isError: true };
      const url = `${getServerOrigin()}/renders/${ctx.projectId}/${done.file}`;
      return {
        text: `Rendered ${done.width}x${done.height}, ${formatTime(done.durationSec ?? 0)}, ${((done.sizeBytes ?? 0) / 1e6).toFixed(1)} MB in ${done.elapsedSec}s.\nDownload: ${url}?download\nThe user can also find it in the Export panel.`,
        summary: `${((done.sizeBytes ?? 0) / 1e6).toFixed(1)} MB`,
      };
    } finally {
      unsubscribe();
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
});

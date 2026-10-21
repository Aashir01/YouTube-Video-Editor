import { z } from 'zod';
import { FONT_IDS, FONTS } from '../../../shared/fonts';
import { ASPECTS, clipEnd, formatTime, lintProject, projectDuration, summarizeProject } from '../../../shared/timeline';
import { TEMPLATE_IDS } from '../../../shared/templates';
import { applyOp } from '../../../shared/ops';
import { store } from '../../storage/projects';
import { defineTool, j } from '../types';
import { getProject, mutate, timelineReadout } from './helpers';

export const getProjectTool = defineTool({
  name: 'get_project',
  category: 'project',
  readOnly: true,
  description: 'Get the current project state: brief, brand, canvas, assets (with analysis status), script summary, timeline summary and warnings.',
  schema: z.object({}),
  execute: async (_i, ctx) => {
    const p = await getProject(ctx);
    const warnings = lintProject(p, TEMPLATE_IDS);
    return { text: `${summarizeProject(p)}\n${warnings.length ? `Warnings:\n- ${warnings.join('\n- ')}` : 'Warnings: none'}`, summary: p.name };
  },
});

export const getTimeline = defineTool({
  name: 'get_timeline',
  category: 'project',
  readOnly: true,
  description: 'Get full clip details (every property) for editing: optionally limited to a time range and/or track ids. Use before updating clips so you edit with correct ids/values.',
  schema: z.object({
    from: z.number().optional(),
    to: z.number().optional(),
    trackIds: z.array(z.string()).optional(),
    types: z.array(z.enum(['video', 'image', 'audio', 'text', 'scene', 'code', 'captions'])).optional(),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const out = p.tracks
      .filter((t) => !input.trackIds || input.trackIds.includes(t.id) || input.trackIds.includes(t.name))
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        muted: t.muted || undefined,
        hidden: t.hidden || undefined,
        locked: t.locked || undefined,
        clips: t.clips
          .filter((c) => (input.from === undefined || clipEnd(c) > input.from) && (input.to === undefined || c.start < input.to))
          .filter((c) => !input.types || input.types.includes(c.type))
          .map((c) => (c.type === 'captions' ? { ...c, words: c.mode === 'manual' ? `${c.words.length} words` : undefined } : c.type === 'code' ? { ...c, code: `${c.code.length} chars (see write_code_scene)` } : c)),
      }));
    return { text: `Timeline (${formatTime(projectDuration(p))}):\n${j(out)}`, summary: `${out.reduce((n, t) => n + t.clips.length, 0)} clips` };
  },
});

export const setBrief = defineTool({
  name: 'set_brief',
  category: 'project',
  description:
    'Save the video brief (what the video is). Call it as soon as you learn the topic, audience, goal, tone, style, format, target length, CTA or key points. Setting format "short" switches an empty project to 9:16 (1080x1920); "long" to 16:9.',
  schema: z.object({
    topic: z.string().optional(),
    mode: z.enum(['edit', 'generate', 'hybrid']).optional(),
    format: z.enum(['long', 'short']).optional(),
    goal: z.string().optional(),
    audience: z.string().optional(),
    tone: z.string().optional(),
    style: z.string().optional(),
    targetDurationSec: z.number().min(5).max(7200).optional(),
    language: z.string().optional(),
    callToAction: z.string().optional(),
    keyPoints: z.array(z.string()).optional(),
    notes: z.string().optional(),
    status: z.enum(['new', 'gathering', 'ready']).optional(),
    name: z.string().optional().describe('Project name (defaults to the topic)'),
  }),
  execute: async (input, ctx) => {
    const { name, ...brief } = input;
    const p = await mutate(ctx, 'Update brief', (d) => {
      applyOp(d, { op: 'setBrief', patch: brief });
      if (name || (brief.topic && /^untitled/i.test(d.name))) d.name = (name ?? brief.topic!).slice(0, 100);
      if (brief.format) {
        const size = brief.format === 'short' ? ASPECTS['9:16'] : ASPECTS['16:9'];
        const empty = d.tracks.every((t) => t.clips.length === 0);
        if (empty) {
          d.canvas.width = size.width;
          d.canvas.height = size.height;
        }
      }
    });
    return { text: `Brief saved. Canvas ${p.canvas.width}x${p.canvas.height}. Project: "${p.name}".`, summary: 'Brief saved' };
  },
});

export const setBrand = defineTool({
  name: 'set_brand',
  category: 'project',
  description: `Set the visual identity used by all templates, captions and thumbnails: colors (hex), fonts and channel info. Fonts: ${FONTS.map((f) => `${f.id} (${f.description.split('.')[0]})`).join('; ')}. Choose palettes with strong contrast: dark background + bright primary/accent, or vice versa.`,
  schema: z.object({
    primary: z.string().optional(),
    secondary: z.string().optional(),
    accent: z.string().optional(),
    background: z.string().optional(),
    surface: z.string().optional(),
    text: z.string().optional(),
    mutedText: z.string().optional(),
    headingFont: z.enum(FONT_IDS).optional(),
    bodyFont: z.enum(FONT_IDS).optional(),
    monoFont: z.enum(FONT_IDS).optional(),
    logoAssetId: z.string().optional(),
    channelName: z.string().optional(),
    handle: z.string().optional(),
    watermark: z.boolean().optional(),
  }),
  execute: async (input, ctx) => {
    const p = await mutate(ctx, 'Update brand', (d) => void applyOp(d, { op: 'setBrand', patch: input }));
    return { text: `Brand updated: ${j(p.brand)}`, summary: 'Brand updated' };
  },
});

export const setCanvas = defineTool({
  name: 'set_canvas',
  category: 'project',
  description: 'Change the video format: aspect 16:9 (YouTube), 9:16 (Shorts), 1:1 or 4:5, or explicit width/height; fps (24/25/30/60). Layout positions are relative, so existing clips adapt.',
  schema: z.object({
    aspect: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    fps: z.number().int().min(12).max(60).optional(),
    background: z.string().optional(),
  }),
  execute: async (input, ctx) => {
    const patch: Record<string, unknown> = {};
    if (input.aspect) Object.assign(patch, ASPECTS[input.aspect]);
    if (input.width) patch.width = input.width;
    if (input.height) patch.height = input.height;
    if (input.fps) patch.fps = input.fps;
    if (input.background) patch.background = input.background;
    const p = await mutate(ctx, 'Change canvas', (d) => void applyOp(d, { op: 'setCanvas', patch }));
    return { text: `Canvas is now ${p.canvas.width}x${p.canvas.height} @ ${p.canvas.fps}fps.`, summary: `${p.canvas.width}x${p.canvas.height}` };
  },
});

export const checkTimeline = defineTool({
  name: 'check_timeline',
  category: 'review',
  readOnly: true,
  description: 'Lint the edit: gaps, overlaps, missing media, clips past their source, music not ducked, length vs target, caption coverage, pacing stats. Run before rendering.',
  schema: z.object({}),
  execute: async (_i, ctx) => {
    const p = await getProject(ctx);
    const transcripts = await store.transcriptsFor(p);
    const dur = projectDuration(p);
    const main = p.tracks.find((t) => t.name === 'Main') ?? p.tracks.find((t) => t.kind === 'video');
    const visualChanges = p.tracks.filter((t) => t.kind === 'video' || t.kind === 'overlay').flatMap((t) => t.clips.map((c) => c.start)).sort((a, b) => a - b);
    let longestStatic = 0;
    for (let i = 1; i < visualChanges.length; i++) longestStatic = Math.max(longestStatic, visualChanges[i]! - visualChanges[i - 1]!);
    const hasCaptions = p.tracks.some((t) => t.clips.some((c) => c.type === 'captions'));
    const speechAssets = p.tracks.flatMap((t) => t.clips).filter((c) => (c.type === 'video' || (c.type === 'audio' && (c.role === 'voiceover' || c.role === 'original'))) && 'assetId' in c);
    const missingTranscripts = [...new Set(speechAssets.map((c) => ('assetId' in c ? c.assetId : '')))].filter((id) => {
      const a = p.assets.find((x) => x.id === id);
      return a && (a.meta.hasAudio || a.kind === 'audio') && !transcripts[id];
    });
    const lines = [
      `Length ${formatTime(dur)}${p.brief.targetDurationSec ? ` vs target ${formatTime(p.brief.targetDurationSec, false)} (${Math.round((dur / p.brief.targetDurationSec) * 100)}%)` : ''}`,
      `Main track clips: ${main?.clips.length ?? 0}; visual changes: ${visualChanges.length} (avg every ${visualChanges.length ? (dur / visualChanges.length).toFixed(1) : '-'}s, longest hold ${longestStatic.toFixed(1)}s)`,
      `Captions: ${hasCaptions ? 'yes' : 'NO'}${missingTranscripts.length ? `; assets without transcript (no captions for them): ${missingTranscripts.join(', ')}` : ''}`,
      `Music: ${p.tracks.some((t) => t.clips.some((c) => c.type === 'audio' && c.role === 'music')) ? 'yes' : 'none'}; SFX: ${p.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'audio' && c.role === 'sfx').length}`,
      `YouTube: title ${p.youtube.title ? 'set' : 'missing'}, description ${p.youtube.description ? 'set' : 'missing'}, chapters ${p.youtube.chapters.length}, thumbnail ${p.youtube.thumbnail.file ? 'rendered' : 'not rendered'}`,
      timelineReadout(p),
    ];
    return { text: lines.join('\n'), summary: `${lintProject(p, TEMPLATE_IDS).length} warning(s)` };
  },
});

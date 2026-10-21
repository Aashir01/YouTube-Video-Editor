import { z } from 'zod';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../../../shared/templates';
import { checkSceneCode } from '../../../shared/code-check';
import { applyOps } from '../../../shared/ops';
import { findClip, requireTrack } from '../../../shared/timeline';
import { renderFrames } from '../../render/render';
import { defineTool } from '../types';
import { mutate, timelineReadout } from './helpers';

export const listTemplates = defineTool({
  name: 'list_templates',
  category: 'motion',
  readOnly: true,
  description: 'List motion-graphics templates with descriptions, default durations and their props (JSON schema) plus an example. Filter by category or ids to keep it short.',
  schema: z.object({ category: z.enum(TEMPLATE_CATEGORIES).optional(), ids: z.array(z.string()).optional(), detail: z.boolean().default(true) }),
  execute: async (input) => {
    const list = TEMPLATES.filter((t) => (!input.category || t.category === input.category) && (!input.ids || input.ids.includes(t.id)));
    if (!input.detail) return { text: list.map((t) => `- ${t.id} [${t.category}${t.overlay ? ', overlay' : ''}, ${t.defaultDuration}s]: ${t.description}`).join('\n'), summary: `${list.length} templates` };
    const out = list.map((t) => {
      const schema = z.toJSONSchema(t.schema, { io: 'input', unrepresentable: 'any' }) as { properties?: Record<string, { type?: string; enum?: unknown[]; description?: string; default?: unknown }>; required?: string[] };
      const props = Object.entries(schema.properties ?? {}).map(([k, v]) => `${k}${schema.required?.includes(k) ? '' : '?'}: ${v.enum ? v.enum.join('|') : v.type ?? 'any'}${v.default !== undefined ? ` = ${JSON.stringify(v.default)}` : ''}${v.description ? ` — ${v.description}` : ''}`);
      return `## ${t.id} (${t.name}) [${t.category}${t.overlay ? ', transparent overlay' : ''}, default ${t.defaultDuration}s]\n${t.description}\nprops:\n  ${props.join('\n  ')}\nexample: ${JSON.stringify(t.example)}`;
    });
    return { text: out.join('\n\n'), summary: `${list.length} templates` };
  },
});

export const writeCodeScene = defineTool({
  name: 'write_code_scene',
  category: 'motion',
  description:
    'Create or update a custom animated scene written in TSX (React + Remotion) when no template fits. Load the code-scenes skill first for the API. The code is checked, placed on the timeline (or replaces an existing code clip when clipId is given) and rendered: you get preview frames back plus any runtime errors — review them and fix problems.',
  schema: z.object({
    code: z.string().min(40),
    description: z.string().describe('What the scene shows (for the timeline and the user)'),
    clipId: z.string().optional().describe('Update this existing code clip instead of adding a new one'),
    start: z.number().min(0).optional(),
    duration: z.number().positive().optional(),
    track: z.string().optional().describe('Default: Main (or Graphics when transparent)'),
    transparent: z.boolean().default(false).describe('true for overlays drawn on top of footage'),
    props: z.record(z.string(), z.unknown()).default({}),
    previewTimes: z.array(z.number().min(0).max(1)).max(4).default([0.35, 0.85]).describe('Where to sample preview frames, as fractions of the clip duration'),
  }),
  execute: async (input, ctx) => {
    const check = checkSceneCode(input.code);
    if (!check.ok) return { text: `The scene was NOT placed. Fix these problems:\n- ${check.errors.join('\n- ')}${check.warnings.length ? `\nWarnings:\n- ${check.warnings.join('\n- ')}` : ''}`, isError: true };
    let clipId = input.clipId;
    let start = 0;
    let duration = 0;
    const p = await mutate(ctx, input.clipId ? 'Update code scene' : 'Add code scene', (d) => {
      if (input.clipId) {
        const ref = findClip(d, input.clipId);
        if (!ref || ref.clip.type !== 'code') throw new Error(`Code clip ${input.clipId} not found`);
        const patch: Record<string, unknown> = { code: input.code, description: input.description, props: input.props, transparent: input.transparent };
        if (input.start !== undefined) patch.start = input.start;
        if (input.duration !== undefined) patch.duration = input.duration;
        applyOps(d, [{ op: 'updateClip', clipId: input.clipId, patch }]);
        const c = findClip(d, input.clipId)!.clip;
        start = c.start;
        duration = c.duration;
      } else {
        const trackId = requireTrack(d, input.track ?? (input.transparent ? 'Graphics' : 'Main')).id;
        const track = d.tracks.find((t) => t.id === trackId)!;
        start = input.start ?? track.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
        duration = input.duration ?? 5;
        const r = applyOps(d, [{ op: 'addClip', trackId, clip: { id: '', type: 'code', code: input.code, description: input.description, props: input.props, transparent: input.transparent, start, duration } }])[0] as { clipId: string };
        clipId = r.clipId;
      }
    });
    let previewText = 'Preview skipped (visual QA disabled in settings).';
    let images: { mime: string; data: string }[] | undefined;
    let imageUrls: string[] | undefined;
    let isError = false;
    if (ctx.settings.agent.visualQa) {
      ctx.progress('Rendering preview frames…');
      const times = input.previewTimes.map((f) => Math.round((start + duration * f) * 100) / 100);
      try {
        const { frames, errors } = await renderFrames(ctx.projectId, times, { project: p });
        images = frames.map((f) => ({ mime: 'image/jpeg', data: f.jpeg.toString('base64') }));
        imageUrls = frames.map((f) => `/renders/${ctx.projectId}/${f.file.split('\\').join('/')}`);
        previewText = errors.length ? `RUNTIME ERRORS (the scene shows an error card — fix and resubmit with clipId=${clipId}):\n- ${errors.join('\n- ')}` : `Preview frames at ${times.map((t) => `${t}s`).join(', ')} attached. Check layout, overflow, contrast, timing.`;
        isError = errors.length > 0;
      } catch (err) {
        previewText = `Could not render a preview: ${(err as Error).message}`;
      }
    }
    return {
      text: `Code scene ${clipId} at ${start}s for ${duration}s.${check.warnings.length ? ` Warnings: ${check.warnings.join(' ')}` : ''}\n${previewText}\n${timelineReadout(p)}`,
      images,
      imageUrls,
      isError,
      summary: `${clipId}${isError ? ' (errors)' : ''}`,
    };
  },
});


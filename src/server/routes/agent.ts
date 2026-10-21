import type { Hono } from 'hono';
import { z } from 'zod';
import { getSession, allTools, userToolContext } from '../agent/session';
import { BUILTIN_TOOLS } from '../agent/tools';
import { normalizeOutput } from '../agent/types';
import { rememberStockResults } from '../agent/tools/generate';
import { searchStock } from '../services/stock';
import { getSettings } from '../config';
import { bus } from '../events';
import { listSkills } from '../agent/skills';
import { store } from '../storage/projects';

export const installAgentRoutes = (app: Hono): void => {
  app.get('/api/projects/:id/chat', (c) => {
    if (!store.exists(c.req.param('id'))) return c.json({ error: 'Project not found' }, 404);
    return c.json(getSession(c.req.param('id')).snapshot());
  });

  app.post('/api/projects/:id/chat', async (c) => {
    const id = c.req.param('id');
    if (!store.exists(id)) return c.json({ error: 'Project not found' }, 404);
    const body = z.object({ text: z.string().min(1).max(20000), attachments: z.array(z.string()).default([]), context: z.string().max(4000).optional() }).parse(await c.req.json());
    await getSession(id).send(body.text, body.attachments, body.context);
    return c.json({ ok: true });
  });

  app.post('/api/projects/:id/chat/answer', async (c) => {
    const body = z
      .object({ messageId: z.string(), answers: z.array(z.object({ questionId: z.string(), value: z.union([z.string(), z.array(z.string())]), assetIds: z.array(z.string()).optional() })) })
      .parse(await c.req.json());
    getSession(c.req.param('id')).answer(body.messageId, body.answers);
    return c.json({ ok: true });
  });

  app.post('/api/projects/:id/chat/approve', async (c) => {
    const body = z.object({ messageId: z.string(), approved: z.boolean() }).parse(await c.req.json());
    getSession(c.req.param('id')).decide(body.messageId, body.approved);
    return c.json({ ok: true });
  });

  app.post('/api/projects/:id/chat/stop', (c) => {
    getSession(c.req.param('id')).stop();
    return c.json({ ok: true });
  });

  app.delete('/api/projects/:id/chat', async (c) => {
    await getSession(c.req.param('id')).reset();
    return c.json({ ok: true });
  });

  /**
   * Run a built-in tool from an editor button. Same code path as the agent and MCP,
   * so manual and AI edits behave identically. The click itself is the approval.
   */
  const EDITOR_TOOLS: Record<string, string> = {
    generate_voiceover: 'Generating voiceover',
    import_stock: 'Importing stock media',
    generate_image: 'Generating AI image',
    add_captions: 'Adding captions',
    auto_cut: 'Cutting silences & fillers',
    transcribe: 'Transcribing',
    design_thumbnail: 'Rendering thumbnail',
    add_library_sound: 'Adding sound',
    analyze_media: 'Analyzing media',
  };
  app.post('/api/projects/:id/tools/:name', async (c) => {
    const id = c.req.param('id');
    const name = c.req.param('name');
    if (!store.exists(id)) return c.json({ error: 'Project not found' }, 404);
    const tool = BUILTIN_TOOLS.find((t) => t.name === name);
    if (!tool || !EDITOR_TOOLS[name]) return c.json({ error: `Tool "${name}" can't be run from the editor` }, 404);
    const parsed = tool.schema!.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') }, 400);
    const jobId = `tool-${name}-${Date.now()}`;
    const label = EDITOR_TOOLS[name]!;
    const job = (status: 'running' | 'done' | 'error', detail?: string) => bus.emit(id, { type: 'job', id: jobId, label, status, detail });
    job('running');
    try {
      const out = normalizeOutput(await tool.execute(parsed.data, userToolContext(id, AbortSignal.timeout(30 * 60_000), (t) => job('running', t))));
      job(out.isError ? 'error' : 'done', out.summary ?? out.text.slice(0, 160));
      if (out.isError) return c.json({ error: out.text }, 400);
      return c.json({ text: out.text, summary: out.summary, imageUrls: out.imageUrls ?? [] });
    } catch (err) {
      job('error', (err as Error).message);
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post('/api/projects/:id/stock/search', async (c) => {
    const id = c.req.param('id');
    const body = z.object({ query: z.string().min(2), type: z.enum(['video', 'image']).default('video'), orientation: z.enum(['landscape', 'portrait', 'square']).optional() }).parse(await c.req.json());
    const p = await store.get(id);
    const orientation = body.orientation ?? (p.canvas.height > p.canvas.width ? 'portrait' : 'landscape');
    const r = await searchStock({ query: body.query, type: body.type, orientation, count: 18 }, getSettings());
    rememberStockResults(id, r.results);
    return c.json(r);
  });

  app.get('/api/agent/tools', (c) => c.json(allTools().map((t) => ({ name: t.name, category: t.category, description: t.description }))));
  app.get('/api/agent/skills', (c) => c.json(listSkills().map(({ name, description, source }) => ({ name, description, source }))));
};

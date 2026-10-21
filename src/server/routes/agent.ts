import type { Hono } from 'hono';
import { z } from 'zod';
import { getSession, allTools } from '../agent/session';
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
    const body = z.object({ text: z.string().min(1).max(20000), attachments: z.array(z.string()).default([]) }).parse(await c.req.json());
    await getSession(id).send(body.text, body.attachments);
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

  app.get('/api/agent/tools', (c) => c.json(allTools().map((t) => ({ name: t.name, category: t.category, description: t.description }))));
  app.get('/api/agent/skills', (c) => c.json(listSkills().map(({ name, description, source }) => ({ name, description, source }))));
};

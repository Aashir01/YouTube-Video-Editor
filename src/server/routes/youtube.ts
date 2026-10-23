import fs from 'node:fs';
import type { Hono } from 'hono';
import { z } from 'zod';
import { store } from '../storage/projects';
import { authUrl, disconnect, handleCallback, uploadVideo, youtubeConfigured } from '../services/youtube';
import { bus } from '../events';

export const installYouTubeRoutes = (app: Hono): void => {
  app.get('/api/youtube/status', (c) => c.json(youtubeConfigured()));

  app.get('/api/youtube/connect', (c) => {
    const origin = new URL(c.req.url).origin.replace('localhost', '127.0.0.1');
    return c.redirect(authUrl(`${origin}/api/youtube/callback`));
  });

  app.get('/api/youtube/callback', async (c) => {
    const error = c.req.query('error');
    if (error) return c.html(`<h2>YouTube connection cancelled</h2><p>${error}</p><p>You can close this tab.</p>`);
    try {
      const channel = await handleCallback(c.req.query('code') ?? '', c.req.query('state') ?? '');
      return c.html(`<!doctype html><meta charset="utf-8"><title>Connected</title><body style="font-family:system-ui;background:#0b0d17;color:#fff;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>✅ YouTube connected${channel ? `: ${channel}` : ''}</h2><p>You can close this tab and return to Cutroom.</p><script>setTimeout(()=>window.close(),1500)</script></div></body>`);
    } catch (err) {
      return c.html(`<h2>YouTube connection failed</h2><pre>${(err as Error).message}</pre>`, 400);
    }
  });

  app.post('/api/youtube/disconnect', (c) => {
    disconnect();
    return c.json({ ok: true });
  });

  /** Manual upload from the Export panel (the user clicked the button, so no extra approval). */
  app.post('/api/projects/:id/youtube/upload', async (c) => {
    const id = c.req.param('id');
    const body = z.object({ renderId: z.string(), privacy: z.enum(['private', 'unlisted', 'public']).default('private'), publishAt: z.string().optional() }).parse(await c.req.json());
    const p = await store.get(id);
    const render = p.renders.find((r) => r.id === body.renderId);
    if (!render?.file) throw new Error('Render not found');
    const srt = store.renderPath(id, render.file.replace(/\.mp4$/, '.srt'));
    const thumb = p.youtube.thumbnail.file ? store.mediaPath(id, p.youtube.thumbnail.file) : undefined;
    const jobId = `yt-${Date.now()}`;
    void uploadVideo(p, {
      videoFile: store.renderPath(id, render.file),
      thumbnailFile: thumb && fs.existsSync(thumb) ? thumb : undefined,
      captionsFile: fs.existsSync(srt) ? srt : undefined,
      privacy: body.privacy,
      publishAt: body.publishAt,
      onProgress: (x) => bus.emit(id, { type: 'job', id: jobId, label: 'Uploading to YouTube', status: 'running', progress: x }),
    })
      .then(async (r) => {
        await store.update(id, 'Uploaded to YouTube', (d) => void (d.youtube.uploadedVideoId = r.videoId), { history: false, source: 'user' });
        bus.emit(id, { type: 'job', id: jobId, label: 'Uploading to YouTube', status: 'done', progress: 1, detail: r.url });
        bus.toast(id, 'success', `Uploaded to YouTube: ${r.url}${r.warnings.length ? ` (${r.warnings.join(' ')})` : ''}`);
      })
      .catch((err: Error) => {
        bus.emit(id, { type: 'job', id: jobId, label: 'Uploading to YouTube', status: 'error', detail: err.message });
        bus.toast(id, 'error', `YouTube upload failed: ${err.message}`);
      });
    return c.json({ ok: true, jobId });
  });
};

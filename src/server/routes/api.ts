import fsp from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { WordSchema } from '../../shared/schema';
import { applyOps, describeOps, type EditOp } from '../../shared/ops';
import { lintProject } from '../../shared/timeline';
import { createDemoProject } from '../../shared/sample';
import { TEMPLATE_IDS, templateCatalog } from '../../shared/templates';
import { FONTS } from '../../shared/fonts';
import { DATA_DIR, getSavedSettings, getSettings, maskedSettings, mergeSettingsUpdate, saveSettings, ProviderSchema, type Settings } from '../config';
import { bus } from '../events';
import { store } from '../storage/projects';
import { serveFile, receiveUploads } from '../http/files';
import { attachSubtitles, analyzeAsset, downloadToProject, queueTranscription, registerAsset } from '../media/ingest';
import { ffInfo } from '../media/ffmpeg';
import { libraryFile, listLibrary } from '../media/sfx';
import { cancelRender, renderFrames, renderThumbnail, startRender, RENDER_PRESETS, type RenderPreset } from '../render/render';
import { resolveBrowserExecutable } from '../render/browser';
import { localWhisperAvailable, pickTranscriptionEngine } from '../services/transcribe';
import { listModels, testModel } from '../ai/llm';
import { listVoices, pickTtsEngine } from '../services/tts';
import { mcpManager } from '../mcp/client';

export const api = new Hono();

const errorMessage = (err: unknown) => (err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : err instanceof Error ? err.message : String(err));

api.onError((err, c) => {
  const status = /not found/i.test(err.message) ? 404 : 400;
  if (status === 400) console.warn('[api]', c.req.method, c.req.path, '-', errorMessage(err));
  return c.json({ error: errorMessage(err) }, status);
});

// ---------------------------------------------------------------------------
// Health & system
// ---------------------------------------------------------------------------

api.get('/health', (c) => c.json({ ok: true, name: 'Director Studio', time: new Date().toISOString() }));

api.get('/system', async (c) => {
  const s = getSettings();
  const [stt, tts] = await Promise.all([pickTranscriptionEngine(s), pickTtsEngine(s)]);
  let kokoro = false;
  try {
    await import('kokoro-js');
    kokoro = true;
  } catch {
    /* optional */
  }
  return c.json({
    ffmpeg: ffInfo(),
    browser: resolveBrowserExecutable(s.render.browserExecutable) ?? 'remotion-managed',
    localWhisper: await localWhisperAvailable(),
    kokoro,
    transcription: stt ? stt.label : null,
    tts: tts ? tts.label : null,
    llm: s.llm.main ?? null,
    providers: s.llm.providers.map((p) => ({ id: p.id, name: p.name, type: p.type, hasKey: Boolean(p.apiKey) || (p.baseUrl ?? '').includes('localhost') })),
    dataDir: DATA_DIR,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

api.get('/settings', (c) => c.json({ saved: maskedSettings(getSavedSettings()), effective: maskedSettings(getSettings()) }));

api.put('/settings', async (c) => {
  const body = (await c.req.json()) as Partial<Settings>;
  const next = saveSettings(mergeSettingsUpdate(getSavedSettings(), body));
  if (body.mcpServers) void mcpManager.sync();
  return c.json({ saved: maskedSettings(next), effective: maskedSettings(getSettings()) });
});

const resolveProvider = (body: { providerId?: string; provider?: unknown }) => {
  const s = getSettings();
  if (body.provider) {
    const p = ProviderSchema.parse(body.provider);
    const saved = s.llm.providers.find((x) => x.id === p.id);
    if (p.apiKey.startsWith('••••') && saved) p.apiKey = saved.apiKey;
    return p;
  }
  const p = s.llm.providers.find((x) => x.id === body.providerId);
  if (!p) throw new Error('Provider not found');
  return p;
};

api.post('/settings/models', async (c) => {
  const body = await c.req.json();
  return c.json({ models: await listModels(resolveProvider(body)) });
});

api.post('/settings/test-llm', async (c) => {
  const body = (await c.req.json()) as { providerId?: string; provider?: unknown; model: string };
  return c.json(await testModel(resolveProvider(body), body.model));
});

api.get('/voices', async (c) => c.json(await listVoices(getSettings())));

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

api.get('/templates', (c) => c.json(templateCatalog()));
api.get('/fonts', (c) => c.json(FONTS));
api.get('/library', (c) => c.json(listLibrary()));
api.get('/render-presets', (c) => c.json(Object.entries(RENDER_PRESETS).map(([id, p]) => ({ id, label: p.label }))));

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

api.get('/projects', async (c) => c.json(await store.list()));

api.post('/projects', async (c) => {
  const body = z
    .object({ name: z.string().default('Untitled video'), format: z.enum(['long', 'short']).default('long'), mode: z.enum(['edit', 'generate', 'hybrid']).default('hybrid'), topic: z.string().default(''), demo: z.boolean().default(false) })
    .parse(await c.req.json().catch(() => ({})));
  const project = body.demo ? await store.create({ name: body.name }, createDemoProject(body.format)) : await store.create(body);
  return c.json(project);
});

api.get('/projects/:id', async (c) => {
  const id = c.req.param('id');
  const project = await store.get(id);
  return c.json({ project, history: await store.historyInfo(id) });
});

api.delete('/projects/:id', async (c) => {
  await store.remove(c.req.param('id'));
  return c.json({ ok: true });
});

api.post('/projects/:id/duplicate', async (c) => c.json(await store.duplicate(c.req.param('id'))));

api.post('/projects/:id/ops', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json()) as { ops: EditOp[]; label?: string };
  if (!Array.isArray(body.ops) || body.ops.length === 0) throw new Error('ops must be a non-empty array');
  let results: unknown[] = [];
  const removedFiles: string[] = [];
  const project = await store.update(
    id,
    body.label ?? describeOps(body.ops),
    (draft) => {
      results = applyOps(draft, body.ops);
      body.ops.forEach((op, i) => op.op === 'removeAsset' && typeof results[i] === 'string' && removedFiles.push(results[i] as string));
    },
    { source: 'user' },
  );
  return c.json({ project, results, history: await store.historyInfo(id) });
});

api.post('/projects/:id/undo', async (c) => {
  const r = await store.undo(c.req.param('id'));
  return c.json({ ok: Boolean(r), label: r?.label ?? null, project: r?.project ?? (await store.get(c.req.param('id'))), history: await store.historyInfo(c.req.param('id')) });
});

api.post('/projects/:id/redo', async (c) => {
  const r = await store.redo(c.req.param('id'));
  return c.json({ ok: Boolean(r), label: r?.label ?? null, project: r?.project ?? (await store.get(c.req.param('id'))), history: await store.historyInfo(c.req.param('id')) });
});

api.get('/projects/:id/transcripts', async (c) => c.json(await store.transcriptsFor(await store.get(c.req.param('id')))));

api.get('/projects/:id/lint', async (c) => c.json({ warnings: lintProject(await store.get(c.req.param('id')), TEMPLATE_IDS) }));

/** Server-sent events: project changes, agent activity, renders, jobs. */
api.get('/projects/:id/events', (c) => {
  const id = c.req.param('id');
  return streamSSE(c, async (stream) => {
    let open = true;
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = bus.subscribe(id, (event) => {
      queue.push(JSON.stringify(event));
      wake?.();
    });
    stream.onAbort(() => {
      open = false;
      unsubscribe();
      wake?.();
    });
    await stream.writeSSE({ event: 'hello', data: JSON.stringify({ projectId: id }) });
    while (open) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 15000);
        });
        wake = null;
        if (queue.length === 0 && open) {
          await stream.writeSSE({ event: 'ping', data: '{}' });
          continue;
        }
      }
      while (queue.length && open) await stream.writeSSE({ event: 'studio', data: queue.shift()! });
    }
  });
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

api.post('/projects/:id/assets', async (c) => {
  const id = c.req.param('id');
  if (!store.exists(id)) throw new Error('Project not found');
  const { files } = await receiveUploads(c, store.mediaDir(id));
  const assets = [];
  for (const f of files) assets.push(await registerAsset(id, { sourcePath: f.tmpPath, originalName: f.filename, origin: 'upload', updateSource: 'user', label: `Upload ${f.filename}` }));
  return c.json({ assets });
});

api.post('/projects/:id/assets/import-url', async (c) => {
  const id = c.req.param('id');
  const { url, name } = z.object({ url: z.string().url(), name: z.string().optional() }).parse(await c.req.json());
  const fileName = name ?? (decodeURIComponent(new URL(url).pathname.split('/').pop() || 'download') || 'download');
  return c.json(await downloadToProject(id, url, fileName, { origin: 'url', source: { provider: 'url', url }, updateSource: 'user' }));
});

api.post('/projects/:id/assets/library', async (c) => {
  const id = c.req.param('id');
  const { soundId } = z.object({ soundId: z.string() }).parse(await c.req.json());
  const item = listLibrary().find((s) => s.id === soundId);
  if (!item) throw new Error('Unknown sound');
  return c.json(await registerAsset(id, { sourcePath: libraryFile(soundId), originalName: `${item.name}.wav`, copy: true, origin: 'library', tags: [item.kind, ...item.tags], description: item.description, updateSource: 'user', wait: true }));
});

api.delete('/projects/:id/assets/:assetId', async (c) => {
  const id = c.req.param('id');
  const assetId = c.req.param('assetId');
  const project = await store.get(id);
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error('Asset not found');
  await store.update(id, `Delete ${asset.name}`, (p) => void applyOps(p, [{ op: 'removeAsset', assetId }]), { source: 'user' });
  return c.json({ ok: true });
});

api.get('/projects/:id/assets/:assetId/transcript', async (c) => c.json((await store.readTranscript(c.req.param('id'), c.req.param('assetId'))) ?? []));

api.put('/projects/:id/assets/:assetId/transcript', async (c) => {
  const id = c.req.param('id');
  const assetId = c.req.param('assetId');
  const words = WordSchema.array().parse((await c.req.json()).words);
  const file = await store.writeTranscript(id, assetId, words);
  await store.update(id, 'Edit transcript', (p) => {
    const a = p.assets.find((x) => x.id === assetId);
    if (a) a.transcript = { ...a.transcript, status: 'done', file, wordCount: words.length, engine: a.transcript.engine ?? 'manual', preview: words.slice(0, 60).map((w) => w.text).join(' ') };
  }, { source: 'user' });
  return c.json({ ok: true });
});

api.post('/projects/:id/assets/:assetId/transcribe', async (c) => {
  const id = c.req.param('id');
  const assetId = c.req.param('assetId');
  const { language } = z.object({ language: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
  queueTranscription(id, assetId, { language, force: true }).catch((err) => bus.toast(id, 'error', `Transcription failed: ${(err as Error).message}`));
  return c.json({ ok: true });
});

api.post('/projects/:id/assets/:assetId/attach-subtitles', async (c) => {
  const { subtitleAssetId } = z.object({ subtitleAssetId: z.string() }).parse(await c.req.json());
  return c.json({ words: await attachSubtitles(c.req.param('id'), c.req.param('assetId'), subtitleAssetId) });
});

api.post('/projects/:id/assets/:assetId/analyze', async (c) => {
  await analyzeAsset(c.req.param('id'), c.req.param('assetId'));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

api.post('/projects/:id/render', async (c) => {
  const body = z
    .object({ preset: z.enum(Object.keys(RENDER_PRESETS) as [RenderPreset, ...RenderPreset[]]).optional(), range: z.tuple([z.number(), z.number()]).optional(), normalize: z.boolean().optional() })
    .parse(await c.req.json().catch(() => ({})));
  return c.json(await startRender(c.req.param('id'), body));
});

api.post('/projects/:id/render/:renderId/cancel', (c) => c.json({ ok: cancelRender(c.req.param('renderId')) }));

api.delete('/projects/:id/render/:renderId', async (c) => {
  const id = c.req.param('id');
  const renderId = c.req.param('renderId');
  cancelRender(renderId);
  for (const ext of ['.mp4', '.srt', '.raw.mp4']) await fsp.rm(store.renderPath(id, `${renderId}${ext}`), { force: true });
  await store.update(id, 'Delete render', (p) => void (p.renders = p.renders.filter((r) => r.id !== renderId)), { history: false, source: 'user' });
  return c.json({ ok: true });
});

api.post('/projects/:id/frames', async (c) => {
  const id = c.req.param('id');
  const { times } = z.object({ times: z.array(z.number().min(0)).min(1).max(12) }).parse(await c.req.json());
  const { frames, errors } = await renderFrames(id, times);
  return c.json({ frames: frames.map((f) => ({ time: f.time, url: `/renders/${id}/${f.file.split(path.sep).join('/')}` })), errors });
});

api.post('/projects/:id/thumbnail', async (c) => {
  const id = c.req.param('id');
  const file = await renderThumbnail(id);
  return c.json({ url: `/media/${id}/${path.basename(file)}` });
});

// ---------------------------------------------------------------------------
// Static media + downloads
// ---------------------------------------------------------------------------

export const media = new Hono();

media.on(['GET', 'HEAD'], '/media/:projectId/:file{.+}', async (c) => {
  try {
    return await serveFile(c, store.mediaPath(c.req.param('projectId'), decodeURIComponent(c.req.param('file'))));
  } catch {
    return c.json({ error: 'Not found' }, 404);
  }
});

media.on(['GET', 'HEAD'], '/renders/:projectId/:file{.+}', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const file = decodeURIComponent(c.req.param('file'));
    const project = await store.get(projectId);
    const download = c.req.query('download') !== undefined ? `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'video'}${path.extname(file)}` : undefined;
    return await serveFile(c, store.renderPath(projectId, file), { download });
  } catch {
    return c.json({ error: 'Not found' }, 404);
  }
});

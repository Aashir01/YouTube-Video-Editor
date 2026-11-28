import fsp from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { WordSchema } from '../../shared/schema';
import { applyOps, describeOps, type EditOp } from '../../shared/ops';
import { lintProject, projectDuration } from '../../shared/timeline';
import { createDemoProject } from '../../shared/sample';
import { TEMPLATE_IDS, templateCatalog } from '../../shared/templates';
import { FONTS } from '../../shared/fonts';
import { APP_ROOT, DATA_DIR, getSavedSettings, getSettings, maskedSettings, mergeSettingsUpdate, saveSettings, ProviderSchema, type Settings } from '../config';
import { bus } from '../events';
import { store } from '../storage/projects';
import { serveFile, receiveUploads } from '../http/files';
import { attachSubtitles, analyzeAsset, downloadToProject, ensureFilmstrip, ensureProxy, queueTranscription, registerAsset, removeProxy } from '../media/ingest';
import { ffInfo } from '../media/ffmpeg';
import { libraryFile, listLibrary } from '../media/sfx';
import { cancelRender, renderFrames, renderThumbnail, startRender, RENDER_PRESETS, type RenderPreset } from '../render/render';
import { resolveBrowserExecutable } from '../render/browser';
import { localWhisperAvailable, pickTranscriptionEngine } from '../services/transcribe';
import { listModels, testModel } from '../ai/llm';
import { listVoices, pickTtsEngine } from '../services/tts';
import { mcpManager } from '../mcp/client';
import { createShort } from '../shorts';
import { findMoments, momentsAreCurrent, readMoments, shortFromMoment } from '../moments';
import { applyMulticam, planMulticam } from '../multicam';
import { readTranslations, removeLanguage, subtitleSource, subtitlesSrt, translateSubtitles } from '../subtitles';
import { createDub } from '../dub';
import { beatsFor } from '../footage';
import { missingCounts } from '../../shared/subtitles';
import { analysisQueue } from '../jobs';
import { importOptional } from '../optional';
import { cloud } from './cloud';
import { readAutopilot, startAutopilot, stopAutopilot } from '../autopilot';

export const api = new Hono();

api.route('/cloud', cloud);

const errorMessage = (err: unknown) => (err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : err instanceof Error ? err.message : String(err));

api.onError((err, c) => {
  const status = /not found/i.test(err.message) ? 404 : 400;
  if (status === 400) console.warn('[api]', c.req.method, c.req.path, '-', errorMessage(err));
  return c.json({ error: errorMessage(err) }, status);
});

// ---------------------------------------------------------------------------
// Health & system
// ---------------------------------------------------------------------------

api.get('/health', (c) => c.json({ ok: true, name: 'Cutroom', time: new Date().toISOString() }));

api.get('/system', async (c) => {
  const s = getSettings();
  const [stt, tts] = await Promise.all([pickTranscriptionEngine(s), pickTtsEngine(s)]);
  let kokoro = false;
  try {
    await importOptional('kokoro-js');
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
    appRoot: APP_ROOT,
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
api.get('/library/:soundId/audio', async (c) => serveFile(c, libraryFile(c.req.param('soundId'))));
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

/** Cut time ranges of this video into a new vertical Short project. */
api.post('/projects/:id/shorts', async (c) => {
  const body = z
    .object({ ranges: z.array(z.tuple([z.number(), z.number()])).min(1).max(20), title: z.string().max(120).optional(), focusX: z.number().min(0).max(1).optional() })
    .parse(await c.req.json());
  const short = await createShort(c.req.param('id'), body.ranges, { title: body.title, focusX: body.focusX });
  return c.json({ id: short.id, name: short.name, duration: projectDuration(short) });
});

/** Subtitles in other languages: the translations, and how many sentences of the current edit each still lacks. */
const translationsReply = async (id: string) => {
  const p = await store.get(id);
  const state = await readTranslations(id);
  return { state, missing: missingCounts(subtitleSource(p, await store.transcriptsFor(p)), state) };
};

api.get('/projects/:id/translations', async (c) => c.json(await translationsReply(c.req.param('id'))));

api.post('/projects/:id/translations', async (c) => {
  const id = c.req.param('id');
  const body = z.object({ languages: z.array(z.string()).min(1).max(20), metadata: z.boolean().optional() }).parse(await c.req.json());
  const r = await translateSubtitles(id, body.languages, { metadata: body.metadata });
  return c.json({ ...(await translationsReply(id)), translated: r.translated, failed: r.missing });
});

api.delete('/projects/:id/translations/:lang', async (c) => {
  await removeLanguage(c.req.param('id'), c.req.param('lang'));
  return c.json(await translationsReply(c.req.param('id')));
});

/** The current edit's subtitles in one language, as an SRT download. */
api.get('/projects/:id/subtitles/:file', async (c) => {
  const id = c.req.param('id');
  const lang = c.req.param('file').replace(/\.srt$/i, '');
  const p = await store.get(id);
  const srt = await subtitlesSrt(id, lang);
  const name = `${p.name.replace(/[^\w\- ]+/g, '').trim() || 'subtitles'}.${lang}.srt`;
  return new Response(srt, { headers: { 'Content-Type': 'application/x-subrip; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` } });
});

/** Find the beats of a music file (kept with the asset: the timeline shows them and snaps to them). */
api.post('/projects/:id/assets/:assetId/beats', async (c) => {
  const r = await beatsFor(c.req.param('id'), c.req.param('assetId'));
  return c.json({ tempo: r.tempo, beats: r.beats.length });
});

/** A dubbed copy of the project in another language. */
api.post('/projects/:id/dub', async (c) => {
  const body = z.object({ language: z.string(), voice: z.string().optional(), original: z.enum(['duck', 'mute']).optional() }).parse(await c.req.json());
  const r = await createDub(c.req.param('id'), body.language, { voice: body.voice, original: body.original });
  return c.json({ id: r.project.id, name: r.project.name, lines: r.lines, cut: r.cut, engine: r.engine });
});

/** Multicam: sync cameras and microphones by sound and cut between them. */
api.post('/projects/:id/multicam', async (c) => {
  const id = c.req.param('id');
  const body = z
    .object({
      cameras: z.array(z.string()).min(1).max(9),
      microphones: z.array(z.string()).max(8).optional(),
      follow: z.enum(['speaker', 'first']).optional(),
      wide: z.string().optional(),
      at: z.number().min(0).optional(),
      name: z.string().max(80).optional(),
    })
    .parse(await c.req.json());
  const plan = await analysisQueue.add(id, 'Multicam: syncing by sound', async (report) => planMulticam(await store.get(id), body, undefined, report));
  await store.update(id, 'Multicam edit', (d) => void applyMulticam(d, plan), { source: 'user' });
  return c.json({ groupId: plan.group.id, summary: plan.summary, warnings: plan.warnings, cuts: plan.cuts.length });
});

/** Find Shorts: the moments the AI picked (and whether the edit changed since). */
api.get('/projects/:id/moments', async (c) => {
  const id = c.req.param('id');
  const state = await readMoments(id);
  return c.json({ state, current: state ? await momentsAreCurrent(id, state) : true });
});

api.post('/projects/:id/moments', async (c) => {
  const body = z
    .object({ count: z.number().int().min(1).max(12).optional(), minSec: z.number().min(5).max(170).optional(), maxSec: z.number().min(10).max(180).optional(), focus: z.string().max(300).optional() })
    .parse(await c.req.json().catch(() => ({})));
  const state = await findMoments(c.req.param('id'), body);
  return c.json({ state, current: true });
});

api.get('/projects/:id/autopilot', async (c) => c.json({ state: await readAutopilot(c.req.param('id')) }));

api.post('/projects/:id/autopilot', async (c) => {
  const body = z
    .object({ momentIds: z.array(z.string()).optional(), upload: z.boolean().optional(), firstAt: z.string().optional(), everyHours: z.number().min(1).max(336).optional(), retry: z.boolean().optional() })
    .parse(await c.req.json().catch(() => ({})));
  return c.json({ state: await startAutopilot(c.req.param('id'), body) });
});

api.post('/projects/:id/autopilot/stop', (c) => c.json({ stopping: stopAutopilot(c.req.param('id')) }));

api.post('/projects/:id/moments/:momentId/short', async (c) => c.json(await shortFromMoment(c.req.param('id'), c.req.param('momentId'))));

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
  }, { source: 'user', history: false }); // a spelling fix, not an edit: undo can't restore transcript files anyway
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

api.post('/projects/:id/assets/:assetId/filmstrip', async (c) => {
  await ensureFilmstrip(c.req.param('id'), c.req.param('assetId'));
  return c.json({ ok: true });
});

// editing proxy: created in the background (progress arrives as a job); DELETE plays the original again
api.post('/projects/:id/assets/:assetId/proxy', (c) => {
  void ensureProxy(c.req.param('id'), c.req.param('assetId')).catch((err) => console.warn('[proxy]', (err as Error).message));
  return c.json({ ok: true });
});

api.delete('/projects/:id/assets/:assetId/proxy', async (c) => {
  await removeProxy(c.req.param('id'), c.req.param('assetId'));
  return c.json({ ok: true });
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
    .object({ preset: z.enum(Object.keys(RENDER_PRESETS) as [RenderPreset, ...RenderPreset[]]).optional(), range: z.tuple([z.number(), z.number()]).optional(), normalize: z.boolean().optional(), audioOnly: z.boolean().optional() })
    .parse(await c.req.json().catch(() => ({})));
  return c.json(await startRender(c.req.param('id'), body));
});

api.post('/projects/:id/render/:renderId/cancel', (c) => c.json({ ok: cancelRender(c.req.param('renderId')) }));

api.delete('/projects/:id/render/:renderId', async (c) => {
  const id = c.req.param('id');
  const renderId = c.req.param('renderId');
  cancelRender(renderId);
  for (const ext of ['.mp4', '.mp3', '.m4a', '.srt', '.raw.mp4', '.raw.wav']) await fsp.rm(store.renderPath(id, `${renderId}${ext}`), { force: true });
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

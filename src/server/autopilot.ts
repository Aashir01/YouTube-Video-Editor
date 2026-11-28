/**
 * Shorts autopilot: make a Short from every found moment, render it, and upload it to YouTube
 * scheduled (one a day by default, best first). Runs in the background; the state is kept next to
 * the source project (autopilot.json) and streamed to the Shorts tab as it changes.
 */
import fs from 'node:fs';
import { autopilotOrder, FINISHED, planSchedule, shortMetadata, type AutopilotItem, type AutopilotOptions, type AutopilotState } from '../shared/autopilot';
import { bus } from './events';
import { momentsAreCurrent, readMoments, shortFromMoment } from './moments';
import { cancelRender, startRender, waitForRender } from './render/render';
import { uploadVideo, youtubeConfigured } from './services/youtube';
import { store } from './storage/projects';

const FILE = 'autopilot.json';

interface Run {
  stop: boolean;
  renderId?: string;
}
const runs = new Map<string, Run>();

const save = async (projectId: string, state: AutopilotState) => {
  await store.writeSideFile(projectId, FILE, state);
  bus.emit(projectId, { type: 'autopilot', state });
};

/** The saved state; a run cut short by a restart reads as stopped, its current step as failed. */
export const readAutopilot = async (projectId: string): Promise<AutopilotState | null> => {
  const s = await store.readSideFile<AutopilotState>(projectId, FILE);
  if (s?.status === 'running' && !runs.has(projectId)) {
    s.status = 'stopped';
    for (const it of s.items) if (['making', 'rendering', 'uploading'].includes(it.status)) Object.assign(it, { status: 'failed', error: 'Interrupted: Cutroom was closed while this Short was in progress', progress: undefined });
    await store.writeSideFile(projectId, FILE, s);
  }
  return s;
};

export const isAutopilotRunning = (projectId: string) => runs.has(projectId);

const MIN_LEAD = 20 * 60_000;

const runItem = async (projectId: string, state: AutopilotState, it: AutopilotItem, run: Run, emit: (force?: boolean) => Promise<void>) => {
  const set = async (patch: Partial<AutopilotItem>, force = true) => {
    Object.assign(it, patch);
    await emit(force);
  };
  // 1) the Short (made earlier from the Shorts tab, or now)
  await set({ status: 'making', progress: undefined, error: undefined });
  const moments = await readMoments(projectId);
  const moment = moments?.moments.find((m) => m.id === it.momentId);
  if (!moment) throw new Error('This moment is gone: find Shorts again');
  const shortId = moment.shortId && store.exists(moment.shortId) ? moment.shortId : (await shortFromMoment(projectId, moment.id)).id;
  const source = await store.get(projectId);
  const meta = shortMetadata(moment, { title: source.youtube.title || source.name, videoId: source.youtube.uploadedVideoId, hashtags: source.youtube.hashtags });
  await store.update(
    shortId,
    'Shorts autopilot: YouTube details',
    (d) => {
      d.youtube.title ||= meta.title;
      d.youtube.description ||= meta.description;
      const seen = new Set<string>();
      d.youtube.hashtags = [...meta.hashtags, ...d.youtube.hashtags.map((h) => h.replace(/^#/, ''))].filter((h) => !seen.has(h.toLowerCase()) && seen.add(h.toLowerCase())).slice(0, 15);
    },
    { history: false, source: 'system' },
  );
  await set({ shortId });
  if (run.stop) return;

  // 2) render (renders queue up, one at a time)
  const record = await startRender(shortId, { preset: 'standard' });
  run.renderId = record.id;
  await set({ status: 'rendering', renderId: record.id, progress: 0 });
  const off = bus.subscribe(shortId, (e) => {
    if (e.type === 'render' && e.render.id === record.id) {
      it.progress = e.render.progress;
      void emit(false);
    }
  });
  let done;
  try {
    done = await waitForRender(shortId, record.id);
  } finally {
    off();
    run.renderId = undefined;
  }
  if (done.status === 'cancelled' || run.stop) throw Object.assign(new Error('Stopped'), { cancelled: true });
  if (done.status !== 'done' || !done.file) throw new Error(`The render failed: ${done.error ?? 'unknown error'}`);
  if (!state.options.upload) return set({ status: 'rendered', progress: undefined });

  // 3) upload, scheduled (YouTube refuses times in the past: a slot that has passed moves to soon)
  let publishAt = it.publishAt;
  let note: string | undefined;
  if (publishAt && new Date(publishAt).getTime() < Date.now() + MIN_LEAD) {
    publishAt = new Date(Date.now() + 60 * 60_000).toISOString();
    note = 'Its slot had passed, so it goes public in an hour';
  }
  await set({ status: 'uploading', progress: 0, publishAt, note });
  const short = await store.get(shortId);
  const srt = store.renderPath(shortId, done.file.replace(/\.mp4$/, '.srt'));
  const r = await uploadVideo(short, {
    videoFile: store.renderPath(shortId, done.file),
    captionsFile: fs.existsSync(srt) ? srt : undefined,
    privacy: 'private',
    publishAt,
    onProgress: (x) => {
      it.progress = x;
      void emit(false);
    },
  });
  await store.update(shortId, 'Uploaded to YouTube', (d) => void (d.youtube.uploadedVideoId = r.videoId), { history: false, source: 'system' });
  await set({ status: 'scheduled', progress: undefined, videoId: r.videoId, url: r.url, note: [note, ...r.warnings].filter(Boolean).join(' ') || undefined });
};

const loop = async (projectId: string, state: AutopilotState, run: Run) => {
  let last = 0;
  const emit = async (force = true) => {
    if (!force && Date.now() - last < 1000) return;
    last = Date.now();
    await save(projectId, state);
  };
  try {
    for (const it of state.items) {
      if (it.status !== 'queued') continue;
      if (run.stop) break;
      try {
        await runItem(projectId, state, it, run, emit);
      } catch (err) {
        const cancelled = (err as { cancelled?: boolean }).cancelled || run.stop;
        Object.assign(it, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : (err as Error).message, progress: undefined });
        await emit();
      }
    }
    for (const it of state.items) if (it.status === 'queued') it.status = 'cancelled';
    state.status = run.stop ? 'stopped' : 'done';
    await save(projectId, state);
    const ok = state.items.filter((i) => FINISHED.includes(i.status)).length;
    const failed = state.items.filter((i) => i.status === 'failed').length;
    bus.toast(projectId, failed ? 'warning' : 'success', `Shorts autopilot: ${ok} Short${ok === 1 ? '' : 's'} ${state.options.upload ? 'scheduled on YouTube' : 'rendered'}${failed ? `, ${failed} failed` : ''}`);
  } finally {
    runs.delete(projectId);
  }
};

export interface StartAutopilot extends Partial<AutopilotOptions> {
  /** which moments (default: all found) */
  momentIds?: string[];
  /** run the failed and stopped ones of the last run again, at their times */
  retry?: boolean;
}

export const startAutopilot = async (projectId: string, opts: StartAutopilot = {}): Promise<AutopilotState> => {
  if (runs.has(projectId)) throw new Error('The Shorts autopilot is already running for this video');
  const moments = await readMoments(projectId);
  if (!moments?.moments.length) throw new Error('Find Shorts first: the autopilot makes Shorts from the moments it finds');
  if (!(await momentsAreCurrent(projectId, moments))) throw new Error('The video was edited since these moments were found; find Shorts again so the times match');

  let state: AutopilotState;
  const prev = opts.retry ? await readAutopilot(projectId) : null;
  if (prev) {
    if (prev.options.upload && !youtubeConfigured().connected) throw new Error('Connect YouTube in Settings → YouTube to schedule the Shorts');
    state = { ...prev, status: 'running', items: prev.items.map((i) => (i.status === 'failed' || i.status === 'cancelled' ? { ...i, status: 'queued', error: undefined, progress: undefined } : i)) };
  } else {
    const upload = opts.upload ?? youtubeConfigured().connected;
    if (upload && !youtubeConfigured().connected) throw new Error('Connect YouTube in Settings → YouTube to schedule the Shorts, or turn uploading off to only render them');
    const picked = autopilotOrder(moments.moments.filter((m) => !opts.momentIds || opts.momentIds.includes(m.id)));
    if (!picked.length) throw new Error('None of those moments were found');
    const firstAt = opts.firstAt ?? new Date(Date.now() + 24 * 3_600_000).toISOString();
    if (upload && new Date(firstAt).getTime() < Date.now() + MIN_LEAD) throw new Error('Pick a first publish time at least 20 minutes from now');
    const everyHours = Math.min(24 * 14, Math.max(1, opts.everyHours ?? 24));
    const times = planSchedule(picked.length, firstAt, everyHours);
    state = {
      createdAt: new Date().toISOString(),
      options: { upload, firstAt: times[0]!, everyHours },
      status: 'running',
      items: picked.map((m, i) => ({ momentId: m.id, title: m.title, status: 'queued', ...(upload ? { publishAt: times[i] } : {}) })),
    };
  }
  const run: Run = { stop: false };
  runs.set(projectId, run);
  await save(projectId, state);
  void loop(projectId, state, run);
  return state;
};

/** Stop after the current step (a running render is cancelled; uploads already sent stay scheduled). */
export const stopAutopilot = (projectId: string) => {
  const run = runs.get(projectId);
  if (!run) return false;
  run.stop = true;
  if (run.renderId) cancelRender(run.renderId);
  return true;
};

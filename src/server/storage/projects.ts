import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ProjectSchema, WordSchema, type Asset, type Project, type Word } from '../../shared/schema';
import { createProject, projectDuration, reconcileFollowers, type CreateProjectOptions } from '../../shared/timeline';
import { uid } from '../../shared/ids';
import { PROJECTS_DIR } from '../config';
import { bus } from '../events';

const HISTORY_LIMIT = 50;

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  duration: number;
  width: number;
  height: number;
  topic: string;
  thumb?: string;
  assetCount: number;
}

interface HistoryEntry {
  id: string;
  label: string;
  at: string;
}

interface ProjectState {
  project: Project;
  past: HistoryEntry[];
  future: { label: string; project: Project }[];
  lock: Promise<unknown>;
}

const writeJsonAtomic = async (file: string, data: unknown) => {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 1));
  await fsp.rename(tmp, file);
};

export type UpdateSource = 'user' | 'agent' | 'system' | 'mcp';

/**
 * File-backed project storage with serialized updates, history (undo/redo),
 * and change notifications. Each project lives in data/projects/<id>/.
 */
export class ProjectStore {
  private states = new Map<string, ProjectState>();
  private transcriptCache = new Map<string, Word[]>();

  dir(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error('Invalid project id');
    return path.join(PROJECTS_DIR, id);
  }
  mediaDir(id: string) {
    return path.join(this.dir(id), 'media');
  }
  rendersDir(id: string) {
    return path.join(this.dir(id), 'renders');
  }
  historyDir(id: string) {
    return path.join(this.dir(id), 'history');
  }
  /** Absolute path of a media file, refusing anything that escapes the media folder. */
  mediaPath(id: string, file: string) {
    const base = this.mediaDir(id);
    const full = path.resolve(base, file);
    if (!full.startsWith(base + path.sep)) throw new Error('Invalid media path');
    return full;
  }
  renderPath(id: string, file: string) {
    const base = this.rendersDir(id);
    const full = path.resolve(base, file);
    if (!full.startsWith(base + path.sep)) throw new Error('Invalid render path');
    return full;
  }

  exists(id: string): boolean {
    try {
      return fs.existsSync(path.join(this.dir(id), 'project.json'));
    } catch {
      return false;
    }
  }

  async list(): Promise<ProjectSummary[]> {
    const ids = (await fsp.readdir(PROJECTS_DIR).catch(() => [] as string[])).filter((d) => this.exists(d));
    const out: ProjectSummary[] = [];
    for (const id of ids) {
      try {
        const p = await this.get(id);
        const firstVisual = p.assets.find((a) => a.thumb);
        out.push({
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          createdAt: p.createdAt,
          duration: projectDuration(p),
          width: p.canvas.width,
          height: p.canvas.height,
          topic: p.brief.topic,
          thumb: p.youtube.thumbnail.file ?? firstVisual?.thumb,
          assetCount: p.assets.length,
        });
      } catch (err) {
        console.warn(`[store] skipping unreadable project ${id}:`, (err as Error).message);
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(opts: CreateProjectOptions, seed?: Project): Promise<Project> {
    const project = seed ? ProjectSchema.parse({ ...seed, id: uid('prj', 10) }) : createProject(opts);
    if (seed) project.name = opts.name || project.name;
    await fsp.mkdir(this.mediaDir(project.id), { recursive: true });
    await fsp.mkdir(this.rendersDir(project.id), { recursive: true });
    await fsp.mkdir(this.historyDir(project.id), { recursive: true });
    await writeJsonAtomic(path.join(this.dir(project.id), 'project.json'), project);
    this.states.set(project.id, { project, past: [], future: [], lock: Promise.resolve() });
    return project;
  }

  private async load(id: string): Promise<ProjectState> {
    const cached = this.states.get(id);
    if (cached) return cached;
    const raw = JSON.parse(await fsp.readFile(path.join(this.dir(id), 'project.json'), 'utf8'));
    const project = ProjectSchema.parse(raw);
    let past: HistoryEntry[] = [];
    try {
      past = JSON.parse(await fsp.readFile(path.join(this.historyDir(id), 'index.json'), 'utf8'));
    } catch {
      /* no history yet */
    }
    const state: ProjectState = { project, past, future: [], lock: Promise.resolve() };
    this.states.set(id, state);
    return state;
  }

  async get(id: string): Promise<Project> {
    return (await this.load(id)).project;
  }

  async historyInfo(id: string) {
    const s = await this.load(id);
    return { canUndo: s.past.length > 0, canRedo: s.future.length > 0, past: s.past.slice(-20).map((h) => h.label).reverse() };
  }

  /**
   * Apply a mutation atomically. Updates are serialized per project. Throwing
   * inside the mutator leaves the project untouched.
   */
  async update(
    id: string,
    label: string,
    mutator: (draft: Project) => void | Promise<void>,
    opts: { source?: UpdateSource; history?: boolean } = {},
  ): Promise<Project> {
    const state = await this.load(id);
    const run = async () => {
      const prev = state.project;
      const draft = structuredClone(prev);
      await mutator(draft);
      reconcileFollowers(draft, prev);
      draft.updatedAt = new Date().toISOString();
      const next = ProjectSchema.parse(draft);
      if (opts.history !== false) {
        const entry: HistoryEntry = { id: uid('h', 10), label, at: draft.updatedAt };
        await fsp.mkdir(this.historyDir(id), { recursive: true });
        await writeJsonAtomic(path.join(this.historyDir(id), `${entry.id}.json`), prev);
        state.past.push(entry);
        while (state.past.length > HISTORY_LIMIT) {
          const old = state.past.shift()!;
          await fsp.rm(path.join(this.historyDir(id), `${old.id}.json`), { force: true });
        }
        state.future = [];
        await writeJsonAtomic(path.join(this.historyDir(id), 'index.json'), state.past);
      }
      state.project = next;
      await writeJsonAtomic(path.join(this.dir(id), 'project.json'), next);
      this.emitProject(id, label, opts.source ?? 'system');
      return next;
    };
    const result = state.lock.then(run, run);
    state.lock = result.catch(() => undefined);
    return result;
  }

  private emitProject(id: string, label: string, source: UpdateSource) {
    const s = this.states.get(id);
    if (!s) return;
    bus.emit(id, { type: 'project', project: s.project, label, source, canUndo: s.past.length > 0, canRedo: s.future.length > 0 });
  }

  async undo(id: string): Promise<{ project: Project; label: string } | null> {
    const state = await this.load(id);
    const run = async () => {
      const entry = state.past.pop();
      if (!entry) return null;
      const file = path.join(this.historyDir(id), `${entry.id}.json`);
      const snapshot = ProjectSchema.parse(JSON.parse(await fsp.readFile(file, 'utf8')));
      // keep media/render/transcript state from "now": undo is about edits, not files on disk
      snapshot.assets = this.mergeAssetState(snapshot.assets, state.project.assets);
      snapshot.renders = state.project.renders;
      snapshot.youtube.thumbnail.file = state.project.youtube.thumbnail.file;
      state.future.push({ label: entry.label, project: state.project });
      state.project = snapshot;
      await fsp.rm(file, { force: true });
      await writeJsonAtomic(path.join(this.historyDir(id), 'index.json'), state.past);
      await writeJsonAtomic(path.join(this.dir(id), 'project.json'), snapshot);
      this.emitProject(id, `Undo: ${entry.label}`, 'user');
      return { project: snapshot, label: entry.label };
    };
    const result = state.lock.then(run, run);
    state.lock = result.catch(() => undefined);
    return result;
  }

  async redo(id: string): Promise<{ project: Project; label: string } | null> {
    const state = await this.load(id);
    const run = async () => {
      const next = state.future.pop();
      if (!next) return null;
      const entry: HistoryEntry = { id: uid('h', 10), label: next.label, at: new Date().toISOString() };
      await writeJsonAtomic(path.join(this.historyDir(id), `${entry.id}.json`), state.project);
      state.past.push(entry);
      next.project.assets = this.mergeAssetState(next.project.assets, state.project.assets);
      next.project.renders = state.project.renders;
      next.project.youtube.thumbnail.file = state.project.youtube.thumbnail.file;
      state.project = next.project;
      await writeJsonAtomic(path.join(this.historyDir(id), 'index.json'), state.past);
      await writeJsonAtomic(path.join(this.dir(id), 'project.json'), state.project);
      this.emitProject(id, `Redo: ${next.label}`, 'user');
      return { project: state.project, label: next.label };
    };
    const result = state.lock.then(run, run);
    state.lock = result.catch(() => undefined);
    return result;
  }

  /** Keep the latest analysis/transcript info for assets that still exist in the restored snapshot. */
  private mergeAssetState(restored: Asset[], latest: Asset[]): Asset[] {
    const byId = new Map(latest.map((a) => [a.id, a]));
    const out = restored.map((a) => {
      const now = byId.get(a.id);
      return now ? { ...a, status: now.status, meta: now.meta, thumb: now.thumb, waveform: now.waveform, transcript: now.transcript, text: now.text, analysis: now.analysis, error: now.error } : a;
    });
    return out;
  }

  async remove(id: string): Promise<void> {
    this.states.delete(id);
    await fsp.rm(this.dir(id), { recursive: true, force: true });
  }

  async duplicate(id: string, name?: string): Promise<Project> {
    const src = await this.get(id);
    const copy = await this.create({ name: name ?? `${src.name} (copy)` }, { ...structuredClone(src), renders: [] });
    await fsp.cp(this.mediaDir(id), this.mediaDir(copy.id), { recursive: true });
    return copy;
  }

  // -------------------------------------------------------------------------
  // Transcripts (stored next to the media to keep project.json small)
  // -------------------------------------------------------------------------

  transcriptFile(assetId: string) {
    return `${assetId}.words.json`;
  }

  async readTranscript(projectId: string, assetId: string): Promise<Word[] | null> {
    const key = `${projectId}/${assetId}`;
    const hit = this.transcriptCache.get(key);
    if (hit) return hit;
    try {
      const raw = JSON.parse(await fsp.readFile(this.mediaPath(projectId, this.transcriptFile(assetId)), 'utf8'));
      const words = WordSchema.array().parse(raw);
      this.transcriptCache.set(key, words);
      return words;
    } catch {
      return null;
    }
  }

  async writeTranscript(projectId: string, assetId: string, words: Word[]): Promise<string> {
    const file = this.transcriptFile(assetId);
    await writeJsonAtomic(this.mediaPath(projectId, file), words);
    this.transcriptCache.set(`${projectId}/${assetId}`, words);
    return file;
  }

  async transcriptsFor(project: Project): Promise<Record<string, Word[]>> {
    const out: Record<string, Word[]> = {};
    for (const a of project.assets) {
      if (a.transcript.status !== 'done') continue;
      const w = await this.readTranscript(project.id, a.id);
      if (w) out[a.id] = w;
    }
    return out;
  }

  async readAssetText(projectId: string, asset: Asset): Promise<string | null> {
    if (!asset.text) return null;
    try {
      return await fsp.readFile(this.mediaPath(projectId, asset.text.file), 'utf8');
    } catch {
      return null;
    }
  }
}

export const store = new ProjectStore();

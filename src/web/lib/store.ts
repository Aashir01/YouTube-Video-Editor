import { create } from 'zustand';
import { toast } from 'sonner';
import type { Clip, Project, RenderRecord, Track, Word } from '../../shared/schema';
import { applyOps, type EditOp } from '../../shared/ops';
import { findClip, formatTime, projectDuration } from '../../shared/timeline';
import type { AgentEvent, ChatSnapshot } from '../../shared/agent-types';
import type { StudioEvent } from '../../server/events';
import { api, type HistoryInfo, type OpsResult, type SystemInfo } from './api';
import { connectProject } from './events';
import { errorText } from './utils';
import { prefs } from './prefs';

export type LeftTab = 'media' | 'graphics' | 'script' | 'audio' | 'brand';
export type RightTab = 'director' | 'inspector';
export type SettingsSection = 'models' | 'speech' | 'media' | 'agent' | 'render' | 'mcp' | 'youtube';

export interface Job {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  progress?: number;
  detail?: string;
  at: number;
}

const EMPTY_CHAT: ChatSnapshot = { messages: [], plan: [], state: { status: 'idle' }, usage: { inputTokens: 0, outputTokens: 0 } };

interface StudioStore {
  // app
  system: SystemInfo | null;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  refreshSystem: () => Promise<void>;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;

  // project
  projectId: string | null;
  project: Project | null;
  history: HistoryInfo;
  transcripts: Record<string, Word[]>;
  chat: ChatSnapshot;
  jobs: Record<string, Job>;
  connected: boolean;
  loadError: string | null;

  // editor
  time: number;
  playing: boolean;
  selection: string[];
  zoom: number;
  /** Timeline zoom follows the video length until the user zooms by hand. */
  autoFit: boolean;
  snapping: boolean;
  leftTab: LeftTab;
  rightTab: RightTab;
  exportOpen: boolean;
  composerFocusTick: number;
  /** Text to place in the chat composer (e.g. a brief typed before an AI model was configured). */
  composerPrefill: string | null;
  /** Asset ids attached to the next chat message. */
  composerAttachments: string[];
  attachToChat: (assetIds: string[]) => void;

  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  edit: (ops: EditOp[], label?: string) => Promise<OpsResult | null>;
  /** Apply an op locally now and send it after a pause; ops with the same key are merged (typing, sliders). */
  editSoon: (key: string, op: EditOp, label?: string) => void;
  flushEdits: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  select: (ids: string[], mode?: 'replace' | 'toggle' | 'add') => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (z: number) => void;
  setSnapping: (s: boolean) => void;
  setLeftTab: (t: LeftTab) => void;
  setRightTab: (t: RightTab) => void;
  setExportOpen: (o: boolean) => void;
  focusComposer: () => void;
  upsertRender: (r: RenderRecord) => void;
}

let disconnect: (() => void) | null = null;
let pendingOps = 0;
let opSeq = 0;
let opChain: Promise<unknown> = Promise.resolve();
const queued = new Map<string, { op: EditOp; label: string }>();
let queueTimer: ReturnType<typeof setTimeout> | null = null;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Merge patches but keep nulls (they mean "delete" on the server). */
const mergePatch = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? mergePatch(out[k] as Record<string, unknown>, v) : v;
  return out;
};
const mergeOps = (a: EditOp, b: EditOp): EditOp => ('patch' in a && 'patch' in b && a.op === b.op ? ({ ...b, patch: mergePatch(a.patch as Record<string, unknown>, b.patch as Record<string, unknown>) } as EditOp) : b);
let transcriptSig = '';
const jobTimers = new Map<string, ReturnType<typeof setTimeout>>();

const transcriptSignature = (p: Project) => p.assets.map((a) => `${a.id}:${a.transcript.status}:${a.transcript.wordCount ?? 0}`).join('|');

const applyAgentEvent = (chat: ChatSnapshot, e: AgentEvent): ChatSnapshot => {
  switch (e.kind) {
    case 'status':
      return { ...chat, state: e.state };
    case 'message':
      return chat.messages.some((m) => m.id === e.message.id)
        ? { ...chat, messages: chat.messages.map((m) => (m.id === e.message.id ? e.message : m)) }
        : { ...chat, messages: [...chat.messages, e.message] };
    case 'message-update':
      return { ...chat, messages: chat.messages.map((m) => (m.id === e.message.id ? e.message : m)) };
    case 'text-delta':
      return { ...chat, messages: chat.messages.map((m) => (m.id === e.messageId && m.role === 'assistant' ? { ...m, text: m.text + e.delta } : m)) };
    case 'plan':
      return { ...chat, plan: e.items };
    case 'usage':
      return { ...chat, usage: { inputTokens: e.inputTokens, outputTokens: e.outputTokens }, state: { ...chat.state, model: e.model } };
    case 'reset':
      return { ...chat, messages: [], plan: [] };
  }
};

export const useStudio = create<StudioStore>((set, get) => {
  const pruneSelection = (project: Project) => {
    const sel = get().selection;
    if (sel.length === 0) return sel;
    const next = sel.filter((id) => findClip(project, id));
    return next.length === sel.length ? sel : next;
  };

  const setProject = (project: Project, history?: HistoryInfo) => {
    set({ project, selection: pruneSelection(project), ...(history ? { history } : {}) });
    const sig = transcriptSignature(project);
    if (sig !== transcriptSig) {
      transcriptSig = sig;
      const id = project.id;
      api
        .transcripts(id)
        .then((t) => get().projectId === id && set({ transcripts: t }))
        .catch(() => undefined);
    }
  };

  const resync = async (id: string) => {
    const [{ project, history }, chat] = await Promise.all([api.project(id), api.chat(id)]);
    if (get().projectId !== id) return;
    setProject(project, history);
    set({ chat });
  };

  const onEvent = (e: StudioEvent) => {
    switch (e.type) {
      case 'project':
        // our own edits come back in the HTTP response; skip their echo while requests are in flight
        if (e.source === 'user' && (pendingOps > 0 || queued.size > 0)) return;
        setProject(e.project, { canUndo: e.canUndo, canRedo: e.canRedo });
        return;
      case 'agent':
        set({ chat: applyAgentEvent(get().chat, e.event) });
        return;
      case 'render':
        get().upsertRender(e.render);
        return;
      case 'job': {
        const job: Job = { id: e.id, label: e.label, status: e.status, progress: e.progress, detail: e.detail, at: Date.now() };
        set({ jobs: { ...get().jobs, [e.id]: job } });
        clearTimeout(jobTimers.get(e.id));
        if (e.status !== 'running') {
          jobTimers.set(
            e.id,
            setTimeout(
              () => {
                const { [e.id]: _gone, ...rest } = get().jobs;
                set({ jobs: rest });
              },
              e.status === 'done' ? 3500 : 9000,
            ),
          );
        }
        return;
      }
      case 'toast': {
        const fn = e.level === 'success' ? toast.success : e.level === 'error' ? toast.error : e.level === 'warning' ? toast.warning : toast.info;
        fn(e.message);
        return;
      }
    }
  };

  return {
    system: null,
    settingsOpen: false,
    settingsSection: 'models',
    refreshSystem: async () => {
      try {
        set({ system: await api.system() });
      } catch {
        /* server restarting */
      }
    },
    openSettings: (section) => set({ settingsOpen: true, settingsSection: section ?? get().settingsSection }),
    closeSettings: () => {
      set({ settingsOpen: false });
      void get().refreshSystem();
    },

    projectId: null,
    project: null,
    history: { canUndo: false, canRedo: false },
    transcripts: {},
    chat: EMPTY_CHAT,
    jobs: {},
    connected: false,
    loadError: null,

    time: 0,
    playing: false,
    selection: [],
    zoom: prefs.get('zoom', 0),
    autoFit: true,
    snapping: prefs.get('snapping', true),
    leftTab: prefs.get<LeftTab>('leftTab', 'media'),
    rightTab: 'director',
    exportOpen: false,
    composerFocusTick: 0,
    composerPrefill: null,
    composerAttachments: [],
    attachToChat: (ids) => {
      set({ composerAttachments: [...new Set([...get().composerAttachments, ...ids])] });
      get().focusComposer();
    },

    openProject: async (id) => {
      disconnect?.();
      transcriptSig = '';
      set({ projectId: id, project: null, chat: EMPTY_CHAT, transcripts: {}, jobs: {}, selection: [], time: 0, playing: false, loadError: null, rightTab: 'director', composerAttachments: [] });
      try {
        const [{ project, history }, chat] = await Promise.all([api.project(id), api.chat(id)]);
        if (get().projectId !== id) return;
        setProject(project, history);
        set({ chat });
      } catch (err) {
        set({ loadError: errorText(err) });
        return;
      }
      let first = true;
      disconnect = connectProject(id, {
        onEvent,
        onStatus: (connected) => set({ connected }),
        onHello: () => {
          if (!first) void resync(id).catch(() => undefined);
          first = false;
        },
      });
    },

    closeProject: () => {
      get().flushEdits();
      disconnect?.();
      disconnect = null;
      set({ projectId: null, project: null, chat: EMPTY_CHAT, selection: [], playing: false });
    },

    edit: async (ops, label) => {
      if (queued.size) get().flushEdits(); // keep the user's order of edits
      const { projectId, project } = get();
      if (!projectId || !project || ops.length === 0) return null;
      // apply locally first (same code as the server) for an instant UI
      try {
        const draft = structuredClone(project);
        applyOps(draft, ops);
        set({ project: draft });
      } catch (err) {
        toast.error(errorText(err));
        return null;
      }
      pendingOps++;
      const seq = ++opSeq;
      // requests run one after another so the server sees edits in the order they were made
      const request = opChain.then(() => api.ops(projectId, ops, label));
      opChain = request.catch(() => undefined);
      try {
        const res = await request;
        // intermediate responses would briefly undo newer local edits; only the latest one wins
        if (get().projectId === projectId && seq === opSeq) setProject(res.project, res.history);
        return res;
      } catch (err) {
        toast.error(errorText(err));
        await resync(projectId).catch(() => undefined);
        return null;
      } finally {
        pendingOps--;
      }
    },

    editSoon: (key, op, label = 'Edit') => {
      const { project } = get();
      if (!project) return;
      try {
        const draft = structuredClone(project);
        applyOps(draft, [op]);
        set({ project: draft });
      } catch (err) {
        toast.error(errorText(err));
        return;
      }
      const prev = queued.get(key);
      queued.set(key, { op: prev ? mergeOps(prev.op, op) : op, label });
      if (queueTimer) clearTimeout(queueTimer);
      queueTimer = setTimeout(() => get().flushEdits(), 450);
    },

    flushEdits: () => {
      if (queueTimer) clearTimeout(queueTimer);
      queueTimer = null;
      if (queued.size === 0) return;
      const items = [...queued.values()];
      queued.clear();
      void get().edit(
        items.map((i) => i.op),
        items.length === 1 ? items[0]!.label : `${items[0]!.label} (+${items.length - 1})`,
      );
    },

    undo: async () => {
      get().flushEdits();
      const id = get().projectId;
      if (!id) return;
      pendingOps++;
      try {
        const r = await api.undo(id);
        setProject(r.project, r.history);
        if (r.label) toast(`Undo: ${r.label}`, { duration: 1500 });
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        pendingOps--;
      }
    },

    redo: async () => {
      get().flushEdits();
      const id = get().projectId;
      if (!id) return;
      pendingOps++;
      try {
        const r = await api.redo(id);
        setProject(r.project, r.history);
        if (r.label) toast(`Redo: ${r.label}`, { duration: 1500 });
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        pendingOps--;
      }
    },

    select: (ids, mode = 'replace') => {
      const cur = get().selection;
      let next = ids;
      if (mode === 'toggle') next = ids.reduce((acc, id) => (acc.includes(id) ? acc.filter((x) => x !== id) : [...acc, id]), cur);
      if (mode === 'add') next = [...new Set([...cur, ...ids])];
      set({ selection: next });
    },
    setTime: (t) => set({ time: Math.max(0, t) }),
    setPlaying: (playing) => set({ playing }),
    setZoom: (zoom) => {
      prefs.set('zoom', zoom);
      set({ zoom });
    },
    setSnapping: (snapping) => {
      prefs.set('snapping', snapping);
      set({ snapping });
    },
    setLeftTab: (leftTab) => {
      prefs.set('leftTab', leftTab);
      set({ leftTab });
    },
    setRightTab: (rightTab) => set({ rightTab }),
    setExportOpen: (exportOpen) => set({ exportOpen }),
    focusComposer: () => set({ rightTab: 'director', composerFocusTick: get().composerFocusTick + 1 }),
    upsertRender: (r) => {
      const p = get().project;
      if (!p) return;
      const exists = p.renders.some((x) => x.id === r.id);
      set({ project: { ...p, renders: exists ? p.renders.map((x) => (x.id === r.id ? r : x)) : [r, ...p.renders] } });
    },
  };
});

// ---------------------------------------------------------------------------
// Selectors & helpers
// ---------------------------------------------------------------------------

export const useDuration = () => useStudio((s) => (s.project ? projectDuration(s.project) : 0));

export const getClipRef = (p: Project | null, clipId: string): { clip: Clip; track: Track } | null => {
  if (!p) return null;
  const r = findClip(p, clipId);
  return r ? { clip: r.clip, track: r.track } : null;
};

export const clipLabel = (clip: Clip, p?: Project | null): string => {
  if (clip.name) return clip.name;
  switch (clip.type) {
    case 'video':
    case 'image':
    case 'audio':
      return p?.assets.find((a) => a.id === clip.assetId)?.name ?? clip.type;
    case 'text':
      return clip.text.replace(/\*/g, '').slice(0, 40) || 'Text';
    case 'scene':
      return clip.template.replace(/-/g, ' ');
    case 'code':
      return clip.description?.slice(0, 40) || 'Code scene';
    case 'captions':
      return clip.mode === 'auto' ? 'Auto captions' : 'Captions';
  }
};

/** Editor state the agent should know about (sent alongside chat messages, not shown in the chat). */
export const editorContext = (): string => {
  const { project, time, selection } = useStudio.getState();
  if (!project) return '';
  const lines = [`Playhead: ${formatTime(time)} (of ${formatTime(projectDuration(project))})`];
  const refs = selection.map((id) => getClipRef(project, id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  if (refs.length) {
    lines.push('Selected clips:');
    for (const { clip, track } of refs.slice(0, 12)) {
      const what = clip.type === 'scene' ? `scene "${clip.template}"` : clip.type === 'text' ? `text "${clip.text.slice(0, 60)}"` : clip.type;
      lines.push(`- ${clip.id}: ${what} on ${track.name}, ${formatTime(clip.start)}–${formatTime(clip.start + clip.duration)}`);
    }
  }
  return lines.join('\n');
};

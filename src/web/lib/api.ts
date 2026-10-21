import type { Project, RenderRecord, Word } from '../../shared/schema';
import type { EditOp } from '../../shared/ops';
import type { AnswerItem, ChatSnapshot } from '../../shared/agent-types';

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

export interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
  past?: string[];
}

export interface SystemInfo {
  ffmpeg: { available: boolean; source: string; full: boolean; error?: string };
  browser: string;
  localWhisper: boolean;
  kokoro: boolean;
  transcription: string | null;
  tts: string | null;
  llm: { providerId: string; model: string } | null;
  providers: { id: string; name: string; type: string; hasKey: boolean }[];
  dataDir: string;
  node: string;
  platform: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  overlay: boolean;
  defaultDuration: number;
  props: { properties?: Record<string, JsonSchemaProp>; required?: string[] };
  example: Record<string, unknown>;
}

export interface JsonSchemaProp {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
  items?: JsonSchemaProp & { properties?: Record<string, JsonSchemaProp> };
  properties?: Record<string, JsonSchemaProp>;
  anyOf?: JsonSchemaProp[];
  minimum?: number;
  maximum?: number;
}

export interface LibrarySound {
  id: string;
  name: string;
  kind: 'sfx' | 'music';
  description: string;
  tags: string[];
}

const handle = async <T>(res: Response): Promise<T> => {
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
};

const get = <T>(url: string) => fetch(url).then((r) => handle<T>(r));
const send = <T>(method: string, url: string, body?: unknown) =>
  fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => handle<T>(r));

export interface OpsResult {
  project: Project;
  results: unknown[];
  history: HistoryInfo;
}

export const api = {
  system: () => get<SystemInfo>('/api/system'),
  projects: () => get<ProjectSummary[]>('/api/projects'),
  createProject: (body: { name: string; format?: 'long' | 'short'; mode?: string; topic?: string; demo?: boolean }) => send<Project>('POST', '/api/projects', body),
  project: (id: string) => get<{ project: Project; history: HistoryInfo }>(`/api/projects/${id}`),
  deleteProject: (id: string) => send('DELETE', `/api/projects/${id}`),
  duplicateProject: (id: string) => send<Project>('POST', `/api/projects/${id}/duplicate`),
  ops: (id: string, ops: EditOp[], label?: string) => send<OpsResult>('POST', `/api/projects/${id}/ops`, { ops, label }),
  undo: (id: string) => send<{ ok: boolean; label: string | null; project: Project; history: HistoryInfo }>('POST', `/api/projects/${id}/undo`),
  redo: (id: string) => send<{ ok: boolean; label: string | null; project: Project; history: HistoryInfo }>('POST', `/api/projects/${id}/redo`),
  transcripts: (id: string) => get<Record<string, Word[]>>(`/api/projects/${id}/transcripts`),
  lint: (id: string) => get<{ warnings: string[] }>(`/api/projects/${id}/lint`),

  upload: (id: string, files: File[], onProgress?: (p: number) => void) =>
    new Promise<{ assets: Project['assets'] }>((resolve, reject) => {
      const form = new FormData();
      for (const f of files) form.append('file', f, f.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/projects/${id}/assets`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status >= 400) reject(new Error(body.error ?? 'Upload failed'));
          else resolve(body);
        } catch {
          reject(new Error('Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed (network)'));
      xhr.send(form);
    }),
  importUrl: (id: string, url: string) => send('POST', `/api/projects/${id}/assets/import-url`, { url }),
  addLibrarySound: (id: string, soundId: string) => send<Project['assets'][number]>('POST', `/api/projects/${id}/assets/library`, { soundId }),
  deleteAsset: (id: string, assetId: string) => send('DELETE', `/api/projects/${id}/assets/${assetId}`),
  transcribe: (id: string, assetId: string) => send('POST', `/api/projects/${id}/assets/${assetId}/transcribe`, {}),
  transcript: (id: string, assetId: string) => get<Word[]>(`/api/projects/${id}/assets/${assetId}/transcript`),
  saveTranscript: (id: string, assetId: string, words: Word[]) => send('PUT', `/api/projects/${id}/assets/${assetId}/transcript`, { words }),

  render: (id: string, body: { preset?: string; range?: [number, number] }) => send<RenderRecord>('POST', `/api/projects/${id}/render`, body),
  cancelRender: (id: string, renderId: string) => send('POST', `/api/projects/${id}/render/${renderId}/cancel`),
  deleteRender: (id: string, renderId: string) => send('DELETE', `/api/projects/${id}/render/${renderId}`),
  renderPresets: () => get<{ id: string; label: string }[]>('/api/render-presets'),
  thumbnail: (id: string) => send<{ url: string }>('POST', `/api/projects/${id}/thumbnail`),

  chat: (id: string) => get<ChatSnapshot>(`/api/projects/${id}/chat`),
  sendChat: (id: string, text: string, attachments: string[] = []) => send('POST', `/api/projects/${id}/chat`, { text, attachments }),
  answer: (id: string, messageId: string, answers: AnswerItem[]) => send('POST', `/api/projects/${id}/chat/answer`, { messageId, answers }),
  approve: (id: string, messageId: string, approved: boolean) => send('POST', `/api/projects/${id}/chat/approve`, { messageId, approved }),
  stop: (id: string) => send('POST', `/api/projects/${id}/chat/stop`),
  resetChat: (id: string) => send('DELETE', `/api/projects/${id}/chat`),

  settings: () => get<{ saved: any; effective: any }>('/api/settings'),
  saveSettings: (body: unknown) => send<{ saved: any; effective: any }>('PUT', '/api/settings', body),
  models: (provider: unknown) => send<{ models: string[] }>('POST', '/api/settings/models', { provider }),
  testLlm: (provider: unknown, model: string) => send<{ ok: boolean; reply?: string; error?: string; latencyMs: number; vision?: boolean }>('POST', '/api/settings/test-llm', { provider, model }),
  voices: () => get<{ engine: string; label: string; default: string; voices: { id: string; name: string; description?: string; gender?: string; accent?: string; preview?: string }[] }[]>('/api/voices'),
  templates: () => get<TemplateInfo[]>('/api/templates'),
  library: () => get<LibrarySound[]>('/api/library'),
  mcpStatus: () => get<{ sessions: number; external: { name: string; status: string; error?: string; tools: string[] }[] }>('/api/mcp/status'),
  skills: () => get<{ name: string; description: string; source: string }[]>('/api/agent/skills'),

  youtubeStatus: () => get<{ hasClient: boolean; connected: boolean; channelTitle: string }>('/api/youtube/status'),
  youtubeDisconnect: () => send('POST', '/api/youtube/disconnect'),
  youtubeUpload: (id: string, body: { renderId: string; privacy: string; publishAt?: string }) => send('POST', `/api/projects/${id}/youtube/upload`, body),
};

export const mediaUrl = (projectId: string, file: string) => `/media/${projectId}/${encodeURIComponent(file)}`;

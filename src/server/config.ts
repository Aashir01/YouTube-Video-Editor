import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const APP_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const DATA_DIR = path.resolve(process.env.DIRECTOR_DATA_DIR ?? path.join(APP_ROOT, 'data'));
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const LIBRARY_DIR = path.join(DATA_DIR, 'library');
export const USER_SKILLS_DIR = path.join(DATA_DIR, 'skills');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

for (const dir of [DATA_DIR, PROJECTS_DIR, CACHE_DIR, LIBRARY_DIR, USER_SKILLS_DIR]) fs.mkdirSync(dir, { recursive: true });

// Load a local .env if present (Node >= 20.12 has a built-in parser).
try {
  const envFile = path.join(APP_ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
} catch {
  /* ignore malformed .env */
}

export const PROVIDER_TYPES = ['openai-compatible', 'gemini', 'anthropic'] as const;

export const ProviderSchema = z.object({
  id: z.string().min(1),
  type: z.enum(PROVIDER_TYPES),
  name: z.string().min(1),
  baseUrl: z.string().optional(),
  apiKey: z.string().default(''),
  models: z.array(z.string()).default([]),
  headers: z.record(z.string(), z.string()).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderSchema>;

export const ModelRefSchema = z.object({ providerId: z.string(), model: z.string() });
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const McpServerSchema = z.union([
  z.object({ command: z.string(), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).optional(), disabled: z.boolean().optional() }),
  z.object({ url: z.string(), headers: z.record(z.string(), z.string()).optional(), disabled: z.boolean().optional() }),
]);
export type McpServerConfig = z.infer<typeof McpServerSchema>;

export const TRANSCRIPTION_ENGINES = ['auto', 'local', 'whisper-cpp', 'openai', 'groq', 'elevenlabs'] as const;
export const TTS_ENGINES = ['auto', 'elevenlabs', 'openai', 'gemini', 'kokoro', 'system'] as const;

const LlmSettingsSchema = z.object({
  providers: z.array(ProviderSchema).default([]),
  main: ModelRefSchema.optional(),
  fast: ModelRefSchema.optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  maxOutputTokens: z.number().int().min(1024).max(128000).default(16000),
  temperature: z.number().min(0).max(2).optional(),
  claudeFallbacks: z.boolean().default(true),
});

const SpeechSettingsSchema = z.object({
  transcription: z.enum(TRANSCRIPTION_ENGINES).default('auto'),
  localWhisperModel: z.string().default('onnx-community/whisper-base_timestamped'),
  whisperCppModel: z.string().default('base.en'),
  openaiTranscribeModel: z.string().default('whisper-1'),
  groqTranscribeModel: z.string().default('whisper-large-v3-turbo'),
  autoTranscribe: z.boolean().default(true),
  tts: z.enum(TTS_ENGINES).default('auto'),
  elevenVoiceId: z.string().default('JBFqnCBsd6RMkjVDRZzb'),
  elevenModel: z.string().default('eleven_multilingual_v2'),
  openaiVoice: z.string().default('alloy'),
  openaiTtsModel: z.string().default('gpt-4o-mini-tts'),
  geminiVoice: z.string().default('Kore'),
  geminiTtsModel: z.string().default('gemini-2.5-flash-preview-tts'),
  kokoroVoice: z.string().default('af_heart'),
  language: z.string().default('en'),
});

const KeysSchema = z.object({
  openai: z.string().optional(),
  gemini: z.string().optional(),
  elevenlabs: z.string().optional(),
  groq: z.string().optional(),
  pexels: z.string().optional(),
  pixabay: z.string().optional(),
  tavily: z.string().optional(),
  brave: z.string().optional(),
});

const ImageSettingsSchema = z.object({
  engine: z.enum(['auto', 'openai', 'gemini', 'none']).default('auto'),
  openaiModel: z.string().default('gpt-image-1'),
  geminiModel: z.string().default('gemini-2.5-flash-image'),
});

const RenderSettingsSchema = z.object({
  quality: z.enum(['draft', 'standard', 'high']).default('standard'),
  concurrency: z.number().int().min(1).max(32).optional(),
  browserExecutable: z.string().default(''),
});

const AgentSettingsSchema = z.object({
  autonomy: z.enum(['auto', 'confirm-costly']).default('confirm-costly'),
  maxSteps: z.number().int().min(5).max(400).default(120),
  visualQa: z.boolean().default(true),
});

const YouTubeSettingsSchema = z.object({
  clientId: z.string().default(''),
  clientSecret: z.string().default(''),
  refreshToken: z.string().default(''),
  channelTitle: z.string().default(''),
});

export const SettingsSchema = z.object({
  llm: LlmSettingsSchema.default(() => LlmSettingsSchema.parse({})),
  speech: SpeechSettingsSchema.default(() => SpeechSettingsSchema.parse({})),
  keys: KeysSchema.default({}),
  images: ImageSettingsSchema.default(() => ImageSettingsSchema.parse({})),
  render: RenderSettingsSchema.default(() => RenderSettingsSchema.parse({})),
  agent: AgentSettingsSchema.default(() => AgentSettingsSchema.parse({})),
  mcpServers: z.record(z.string(), McpServerSchema).default({}),
  youtube: YouTubeSettingsSchema.default(() => YouTubeSettingsSchema.parse({})),
});
export type Settings = z.infer<typeof SettingsSchema>;

const parseSettings = (raw: unknown): Settings => {
  const r = SettingsSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  console.warn('[settings] invalid settings.json, using defaults:', r.error.issues.map((i) => i.path.join('.')).join(', '));
  return SettingsSchema.parse({});
};

let current: Settings = (() => {
  try {
    return parseSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return parseSettings({});
  }
})();

export const getSavedSettings = (): Settings => current;

export const saveSettings = (next: Settings): Settings => {
  current = parseSettings(next);
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_FILE);
  return current;
};

// ---------------------------------------------------------------------------
// Environment fallbacks: keys in .env / the shell work without opening Settings
// ---------------------------------------------------------------------------

const env = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
};

const ENV_PROVIDERS: { id: string; type: ProviderConfig['type']; name: string; baseUrl?: string; keyEnv: string[]; model: string; fast: string }[] = [
  { id: 'env-anthropic', type: 'anthropic', name: 'Anthropic (env)', keyEnv: ['ANTHROPIC_API_KEY'], model: 'claude-opus-5-5', fast: 'claude-haiku-5-5' },
  { id: 'env-openai', type: 'openai-compatible', name: 'OpenAI (env)', baseUrl: 'https://api.openai.com/v1', keyEnv: ['OPENAI_API_KEY'], model: 'gpt-5', fast: 'gpt-5-mini' },
  { id: 'env-gemini', type: 'gemini', name: 'Google Gemini (env)', keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], model: 'gemini-2.5-pro', fast: 'gemini-2.5-flash' },
  { id: 'env-openrouter', type: 'openai-compatible', name: 'OpenRouter (env)', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: ['OPENROUTER_API_KEY'], model: 'anthropic/claude-sonnet-4.5', fast: 'google/gemini-2.5-flash' },
];

/** Settings plus anything configured through environment variables. */
export const getSettings = (): Settings => {
  const s: Settings = structuredClone(current);
  for (const p of ENV_PROVIDERS) {
    const key = env(...p.keyEnv);
    if (!key || s.llm.providers.some((x) => x.type === p.type && (x.baseUrl ?? '') === (p.baseUrl ?? '') && x.apiKey)) continue;
    s.llm.providers.push({ id: p.id, type: p.type, name: p.name, baseUrl: p.baseUrl, apiKey: key, models: [p.model, p.fast] });
    if (!s.llm.main) s.llm.main = { providerId: p.id, model: env('DIRECTOR_MODEL') ?? p.model };
    if (!s.llm.fast) s.llm.fast = { providerId: p.id, model: env('DIRECTOR_FAST_MODEL') ?? p.fast };
  }
  const k = s.keys;
  k.openai ||= env('OPENAI_API_KEY');
  k.gemini ||= env('GEMINI_API_KEY', 'GOOGLE_API_KEY');
  k.elevenlabs ||= env('ELEVENLABS_API_KEY', 'ELEVEN_API_KEY');
  k.groq ||= env('GROQ_API_KEY');
  k.pexels ||= env('PEXELS_API_KEY');
  k.pixabay ||= env('PIXABAY_API_KEY');
  k.tavily ||= env('TAVILY_API_KEY');
  k.brave ||= env('BRAVE_API_KEY', 'BRAVE_SEARCH_API_KEY');
  // a provider's own key doubles as the service key (e.g. OpenAI TTS/Whisper, Gemini TTS/images)
  for (const p of s.llm.providers) {
    if (!p.apiKey) continue;
    if (p.type === 'gemini') k.gemini ||= p.apiKey;
    if (p.type === 'openai-compatible' && (p.baseUrl ?? '').includes('api.openai.com')) k.openai ||= p.apiKey;
    if (p.type === 'openai-compatible' && (p.baseUrl ?? '').includes('api.groq.com')) k.groq ||= p.apiKey;
  }
  if (env('DIRECTOR_BROWSER')) s.render.browserExecutable ||= env('DIRECTOR_BROWSER')!;
  return s;
};

// ---------------------------------------------------------------------------
// Masking for the UI (keys never leave the server in full)
// ---------------------------------------------------------------------------

export const MASK = '••••';
export const maskKey = (v: string | undefined): string => (v ? `${MASK}${v.slice(-4)}` : '');
const isMasked = (v: unknown): boolean => typeof v === 'string' && v.startsWith(MASK);

export const maskedSettings = (s: Settings) => {
  const m = structuredClone(s);
  for (const p of m.llm.providers) p.apiKey = maskKey(p.apiKey);
  for (const k of Object.keys(m.keys) as (keyof Settings['keys'])[]) m.keys[k] = maskKey(m.keys[k]);
  m.youtube.clientSecret = maskKey(m.youtube.clientSecret);
  m.youtube.refreshToken = m.youtube.refreshToken ? MASK : '';
  for (const srv of Object.values(m.mcpServers)) {
    if ('env' in srv && srv.env) for (const key of Object.keys(srv.env)) srv.env[key] = maskKey(srv.env[key]);
    if ('headers' in srv && srv.headers) for (const key of Object.keys(srv.headers)) srv.headers[key] = maskKey(srv.headers[key]);
  }
  return m;
};

/** Merge an update from the UI, keeping existing secrets where the UI sent masked values. */
export const mergeSettingsUpdate = (prev: Settings, update: Partial<Settings>): Settings => {
  const next = { ...structuredClone(prev), ...structuredClone(update) } as Settings;
  if (update.llm) {
    next.llm = { ...prev.llm, ...update.llm };
    next.llm.providers = (update.llm.providers ?? prev.llm.providers).map((p) => {
      const old = prev.llm.providers.find((x) => x.id === p.id);
      return { ...p, apiKey: isMasked(p.apiKey) ? old?.apiKey ?? '' : p.apiKey };
    });
  }
  if (update.keys) {
    next.keys = { ...prev.keys };
    for (const [k, v] of Object.entries(update.keys) as [keyof Settings['keys'], string | undefined][]) {
      if (isMasked(v)) continue;
      next.keys[k] = v || undefined;
    }
  }
  if (update.youtube) {
    next.youtube = { ...prev.youtube, ...update.youtube };
    if (isMasked(update.youtube.clientSecret)) next.youtube.clientSecret = prev.youtube.clientSecret;
    if (isMasked(update.youtube.refreshToken)) next.youtube.refreshToken = prev.youtube.refreshToken;
  }
  if (update.mcpServers) {
    for (const [name, srv] of Object.entries(next.mcpServers)) {
      const old = prev.mcpServers[name];
      if (!old) continue;
      if ('env' in srv && srv.env && 'env' in old && old.env) for (const [k, v] of Object.entries(srv.env)) if (isMasked(v)) srv.env[k] = old.env[k] ?? '';
      if ('headers' in srv && srv.headers && 'headers' in old && old.headers) for (const [k, v] of Object.entries(srv.headers)) if (isMasked(v)) srv.headers[k] = old.headers[k] ?? '';
    }
  }
  return next;
};

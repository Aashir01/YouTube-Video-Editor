import React, { useEffect, useMemo, useState } from 'react';
import { Dialog } from 'radix-ui';
import { toast } from 'sonner';
import { Bot, Brain, Check, CircleCheck, CircleX, Clapperboard, Copy, ExternalLink, KeyRound, Mic, Plug, Plus, RefreshCw, Trash2, X, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import { useStudio, type SettingsSection } from '../../lib/store';
import { cn, copyText, errorText } from '../../lib/utils';
import { YouTubeIcon } from '../icons';
import { Badge, Field, NumberField, SelectField, Spinner, Switch } from '../ui';

// The settings document as the server returns it (keys masked as "••••abcd").
type Provider = { id: string; type: 'openai-compatible' | 'gemini' | 'anthropic'; name: string; baseUrl?: string; apiKey: string; models: string[] };
type ModelRef = { providerId: string; model: string };
interface Settings {
  llm: { providers: Provider[]; main?: ModelRef; fast?: ModelRef; effort?: string; maxOutputTokens: number; temperature?: number; claudeFallbacks: boolean };
  speech: Record<string, string | boolean>;
  keys: Record<string, string | undefined>;
  images: { engine: string; openaiModel: string; geminiModel: string };
  render: { quality: string; concurrency?: number; browserExecutable: string };
  agent: { autonomy: string; maxSteps: number; visualQa: boolean };
  mcpServers: Record<string, unknown>;
  youtube: { clientId: string; clientSecret: string; refreshToken: string; channelTitle: string };
}

const PRESETS: { key: string; label: string; hint: string; provider: Omit<Provider, 'id' | 'apiKey'>; keyUrl?: string; noKey?: boolean }[] = [
  { key: 'openai', label: 'OpenAI', hint: 'GPT models', provider: { type: 'openai-compatible', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5', 'gpt-5-mini'] }, keyUrl: 'https://platform.openai.com/api-keys' },
  { key: 'gemini', label: 'Google Gemini', hint: 'Gemini 2.5 Pro/Flash', provider: { type: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] }, keyUrl: 'https://aistudio.google.com/apikey' },
  { key: 'anthropic', label: 'Anthropic Claude', hint: 'Claude Opus/Sonnet/Haiku', provider: { type: 'anthropic', name: 'Anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] }, keyUrl: 'https://console.anthropic.com/settings/keys' },
  { key: 'openrouter', label: 'OpenRouter', hint: 'Hundreds of models, one key', provider: { type: 'openai-compatible', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro', 'openai/gpt-5'] }, keyUrl: 'https://openrouter.ai/keys' },
  { key: 'groq', label: 'Groq', hint: 'Very fast open models', provider: { type: 'openai-compatible', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', models: ['moonshotai/kimi-k2-instruct', 'llama-3.3-70b-versatile'] }, keyUrl: 'https://console.groq.com/keys' },
  { key: 'deepseek', label: 'DeepSeek', hint: 'DeepSeek V3 / R1', provider: { type: 'openai-compatible', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] }, keyUrl: 'https://platform.deepseek.com/api_keys' },
  { key: 'mistral', label: 'Mistral', hint: 'Mistral Large', provider: { type: 'openai-compatible', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-medium-latest'] }, keyUrl: 'https://console.mistral.ai/api-keys' },
  { key: 'xai', label: 'xAI Grok', hint: 'Grok models', provider: { type: 'openai-compatible', name: 'xAI', baseUrl: 'https://api.x.ai/v1', models: ['grok-4', 'grok-4-fast'] }, keyUrl: 'https://console.x.ai' },
  { key: 'together', label: 'Together AI', hint: 'Open models', provider: { type: 'openai-compatible', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', models: [] }, keyUrl: 'https://api.together.ai/settings/api-keys' },
  { key: 'ollama', label: 'Ollama (local)', hint: 'Free, runs on your machine', provider: { type: 'openai-compatible', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', models: [] }, noKey: true },
  { key: 'lmstudio', label: 'LM Studio (local)', hint: 'Free, runs on your machine', provider: { type: 'openai-compatible', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', models: [] }, noKey: true },
  { key: 'custom', label: 'Custom endpoint', hint: 'Any OpenAI-compatible API', provider: { type: 'openai-compatible', name: 'Custom', baseUrl: '', models: [] } },
];

const NAV: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
  { id: 'models', label: 'AI models', icon: Brain },
  { id: 'speech', label: 'Voice & speech', icon: Mic },
  { id: 'media', label: 'Media & search keys', icon: KeyRound },
  { id: 'agent', label: 'Director agent', icon: Bot },
  { id: 'render', label: 'Rendering', icon: Clapperboard },
  { id: 'mcp', label: 'MCP & integrations', icon: Plug },
  { id: 'youtube', label: 'YouTube', icon: YouTubeIcon },
];

const isMasked = (v: string | undefined) => Boolean(v?.startsWith('••••'));

/** Password-style key input that keeps the masked value unless the user types a new key. */
const KeyInput: React.FC<{ value: string | undefined; onChange: (v: string) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => {
  const [editing, setEditing] = useState(false);
  if (isMasked(value) && !editing) {
    return (
      <div className="flex items-center gap-2">
        <div className="field flex-1 font-mono text-xs text-muted">{value}</div>
        <button className="btn btn-sm" onClick={() => setEditing(true)}>
          Change
        </button>
        <button className="btn btn-sm btn-ghost text-dim hover:text-danger" title="Remove key" onClick={() => onChange('')}>
          <X className="size-3.5" />
        </button>
      </div>
    );
  }
  return <input type="password" autoComplete="off" spellCheck={false} className="field font-mono text-xs" value={isMasked(value) ? '' : (value ?? '')} placeholder={placeholder ?? 'Paste API key'} onChange={(e) => onChange(e.target.value)} />;
};

const H: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-4">
    <h3 className="text-base font-bold">{title}</h3>
    {children && <p className="mt-1 text-xs leading-relaxed text-muted">{children}</p>}
  </div>
);

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => <div className={cn('rounded-xl border border-line bg-panel-2 p-4', className)}>{children}</div>;

// ---------------------------------------------------------------------------
// AI models
// ---------------------------------------------------------------------------

const ProviderCard: React.FC<{ p: Provider; readOnly?: boolean; onChange: (p: Provider) => void; onRemove: () => void }> = ({ p, readOnly, onChange, onRemove }) => {
  const [fetching, setFetching] = useState(false);
  const [testModel, setTestModel] = useState(p.models[0] ?? '');
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const preset = PRESETS.find((x) => x.provider.baseUrl === p.baseUrl && x.provider.type === p.type) ?? PRESETS.find((x) => x.provider.type === p.type && x.provider.type !== 'openai-compatible');

  const fetchModels = async () => {
    setFetching(true);
    try {
      const { models } = await api.models(p);
      if (!models.length) toast.info('The provider returned no models; type model names manually.');
      else {
        onChange({ ...p, models: [...new Set([...p.models, ...models])].slice(0, 400) });
        toast.success(`Found ${models.length} models`);
      }
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setFetching(false);
    }
  };
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.testLlm(p, testModel);
      setTest(r.ok ? { ok: true, text: `Works (${(r.latencyMs / 1000).toFixed(1)}s${r.vision === false ? ', no image input' : ''}): “${(r.reply ?? '').slice(0, 80)}”` } : { ok: false, text: r.error ?? 'Failed' });
    } catch (err) {
      setTest({ ok: false, text: errorText(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <span className="font-semibold">{p.name}</span>
        <Badge>{p.type}</Badge>
        {readOnly && <Badge tone="accent">from environment</Badge>}
        <span className="flex-1" />
        {!readOnly && (
          <button className="btn btn-sm btn-ghost text-dim hover:text-danger" onClick={onRemove}>
            <Trash2 className="size-3.5" /> Remove
          </button>
        )}
      </div>
      <div className={cn('grid gap-3', readOnly && 'pointer-events-none opacity-70')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className="field" value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} />
          </Field>
          {p.type === 'openai-compatible' ? (
            <Field label="Base URL">
              <input className="field font-mono text-xs" value={p.baseUrl ?? ''} placeholder="https://…/v1" onChange={(e) => onChange({ ...p, baseUrl: e.target.value })} />
            </Field>
          ) : (
            <Field label="Base URL (optional)">
              <input className="field font-mono text-xs" value={p.baseUrl ?? ''} placeholder="default" onChange={(e) => onChange({ ...p, baseUrl: e.target.value || undefined })} />
            </Field>
          )}
        </div>
        <Field
          label="API key"
          hint={
            preset?.keyUrl ? (
              <a className="text-accent-2 hover:underline" href={preset.keyUrl} target="_blank" rel="noreferrer">
                Get a key <ExternalLink className="inline size-3" />
              </a>
            ) : preset?.noKey ? (
              'Local servers usually need no key.'
            ) : undefined
          }
        >
          <KeyInput value={p.apiKey} onChange={(v) => onChange({ ...p, apiKey: v })} />
        </Field>
        <Field label="Models" hint="Comma separated. Fetch the list from the provider, or type names.">
          <div className="flex gap-2">
            <input className="field font-mono text-xs" value={p.models.join(', ')} onChange={(e) => onChange({ ...p, models: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            <button className="btn btn-sm shrink-0" onClick={() => void fetchModels()} disabled={fetching}>
              {fetching ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />} Fetch
            </button>
          </div>
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <input className="field max-w-56 py-1 font-mono text-xs" list={`models-${p.id}`} value={testModel} onChange={(e) => setTestModel(e.target.value)} placeholder="model to test" />
        <datalist id={`models-${p.id}`}>
          {p.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <button className="btn btn-sm" onClick={() => void runTest()} disabled={testing || !testModel}>
          {testing ? <Spinner className="size-3.5" /> : <Zap className="size-3.5" />} Test
        </button>
        {test && (
          <span className={cn('min-w-0 flex-1 truncate text-[11px]', test.ok ? 'text-ok' : 'text-danger')} title={test.text}>
            {test.ok ? <CircleCheck className="mr-1 inline size-3.5" /> : <CircleX className="mr-1 inline size-3.5" />}
            {test.text}
          </span>
        )}
      </div>
    </Card>
  );
};

const ModelPicker: React.FC<{ label: string; hint: string; value: ModelRef | undefined; providers: Provider[]; onChange: (v: ModelRef | undefined) => void }> = ({ label, hint, value, providers, onChange }) => {
  const prov = providers.find((p) => p.id === value?.providerId);
  return (
    <Field label={label} hint={hint}>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <SelectField
          value={value?.providerId ?? ''}
          placeholder="Choose provider"
          options={providers.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => {
            const p = providers.find((x) => x.id === id);
            onChange(p ? { providerId: id, model: p.models[0] ?? '' } : undefined);
          }}
        />
        <input className="field font-mono text-xs" list={`pick-${label}`} value={value?.model ?? ''} disabled={!value} placeholder="model id" onChange={(e) => value && onChange({ ...value, model: e.target.value })} />
        <datalist id={`pick-${label}`}>
          {(prov?.models ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
    </Field>
  );
};

const ModelsSection: React.FC<{ s: Settings; eff: Settings; set: (s: Settings) => void }> = ({ s, eff, set }) => {
  const envProviders = eff.llm.providers.filter((p) => p.id.startsWith('env-') && !s.llm.providers.some((x) => x.id === p.id));
  const all = [...s.llm.providers, ...envProviders];
  const setLlm = (patch: Partial<Settings['llm']>) => set({ ...s, llm: { ...s.llm, ...patch } });
  const add = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key)!;
    const id = `${key}-${Math.random().toString(36).slice(2, 7)}`;
    const p: Provider = { ...structuredClone(preset.provider), id, apiKey: preset.noKey ? key : '' };
    const providers = [...s.llm.providers, p];
    setLlm({
      providers,
      main: s.llm.main && all.some((x) => x.id === s.llm.main!.providerId) ? s.llm.main : { providerId: id, model: p.models[0] ?? '' },
      fast: s.llm.fast && all.some((x) => x.id === s.llm.fast!.providerId) ? s.llm.fast : { providerId: id, model: p.models[1] ?? p.models[0] ?? '' },
    });
  };
  return (
    <div className="flex flex-col gap-5">
      <H title="AI models">
        The Director works with any modern LLM that supports tool calling. Bring your own key — it stays on this computer (data/settings.json). Vision-capable models (GPT‑5, Gemini 2.5, Claude) can also look at your footage and preview frames.
      </H>
      <Card className="grid gap-4">
        <ModelPicker label="Main model" hint="Runs the Director: planning, editing, writing. Use the strongest model you have." value={s.llm.main ?? eff.llm.main} providers={all} onChange={(v) => setLlm({ main: v })} />
        <ModelPicker label="Fast model" hint="Cheap, quick helper for summaries and small tasks." value={s.llm.fast ?? eff.llm.fast} providers={all} onChange={(v) => setLlm({ fast: v })} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Reasoning effort">
            <SelectField value={s.llm.effort ?? ''} placeholder="Model default" options={['low', 'medium', 'high', 'xhigh', 'max']} onChange={(v) => setLlm({ effort: v || undefined })} />
          </Field>
          <Field label="Max output tokens">
            <NumberField value={s.llm.maxOutputTokens} min={1024} max={128000} step={1000} precision={0} onChange={(v) => setLlm({ maxOutputTokens: Math.round(v) })} />
          </Field>
          <Field label="Temperature">
            <NumberField value={s.llm.temperature} placeholder="default" min={0} max={2} step={0.1} precision={1} onChange={(v) => setLlm({ temperature: v })} />
          </Field>
        </div>
      </Card>
      <div className="flex flex-col gap-3">
        {all.map((p) => {
          const env = envProviders.includes(p);
          return (
            <ProviderCard
              key={p.id}
              p={p}
              readOnly={env}
              onChange={(next) => setLlm({ providers: s.llm.providers.map((x) => (x.id === p.id ? next : x)) })}
              onRemove={() =>
                setLlm({
                  providers: s.llm.providers.filter((x) => x.id !== p.id),
                  main: s.llm.main?.providerId === p.id ? undefined : s.llm.main,
                  fast: s.llm.fast?.providerId === p.id ? undefined : s.llm.fast,
                })
              }
            />
          );
        })}
      </div>
      <div>
        <div className="label">Add a provider</div>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => add(p.key)} className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-left transition-colors hover:border-accent/60">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Plus className="size-3.5 text-accent" /> {p.label}
              </div>
              <div className="text-[11px] text-dim">{p.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Speech, keys, agent, render, MCP, YouTube
// ---------------------------------------------------------------------------

const SpeechSection: React.FC<{ s: Settings; set: (s: Settings) => void }> = ({ s, set }) => {
  const system = useStudio((st) => st.system);
  const sp = s.speech;
  const setSp = (patch: Record<string, unknown>) => set({ ...s, speech: { ...sp, ...patch } as Settings['speech'] });
  const setKey = (k: string, v: string) => set({ ...s, keys: { ...s.keys, [k]: v } });
  return (
    <div className="flex flex-col gap-5">
      <H title="Voice & speech">Transcription powers captions, jump cuts and footage search. Voice engines create AI narration with word timings. Everything falls back gracefully: with no keys, local Whisper and Kokoro run free on your machine.</H>
      <Card className="grid gap-3">
        <div className="text-sm font-semibold">Transcription</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Engine" hint={`Active now: ${system?.transcription ?? 'none'}`}>
            <SelectField
              value={String(sp.transcription)}
              onChange={(v) => setSp({ transcription: v })}
              options={[
                { value: 'auto', label: 'Automatic (best available)' },
                { value: 'groq', label: 'Groq Whisper (fast, cheap)' },
                { value: 'openai', label: 'OpenAI Whisper' },
                { value: 'elevenlabs', label: 'ElevenLabs Scribe' },
                { value: 'whisper-cpp', label: 'whisper.cpp (local)' },
                { value: 'local', label: 'Transformers.js Whisper (local)' },
              ]}
            />
          </Field>
          <Field label="Language">
            <input className="field" value={String(sp.language)} onChange={(e) => setSp({ language: e.target.value })} placeholder="en" />
          </Field>
        </div>
        <Switch label="Transcribe new footage automatically" checked={Boolean(sp.autoTranscribe)} onChange={(v) => setSp({ autoTranscribe: v })} />
        <Field label="Groq API key" hint="Free tier available — the fastest way to get accurate word timings.">
          <KeyInput value={s.keys.groq} onChange={(v) => setKey('groq', v)} />
        </Field>
      </Card>
      <Card className="grid gap-3">
        <div className="text-sm font-semibold">AI voice</div>
        <Field label="Engine" hint={`Active now: ${system?.tts ?? 'none'}${system?.kokoro ? ' · Kokoro installed' : ''}`}>
          <SelectField
            value={String(sp.tts)}
            onChange={(v) => setSp({ tts: v })}
            options={[
              { value: 'auto', label: 'Automatic (best available)' },
              { value: 'elevenlabs', label: 'ElevenLabs (most natural)' },
              { value: 'openai', label: 'OpenAI TTS' },
              { value: 'gemini', label: 'Gemini TTS' },
              { value: 'kokoro', label: 'Kokoro (free, local)' },
              { value: 'system', label: 'System voice (basic)' },
            ]}
          />
        </Field>
        <Field label="ElevenLabs API key">
          <KeyInput value={s.keys.elevenlabs} onChange={(v) => setKey('elevenlabs', v)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ElevenLabs voice id">
            <input className="field font-mono text-xs" value={String(sp.elevenVoiceId)} onChange={(e) => setSp({ elevenVoiceId: e.target.value })} />
          </Field>
          <Field label="ElevenLabs model">
            <input className="field font-mono text-xs" value={String(sp.elevenModel)} onChange={(e) => setSp({ elevenModel: e.target.value })} />
          </Field>
          <Field label="OpenAI voice">
            <input className="field font-mono text-xs" value={String(sp.openaiVoice)} onChange={(e) => setSp({ openaiVoice: e.target.value })} />
          </Field>
          <Field label="Gemini voice">
            <input className="field font-mono text-xs" value={String(sp.geminiVoice)} onChange={(e) => setSp({ geminiVoice: e.target.value })} />
          </Field>
          <Field label="Kokoro voice">
            <input className="field font-mono text-xs" value={String(sp.kokoroVoice)} onChange={(e) => setSp({ kokoroVoice: e.target.value })} />
          </Field>
        </div>
      </Card>
    </div>
  );
};

const KEY_ROWS: { key: string; label: string; hint: string; url: string }[] = [
  { key: 'openai', label: 'OpenAI', hint: 'AI images (gpt-image), TTS and Whisper. Reuses your OpenAI model key if set.', url: 'https://platform.openai.com/api-keys' },
  { key: 'gemini', label: 'Google Gemini', hint: 'AI images and TTS. Reuses your Gemini model key if set.', url: 'https://aistudio.google.com/apikey' },
  { key: 'pexels', label: 'Pexels', hint: 'Free stock videos & photos.', url: 'https://www.pexels.com/api/' },
  { key: 'pixabay', label: 'Pixabay', hint: 'Free stock videos & photos.', url: 'https://pixabay.com/api/docs/' },
  { key: 'tavily', label: 'Tavily', hint: 'Web research (best quality). DuckDuckGo is used without a key.', url: 'https://app.tavily.com' },
  { key: 'brave', label: 'Brave Search', hint: 'Web research alternative.', url: 'https://brave.com/search/api/' },
];

const MediaSection: React.FC<{ s: Settings; set: (s: Settings) => void }> = ({ s, set }) => (
  <div className="flex flex-col gap-5">
    <H title="Media & search keys">Optional services that make videos richer. Openverse images and DuckDuckGo search work without keys.</H>
    <Card className="grid gap-4">
      {KEY_ROWS.map((r) => (
        <Field
          key={r.key}
          label={r.label}
          hint={
            <>
              {r.hint}{' '}
              <a className="text-accent-2 hover:underline" href={r.url} target="_blank" rel="noreferrer">
                Get a key
              </a>
            </>
          }
        >
          <KeyInput value={s.keys[r.key]} onChange={(v) => set({ ...s, keys: { ...s.keys, [r.key]: v } })} />
        </Field>
      ))}
    </Card>
    <Card className="grid gap-3">
      <div className="text-sm font-semibold">AI images</div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Engine">
          <SelectField value={s.images.engine} onChange={(v) => set({ ...s, images: { ...s.images, engine: v } })} options={['auto', 'openai', 'gemini', 'none']} />
        </Field>
        <Field label="OpenAI model">
          <input className="field font-mono text-xs" value={s.images.openaiModel} onChange={(e) => set({ ...s, images: { ...s.images, openaiModel: e.target.value } })} />
        </Field>
        <Field label="Gemini model">
          <input className="field font-mono text-xs" value={s.images.geminiModel} onChange={(e) => set({ ...s, images: { ...s.images, geminiModel: e.target.value } })} />
        </Field>
      </div>
    </Card>
  </div>
);

const AgentSection: React.FC<{ s: Settings; set: (s: Settings) => void }> = ({ s, set }) => {
  const [skills, setSkills] = useState<{ name: string; description: string; source: string }[]>([]);
  const system = useStudio((st) => st.system);
  useEffect(() => {
    api.skills().then(setSkills).catch(() => undefined);
  }, []);
  return (
    <div className="flex flex-col gap-5">
      <H title="Director agent">How autonomously the Director works, and the playbooks (skills) it loads for each kind of task.</H>
      <Card className="grid gap-4">
        <Field label="Autonomy">
          <SelectField
            value={s.agent.autonomy}
            onChange={(v) => set({ ...s, agent: { ...s.agent, autonomy: v } })}
            options={[
              { value: 'confirm-costly', label: 'Ask before paid actions (AI voice, images) — recommended' },
              { value: 'auto', label: 'Fully autonomous (still asks before uploading to YouTube)' },
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max steps per request">
            <NumberField value={s.agent.maxSteps} min={5} max={400} step={5} precision={0} onChange={(v) => set({ ...s, agent: { ...s.agent, maxSteps: Math.round(v) } })} />
          </Field>
          <div className="flex items-end pb-1">
            <Switch label="Visual QA (look at rendered frames)" checked={s.agent.visualQa} onChange={(v) => set({ ...s, agent: { ...s.agent, visualQa: v } })} />
          </div>
        </div>
      </Card>
      <Card>
        <div className="mb-2 text-sm font-semibold">Skills ({skills.length})</div>
        <div className="flex flex-col divide-y divide-line">
          {skills.map((k) => (
            <div key={k.name} className="py-2">
              <div className="flex items-center gap-2 text-xs font-semibold">
                {k.name} <Badge tone={k.source === 'user' ? 'accent' : 'default'}>{k.source}</Badge>
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">{k.description}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-snug text-dim">
          Add your own playbooks as Markdown files (with a <code>description:</code> front-matter line) in <code className="text-muted">{system?.dataDir ?? 'data'}/skills</code> — e.g. your channel’s editing style.
        </p>
      </Card>
    </div>
  );
};

const RenderSection: React.FC<{ s: Settings; set: (s: Settings) => void }> = ({ s, set }) => {
  const system = useStudio((st) => st.system);
  return (
    <div className="flex flex-col gap-5">
      <H title="Rendering">Videos render locally with Remotion (headless Chromium) and FFmpeg.</H>
      <Card className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default quality for the Director">
            <SelectField value={s.render.quality} onChange={(v) => set({ ...s, render: { ...s.render, quality: v } })} options={['draft', 'standard', 'high']} />
          </Field>
          <Field label="Parallel frames" hint="Empty = automatic (half your CPU cores).">
            <NumberField value={s.render.concurrency} placeholder="auto" min={1} max={32} step={1} precision={0} onChange={(v) => set({ ...s, render: { ...s.render, concurrency: Math.round(v) } })} />
          </Field>
        </div>
        <Field label="Browser executable (optional)" hint="Use a local Chrome/Chromium instead of the one Remotion downloads.">
          <input className="field font-mono text-xs" value={s.render.browserExecutable} onChange={(e) => set({ ...s, render: { ...s.render, browserExecutable: e.target.value } })} placeholder="/path/to/chrome" />
        </Field>
      </Card>
      {system && (
        <Card className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-xs">
          <span className="text-dim">FFmpeg</span>
          <span className={system.ffmpeg.available ? 'text-text' : 'text-danger'}>
            {system.ffmpeg.available ? `${system.ffmpeg.source}${system.ffmpeg.full ? '' : ' (limited build — install FFmpeg for all features)'}` : `missing — ${system.ffmpeg.error ?? ''}`}
          </span>
          <span className="text-dim">Browser</span>
          <span className="truncate">{system.browser}</span>
          <span className="text-dim">Node.js</span>
          <span>{system.node}</span>
          <span className="text-dim">Platform</span>
          <span>{system.platform}</span>
          <span className="text-dim">Data folder</span>
          <span className="truncate font-mono">{system.dataDir}</span>
        </Card>
      )}
    </div>
  );
};

const CopyLine: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-start gap-2 rounded-lg border border-line bg-bg p-2">
    <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11px] text-muted">{text}</code>
    <button className="btn btn-sm btn-ghost btn-icon shrink-0" title="Copy" onClick={() => void copyText(text).then((ok) => ok && toast.success('Copied'))}>
      <Copy className="size-3.5" />
    </button>
  </div>
);

const McpSection: React.FC<{ s: Settings; set: (s: Settings) => void }> = ({ s, set }) => {
  const system = useStudio((st) => st.system);
  const [json, setJson] = useState(() => JSON.stringify(s.mcpServers, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.mcpStatus>> | null>(null);
  useEffect(() => {
    api.mcpStatus().then(setStatus).catch(() => undefined);
  }, []);
  const origin = window.location.origin;
  const root = system?.appRoot ?? '/path/to/director-studio';
  const desktop = JSON.stringify({ mcpServers: { 'director-studio': { command: 'node', args: [`${root}/bin/director.mjs`, 'mcp'] } } }, null, 2);
  return (
    <div className="flex flex-col gap-5">
      <H title="MCP & integrations">
        Director Studio is an MCP server: Claude Code, Claude Desktop, Cursor and other MCP clients can edit your projects with the same 40 tools the Director uses. It is also an MCP client: connect external servers and the Director gains their tools.
      </H>
      <Card className="grid gap-3">
        <div className="text-sm font-semibold">Use Director Studio from Claude Code</div>
        <CopyLine text={`claude mcp add --transport http director-studio ${origin}/mcp`} />
        <div className="text-sm font-semibold">Claude Desktop / Cursor (stdio)</div>
        <p className="-mt-2 text-[11px] text-dim">Add to the client’s MCP config. It connects to this running studio, or starts one if needed.</p>
        <CopyLine text={desktop} />
        {status && <p className="text-[11px] text-dim">Active MCP sessions: {status.sessions}</p>}
      </Card>
      <Card className="grid gap-3">
        <div className="text-sm font-semibold">External MCP servers for the Director</div>
        <p className="-mt-1 text-[11px] leading-snug text-dim">
          Same format as Claude Desktop’s <code>mcpServers</code>: <code>{'{ "name": { "command": "npx", "args": [...] } }'}</code> or <code>{'{ "name": { "url": "https://…/mcp" } }'}</code>. Tools appear to the Director as <code>mcp__name__tool</code>.
        </p>
        <textarea
          className="field min-h-40 font-mono text-xs"
          value={json}
          spellCheck={false}
          onChange={(e) => {
            setJson(e.target.value);
            try {
              const parsed = JSON.parse(e.target.value || '{}');
              if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Must be an object');
              setError(null);
              set({ ...s, mcpServers: parsed });
            } catch (err) {
              setError(errorText(err));
            }
          }}
        />
        {error && <p className="text-[11px] text-danger">{error}</p>}
        {status?.external.map((x) => (
          <div key={x.name} className="flex items-center gap-2 text-xs">
            {x.status === 'connected' ? <CircleCheck className="size-3.5 text-ok" /> : x.status === 'error' ? <CircleX className="size-3.5 text-danger" /> : <Spinner className="size-3.5" />}
            <span className="font-semibold">{x.name}</span>
            <span className="truncate text-dim">{x.status === 'connected' ? `${x.tools.length} tools` : (x.error ?? x.status)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
};

const YouTubeSection: React.FC<{ s: Settings; set: (s: Settings) => void; save: () => Promise<void> }> = ({ s, set, save }) => {
  const [status, setStatus] = useState<{ hasClient: boolean; connected: boolean; channelTitle: string } | null>(null);
  const refresh = () => api.youtubeStatus().then(setStatus).catch(() => undefined);
  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const yt = s.youtube;
  return (
    <div className="flex flex-col gap-5">
      <H title="YouTube">Upload finished videos with thumbnail, chapters and captions straight to your channel. Uses your own free Google API project, so nothing goes through anyone else’s servers.</H>
      <Card className="grid gap-3 text-xs leading-relaxed text-muted">
        <div className="text-sm font-semibold text-text">One-time setup (≈5 minutes)</div>
        <ol className="list-decimal space-y-1 pl-4">
          <li>
            In{' '}
            <a className="text-accent-2 hover:underline" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">
              Google Cloud Console
            </a>
            , create a project and enable <b>YouTube Data API v3</b>.
          </li>
          <li>OAuth consent screen: External, add your Google account as a test user.</li>
          <li>
            Credentials → Create OAuth client ID → Application type <b>Desktop app</b>. Paste the client id and secret below.
          </li>
          <li>Save, then click Connect and approve access for your channel.</li>
        </ol>
      </Card>
      <Card className="grid gap-3">
        <Field label="Client ID">
          <input className="field font-mono text-xs" value={yt.clientId} onChange={(e) => set({ ...s, youtube: { ...yt, clientId: e.target.value.trim() } })} placeholder="…apps.googleusercontent.com" />
        </Field>
        <Field label="Client secret">
          <KeyInput value={yt.clientSecret} onChange={(v) => set({ ...s, youtube: { ...yt, clientSecret: v.trim() } })} placeholder="GOCSPX-…" />
        </Field>
        <div className="flex items-center gap-2">
          {status?.connected ? (
            <>
              <Badge tone="ok">
                <Check className="size-3" /> Connected{status.channelTitle ? `: ${status.channelTitle}` : ''}
              </Badge>
              <button className="btn btn-sm" onClick={() => void api.youtubeDisconnect().then(refresh)}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="btn"
              disabled={!yt.clientId || !yt.clientSecret}
              onClick={() => {
                void save().then(() => window.open('/api/youtube/connect', '_blank', 'width=520,height=700'));
              }}
            >
              <YouTubeIcon className="size-4 text-[#ff0033]" /> Save & connect channel
            </button>
          )}
        </div>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export const SettingsDialog: React.FC = () => {
  const open = useStudio((s) => s.settingsOpen);
  const section = useStudio((s) => s.settingsSection);
  const close = useStudio((s) => s.closeSettings);
  const refreshSystem = useStudio((s) => s.refreshSystem);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [effective, setEffective] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .settings()
      .then((r) => {
        setSaved(r.saved);
        setEffective(r.effective);
        setDraft(structuredClone(r.saved));
      })
      .catch((err) => toast.error(errorText(err)));
  }, [open]);

  const dirty = useMemo(() => Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)), [draft, saved]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await api.saveSettings(draft);
      setSaved(r.saved);
      setEffective(r.effective);
      setDraft(structuredClone(r.saved));
      await refreshSystem();
      toast.success('Settings saved');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const onOpenChange = (o: boolean) => {
    if (o) return;
    if (dirty && !confirm('Discard unsaved settings?')) return;
    close();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(780px,92vh)] w-[min(1040px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl outline-none" onOpenAutoFocus={(e) => e.preventDefault()}>
          <Dialog.Title className="sr-only">Settings</Dialog.Title>
          <Dialog.Description className="sr-only">Configure AI models, voices, keys and integrations</Dialog.Description>
          <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-line bg-bg/40 p-3">
            <div className="mb-2 px-2 text-sm font-bold">Settings</div>
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => useStudio.setState({ settingsSection: id })}
                className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted hover:bg-panel-2 hover:text-text', section === id && 'bg-panel-3 font-semibold text-text')}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
              {!draft || !effective ? (
                <Spinner className="text-dim" />
              ) : section === 'models' ? (
                <ModelsSection s={draft} eff={effective} set={setDraft} />
              ) : section === 'speech' ? (
                <SpeechSection s={draft} set={setDraft} />
              ) : section === 'media' ? (
                <MediaSection s={draft} set={setDraft} />
              ) : section === 'agent' ? (
                <AgentSection s={draft} set={setDraft} />
              ) : section === 'render' ? (
                <RenderSection s={draft} set={setDraft} />
              ) : section === 'mcp' ? (
                <McpSection s={draft} set={setDraft} />
              ) : (
                <YouTubeSection s={draft} set={setDraft} save={save} />
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-line px-7 py-3">
              <span className="flex-1 text-[11px] text-dim">{dirty ? 'Unsaved changes' : 'Keys are stored locally and never sent to the browser in full.'}</span>
              <button className="btn" onClick={() => onOpenChange(false)}>
                Close
              </button>
              <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? <Spinner /> : <Check className="size-4" />} Save
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, type Content, type Part } from '@google/genai';
import { getSettings, type ModelRef, type ProviderConfig } from '../config';

/**
 * Provider-neutral chat layer used by the agent. One message format, three
 * native adapters: Anthropic (Claude), OpenAI-compatible (OpenAI, OpenRouter,
 * Groq, DeepSeek, Mistral, xAI, Together, Ollama, LM Studio, …) and Google Gemini.
 */

export type LlmPart = { type: 'text'; text: string } | { type: 'image'; mime: string; data: string };

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** set when the provider returned arguments that are not valid JSON */
  parseError?: string;
}

export interface LlmToolResult {
  callId: string;
  name: string;
  content: string;
  images?: { mime: string; data: string }[];
  isError?: boolean;
}

export interface RawTurn {
  provider: string;
  model: string;
  data: unknown;
}

export type LlmMessage =
  | { role: 'user'; content: LlmPart[] }
  | { role: 'assistant'; text: string; toolCalls: LlmToolCall[]; raw?: RawTurn }
  | { role: 'tool'; results: LlmToolResult[] };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  /** low-effort mode for sub-agents and quick utilities */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export type StopReason = 'end' | 'tool_calls' | 'max_tokens' | 'refusal' | 'other';

export interface ChatResponse {
  text: string;
  toolCalls: LlmToolCall[];
  stop: StopReason;
  usage: { input: number; output: number; cacheRead?: number };
  raw?: RawTurn;
}

export interface ChatModel {
  providerId: string;
  providerType: ProviderConfig['type'];
  model: string;
  label: string;
  vision: boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

const RETRIABLE = /overloaded|rate.?limit|429|503|502|504|timeout|ECONNRESET|socket hang up|fetch failed/i;

const withRetries = async <T>(fn: () => Promise<T>, signal?: AbortSignal, attempts = 3): Promise<T> => {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (signal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i === attempts - 1 || !RETRIABLE.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
  throw last;
};

const safeJson = (s: string): { value: Record<string, unknown>; error?: string } => {
  if (!s.trim()) return { value: {} };
  try {
    const v = JSON.parse(s);
    return { value: typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : { value: v } };
  } catch (err) {
    return { value: {}, error: `Invalid JSON arguments: ${(err as Error).message}` };
  }
};

const stripSchemaMeta = (schema: Record<string, unknown>): Record<string, unknown> => {
  const { $schema: _s, ...rest } = schema;
  void _s;
  return rest;
};

// ---------------------------------------------------------------------------
// Anthropic (Claude)
// ---------------------------------------------------------------------------

const claudeSupportsEffort = (model: string) => /claude-(opus-4-[5-9]|sonnet-4-[6-9]|opus-5|sonnet-5|haiku-5|fable|mythos)/.test(model);
const claudeNeedsExplicitAdaptive = (model: string) => /claude-(opus|sonnet)-4-[678]/.test(model);
const claudeSupportsFallbacks = (model: string) => /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/.test(model);
const claudeEffortCap = (model: string, effort: string) => (/claude-opus-4-5/.test(model) && (effort === 'xhigh' || effort === 'max') ? 'high' : effort);

type AnthropicBlock = Record<string, unknown>;

class AnthropicChat implements ChatModel {
  readonly providerType = 'anthropic' as const;
  readonly vision = true;
  private client: Anthropic;
  private fallbacksDisabled = false;

  constructor(
    private readonly provider: ProviderConfig,
    readonly model: string,
  ) {
    this.client = new Anthropic({
      apiKey: provider.apiKey || undefined,
      baseURL: provider.baseUrl || undefined,
      maxRetries: 3,
      timeout: 15 * 60_000,
      defaultHeaders: provider.headers,
    });
  }

  get providerId() {
    return this.provider.id;
  }
  get label() {
    return `${this.provider.name} · ${this.model}`;
  }

  private convert(messages: LlmMessage[]): Anthropic.Beta.BetaMessageParam[] {
    const out: Anthropic.Beta.BetaMessageParam[] = [];
    for (const m of messages) {
      if (m.role === 'user') {
        out.push({
          role: 'user',
          content: m.content.map((p) =>
            p.type === 'text'
              ? { type: 'text' as const, text: p.text }
              : { type: 'image' as const, source: { type: 'base64' as const, media_type: p.mime as 'image/jpeg', data: p.data } },
          ),
        });
      } else if (m.role === 'assistant') {
        if (m.raw && m.raw.provider === 'anthropic' && m.raw.model === this.model) {
          out.push({ role: 'assistant', content: m.raw.data as Anthropic.Beta.BetaContentBlockParam[] });
        } else {
          const content: AnthropicBlock[] = [];
          if (m.text) content.push({ type: 'text', text: m.text });
          for (const tc of m.toolCalls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
          if (content.length === 0) content.push({ type: 'text', text: '(no response)' });
          out.push({ role: 'assistant', content: content as unknown as Anthropic.Beta.BetaContentBlockParam[] });
        }
      } else {
        out.push({
          role: 'user',
          content: m.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.callId,
            is_error: r.isError || undefined,
            content: [
              { type: 'text' as const, text: r.content || '(empty)' },
              ...(r.images ?? []).map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mime as 'image/jpeg', data: img.data } })),
            ],
          })),
        });
      }
    }
    return out;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const settings = getSettings();
    const tools = req.tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: stripSchemaMeta(t.parameters) as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
      ...(i === req.tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
    const effort = req.effort ?? settings.llm.effort ?? 'high';
    const useFallbacks = settings.llm.claudeFallbacks && !this.fallbacksDisabled && !this.provider.baseUrl && claudeSupportsFallbacks(this.model);
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? settings.llm.maxOutputTokens,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages: this.convert(req.messages),
      cache_control: { type: 'ephemeral' },
    };
    if (claudeSupportsEffort(this.model)) params.output_config = { effort: claudeEffortCap(this.model, effort) };
    if (claudeNeedsExplicitAdaptive(this.model)) params.thinking = { type: 'adaptive' };
    if (useFallbacks) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    const run = async () => {
      const stream = this.client.beta.messages.stream(params as never, { signal: req.signal });
      stream.on('text', (d: string) => req.onText?.(d));
      return stream.finalMessage();
    };
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await withRetries(run, req.signal);
    } catch (err) {
      if (useFallbacks && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
        // account/region without server-side fallback: retry plainly from now on
        this.fallbacksDisabled = true;
        delete params.betas;
        delete params.fallbacks;
        message = await withRetries(run, req.signal);
      } else throw err;
    }
    let text = '';
    const toolCalls: LlmToolCall[] = [];
    for (const block of message.content) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }
    const stop: StopReason =
      message.stop_reason === 'tool_use'
        ? 'tool_calls'
        : message.stop_reason === 'max_tokens'
          ? 'max_tokens'
          : message.stop_reason === 'refusal'
            ? 'refusal'
            : message.stop_reason === 'end_turn' || message.stop_reason === 'stop_sequence'
              ? 'end'
              : 'other';
    return {
      text,
      toolCalls,
      stop: toolCalls.length > 0 && stop === 'end' ? 'tool_calls' : stop,
      usage: { input: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0), output: message.usage.output_tokens, cacheRead: message.usage.cache_read_input_tokens ?? 0 },
      raw: { provider: 'anthropic', model: this.model, data: message.content.filter((b) => (b.type as string) !== 'fallback') },
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible
// ---------------------------------------------------------------------------

const VISION_HINT = /gpt-4o|gpt-4\.1|gpt-5|chatgpt-4o|o3|o4|omni|vision|-vl|vl-|llava|gemini|claude|pixtral|gemma-?3|llama-?4|grok-(2-vision|4)|qwen2\.5-vl|qwen3-vl|minicpm-v|moondream/i;

class OpenAICompatChat implements ChatModel {
  readonly providerType = 'openai-compatible' as const;
  private client: OpenAI;
  vision: boolean;
  private tokenParam: 'max_completion_tokens' | 'max_tokens';

  constructor(
    private readonly provider: ProviderConfig,
    readonly model: string,
  ) {
    const baseURL = provider.baseUrl || 'https://api.openai.com/v1';
    const headers: Record<string, string> = { ...(provider.headers ?? {}) };
    if (baseURL.includes('openrouter.ai')) {
      headers['HTTP-Referer'] ??= 'https://github.com/aashir01/youtube-video-editor';
      headers['X-Title'] ??= 'Cutroom';
    }
    this.client = new OpenAI({ apiKey: provider.apiKey || 'not-needed', baseURL, defaultHeaders: headers, maxRetries: 2, timeout: 15 * 60_000 });
    this.vision = VISION_HINT.test(model);
    this.tokenParam = baseURL.includes('api.openai.com') ? 'max_completion_tokens' : 'max_tokens';
  }

  get providerId() {
    return this.provider.id;
  }
  get label() {
    return `${this.provider.name} · ${this.model}`;
  }

  private convert(system: string, messages: LlmMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') {
        const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
        for (const p of m.content) {
          if (p.type === 'text') parts.push({ type: 'text', text: p.text });
          else if (this.vision) parts.push({ type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } });
          else parts.push({ type: 'text', text: '[image omitted: the current model does not accept images]' });
        }
        out.push({ role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => (p as { text: string }).text).join('\n\n') : parts });
      } else if (m.role === 'assistant') {
        out.push({
          role: 'assistant',
          content: m.text || null,
          ...(m.toolCalls.length
            ? { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.input) } })) }
            : {}),
        });
      } else {
        const images: { name: string; mime: string; data: string }[] = [];
        for (const r of m.results) {
          out.push({ role: 'tool', tool_call_id: r.callId, content: r.isError ? `ERROR: ${r.content}` : r.content || '(empty)' });
          for (const img of r.images ?? []) images.push({ name: r.name, ...img });
        }
        if (images.length) {
          out.push({
            role: 'user',
            content: this.vision
              ? [{ type: 'text', text: `Images returned by ${[...new Set(images.map((i) => i.name))].join(', ')}:` }, ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: `data:${img.mime};base64,${img.data}` } }))]
              : `(${images.length} image(s) were returned by the tool, but the current model cannot view images.)`,
          });
        }
      }
    }
    return out;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const settings = getSettings();
    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.convert(req.system, req.messages),
      stream: true,
      stream_options: { include_usage: true },
      [this.tokenParam]: req.maxTokens ?? settings.llm.maxOutputTokens,
    };
    if (req.tools.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: stripSchemaMeta(t.parameters) } }));
    const temperature = req.temperature ?? settings.llm.temperature;
    if (temperature !== undefined) body.temperature = temperature;

    const attempt = async () => {
      const stream = (await this.client.chat.completions.create(body as never, { signal: req.signal })) as unknown as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
      let text = '';
      let finish: string | null = null;
      let usage = { input: 0, output: 0, cacheRead: 0 };
      const calls = new Map<number, { id: string; name: string; args: string }>();
      for await (const chunk of stream) {
        if (chunk.usage) usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0, cacheRead: (chunk.usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens ?? 0 };
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) {
          text += delta.content;
          req.onText?.(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? calls.size;
          const cur = calls.get(idx) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(idx, cur);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      const toolCalls: LlmToolCall[] = [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([i, c]) => {
          const parsed = safeJson(c.args);
          return { id: c.id || `call_${Date.now()}_${i}`, name: c.name, input: parsed.value, parseError: parsed.error };
        })
        .filter((c) => c.name);
      const stop: StopReason = toolCalls.length ? 'tool_calls' : finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end';
      return { text, toolCalls, stop, usage } satisfies ChatResponse;
    };

    try {
      return await withRetries(attempt, req.signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Some servers only know one of the two token parameters
      if (/max_tokens|max_completion_tokens/i.test(msg) && /unsupported|unrecognized|not supported|unknown|invalid/i.test(msg)) {
        const other = this.tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
        body[other] = body[this.tokenParam];
        delete body[this.tokenParam];
        this.tokenParam = other;
        return withRetries(attempt, req.signal);
      }
      if (/temperature/i.test(msg) && body.temperature !== undefined) {
        delete body.temperature;
        return withRetries(attempt, req.signal);
      }
      if (/stream_options/i.test(msg)) {
        delete body.stream_options;
        return withRetries(attempt, req.signal);
      }
      if (this.vision && /image|vision|multimodal|image_url/i.test(msg)) {
        this.vision = false;
        body.messages = this.convert(req.system, req.messages);
        return withRetries(attempt, req.signal);
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

class GeminiChat implements ChatModel {
  readonly providerType = 'gemini' as const;
  readonly vision = true;
  private ai: GoogleGenAI;

  constructor(
    private readonly provider: ProviderConfig,
    readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey: provider.apiKey, ...(provider.baseUrl ? { httpOptions: { baseUrl: provider.baseUrl } } : {}) });
  }

  get providerId() {
    return this.provider.id;
  }
  get label() {
    return `${this.provider.name} · ${this.model}`;
  }

  private convert(messages: LlmMessage[]): Content[] {
    const out: Content[] = [];
    const push = (role: 'user' | 'model', parts: Part[]) => {
      const last = out[out.length - 1];
      if (last && last.role === role) last.parts = [...(last.parts ?? []), ...parts];
      else out.push({ role, parts });
    };
    for (const m of messages) {
      if (m.role === 'user') {
        push('user', m.content.map((p) => (p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mime, data: p.data } })));
      } else if (m.role === 'assistant') {
        if (m.raw && m.raw.provider === 'gemini' && m.raw.model === this.model) push('model', m.raw.data as Part[]);
        else {
          const parts: Part[] = [];
          if (m.text) parts.push({ text: m.text });
          for (const tc of m.toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.input, ...(tc.id.startsWith('gcall_') ? {} : { id: tc.id }) } });
          push('model', parts.length ? parts : [{ text: '(no response)' }]);
        }
      } else {
        const parts: Part[] = m.results.map((r) => ({
          functionResponse: {
            name: r.name,
            ...(r.callId.startsWith('gcall_') ? {} : { id: r.callId }),
            response: r.isError ? { error: r.content } : { output: r.content },
          },
        }));
        for (const r of m.results) for (const img of r.images ?? []) parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
        push('user', parts);
      }
    }
    return out;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const settings = getSettings();
    const run = async (): Promise<ChatResponse> => {
      const stream = await this.ai.models.generateContentStream({
        model: this.model,
        contents: this.convert(req.messages),
        config: {
          systemInstruction: req.system,
          tools: req.tools.length ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: stripSchemaMeta(t.parameters) })) }] : undefined,
          maxOutputTokens: req.maxTokens ?? settings.llm.maxOutputTokens,
          ...(req.temperature ?? settings.llm.temperature) !== undefined ? { temperature: req.temperature ?? settings.llm.temperature } : {},
          abortSignal: req.signal,
        },
      });
      let text = '';
      const parts: Part[] = [];
      const toolCalls: LlmToolCall[] = [];
      let finish: string | undefined;
      let usage = { input: 0, output: 0, cacheRead: 0 };
      for await (const chunk of stream) {
        const cand = chunk.candidates?.[0];
        for (const part of cand?.content?.parts ?? []) {
          parts.push(part);
          if (part.text && !part.thought) {
            text += part.text;
            req.onText?.(part.text);
          }
          if (part.functionCall?.name) {
            toolCalls.push({ id: part.functionCall.id ?? `gcall_${Date.now()}_${toolCalls.length}`, name: part.functionCall.name, input: (part.functionCall.args ?? {}) as Record<string, unknown> });
          }
        }
        if (cand?.finishReason) finish = cand.finishReason;
        if (chunk.usageMetadata) usage = { input: chunk.usageMetadata.promptTokenCount ?? 0, output: (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0), cacheRead: chunk.usageMetadata.cachedContentTokenCount ?? 0 };
      }
      // merge consecutive text parts so the replayed history stays compact
      const merged: Part[] = [];
      for (const p of parts) {
        const last = merged[merged.length - 1];
        if (last && p.text !== undefined && last.text !== undefined && !p.thought && !last.thought && !p.thoughtSignature && !last.thoughtSignature) last.text += p.text;
        else merged.push({ ...p });
      }
      const stop: StopReason = toolCalls.length ? 'tool_calls' : finish === 'MAX_TOKENS' ? 'max_tokens' : finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST' ? 'refusal' : 'end';
      return { text, toolCalls, stop, usage, raw: { provider: 'gemini', model: this.model, data: merged } };
    };
    return withRetries(run, req.signal);
  }
}

// ---------------------------------------------------------------------------
// Factory, model listing, testing
// ---------------------------------------------------------------------------

export const createChatModel = (provider: ProviderConfig, model: string): ChatModel => {
  switch (provider.type) {
    case 'anthropic':
      return new AnthropicChat(provider, model);
    case 'gemini':
      return new GeminiChat(provider, model);
    default:
      return new OpenAICompatChat(provider, model);
  }
};

const modelCache = new Map<string, ChatModel>();

export const resolveModel = (ref: ModelRef | undefined, kind: 'main' | 'fast' = 'main'): ChatModel => {
  const s = getSettings();
  const r = ref ?? (kind === 'fast' ? s.llm.fast ?? s.llm.main : s.llm.main);
  if (!r) throw new NoModelConfiguredError();
  const provider = s.llm.providers.find((p) => p.id === r.providerId);
  if (!provider) throw new NoModelConfiguredError(`Provider "${r.providerId}" is not configured`);
  const key = `${provider.id}:${provider.apiKey.slice(-6)}:${provider.baseUrl ?? ''}:${r.model}`;
  let m = modelCache.get(key);
  if (!m) {
    m = createChatModel(provider, r.model);
    modelCache.set(key, m);
  }
  return m;
};

export class NoModelConfiguredError extends Error {
  constructor(msg = 'No LLM is configured yet. Open Settings → AI Models and add an API key (OpenAI-compatible, Gemini or Claude), or set OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY.') {
    super(msg);
  }
}

export const listModels = async (provider: ProviderConfig): Promise<string[]> => {
  try {
    if (provider.type === 'anthropic') {
      const client = new Anthropic({ apiKey: provider.apiKey || undefined, baseURL: provider.baseUrl || undefined });
      const out: string[] = [];
      for await (const m of client.models.list()) out.push(m.id);
      return out;
    }
    if (provider.type === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: provider.apiKey });
      const out: string[] = [];
      const pager = await ai.models.list({ config: { pageSize: 200 } });
      for await (const m of pager) {
        const actions = (m as { supportedActions?: string[] }).supportedActions ?? [];
        if (m.name && (actions.length === 0 || actions.includes('generateContent'))) out.push(m.name.replace(/^models\//, ''));
      }
      return out.filter((n) => !/embedding|aqa|imagen|veo|tts/i.test(n));
    }
    const client = new OpenAI({ apiKey: provider.apiKey || 'not-needed', baseURL: provider.baseUrl || 'https://api.openai.com/v1', defaultHeaders: provider.headers });
    const list = await client.models.list();
    const ids: string[] = [];
    for await (const m of list) ids.push(m.id);
    return ids.sort();
  } catch (err) {
    throw new Error(`Could not list models: ${(err as Error).message}`);
  }
};

export const testModel = async (provider: ProviderConfig, model: string) => {
  const started = Date.now();
  try {
    const chat = createChatModel(provider, model);
    const res = await chat.chat({
      system: 'You are a connectivity test. Reply with exactly the word OK and then call no tools.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Say OK.' }] }],
      tools: [],
      maxTokens: 2048,
      effort: 'low',
    });
    return { ok: true, reply: res.text.trim().slice(0, 200), latencyMs: Date.now() - started, vision: chat.vision };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 500), latencyMs: Date.now() - started };
  }
};

/** One-shot helper for utility calls (descriptions, titles, summaries). */
export const complete = async (opts: { system: string; prompt: string; images?: { mime: string; data: string }[]; kind?: 'main' | 'fast'; maxTokens?: number; signal?: AbortSignal }): Promise<string> => {
  const model = resolveModel(undefined, opts.kind ?? 'fast');
  const content: LlmPart[] = [{ type: 'text', text: opts.prompt }, ...(opts.images ?? []).map((i) => ({ type: 'image' as const, mime: i.mime, data: i.data }))];
  const res = await model.chat({ system: opts.system, messages: [{ role: 'user', content }], tools: [], maxTokens: opts.maxTokens ?? 4096, signal: opts.signal, effort: 'low' });
  return res.text.trim();
};

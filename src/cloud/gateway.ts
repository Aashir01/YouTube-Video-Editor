/**
 * The AI gateway: an OpenAI-compatible /chat/completions that forwards to the upstream (OpenRouter)
 * with Cutroom's key and charges the account what the request really cost (OpenRouter reports the
 * cost of each request; otherwise tokens times the catalog price), times the markup.
 */
import type { CloudConfig } from './config';
import type { CloudModel } from './catalog';
import { CloudError, type Ledger } from './ledger';

export interface GatewayDeps {
  cfg: CloudConfig;
  ledger: Ledger;
  catalog: CloudModel[];
  fetch: typeof fetch;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

export const openaiError = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { message, type: code === 'out_of_credits' ? 'insufficient_credits' : 'invalid_request_error', code } }), { status, headers: { 'Content-Type': 'application/json' } });

/** Credits for an upstream cost in USD. */
export const creditsFor = (cfg: CloudConfig, model: CloudModel, costUsd: number) => Math.ceil((costUsd * cfg.markup * (model.markup ?? 1)) / cfg.creditUsd - 1e-9);

export const costOfTokens = (model: CloudModel, input: number, output: number) => (input * model.price.input + output * model.price.output) / 1e6;

/** Rough prompt size in tokens: text at ~4 characters a token, an image at ~1,500. */
export const estimateInputTokens = (body: { messages?: unknown[]; tools?: unknown[] }) => {
  let chars = 0;
  let images = 0;
  for (const m of body.messages ?? []) {
    const content = (m as { content?: unknown }).content;
    if (typeof content === 'string') chars += content.length;
    else if (Array.isArray(content))
      for (const part of content) {
        const p = part as { type?: string; text?: string };
        if (p.type === 'image_url') images++;
        else chars += (p.text ?? '').length;
      }
    const calls = (m as { tool_calls?: unknown }).tool_calls;
    if (calls) chars += JSON.stringify(calls).length;
  }
  if (body.tools) chars += JSON.stringify(body.tools).length;
  return Math.ceil(chars / 4) + images * 1500;
};

export const hasImages = (messages: unknown[]) => messages.some((m) => Array.isArray((m as { content?: unknown }).content) && ((m as { content: { type?: string }[] }).content).some((p) => p?.type === 'image_url'));

const running = new Map<string, number>();

export const findModel = (catalog: CloudModel[], id: unknown) => catalog.find((m) => m.id === id) ?? catalog.find((m) => typeof id === 'string' && m.route[0] === id);

export const handleChat = async (deps: GatewayDeps, userId: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> => {
  const { cfg, ledger, catalog } = deps;
  const model = findModel(catalog, body.model);
  if (!model) return openaiError(400, 'unknown_model', `Unknown model "${String(body.model)}". Models: ${catalog.map((m) => m.id).join(', ')}`);
  if (!Array.isArray(body.messages) || !body.messages.length) return openaiError(400, 'bad_request', 'messages is required');
  const account = ledger.account(userId);
  if (model.tier === 'premium' && !account.premium) return openaiError(403, 'pro_model', `${model.name} is a Pro model: upgrade to Creator or buy a credit pack to use it (or pick a standard model like ${catalog.find((m) => m.tier === 'standard')?.name ?? 'Auto'}).`);

  // can the account afford the prompt and a reply of reasonable length?
  const estIn = estimateInputTokens(body as never);
  const cap = Number(body.max_tokens ?? body.max_completion_tokens) || 2000;
  const estimate = creditsFor(cfg, model, costOfTokens(model, estIn, Math.min(cap, 2000)));
  if (account.credits.total <= 0 || account.credits.total < estimate)
    return openaiError(
      402,
      'out_of_credits',
      account.credits.total <= 0
        ? `You're out of Cutroom AI credits. Top up or upgrade in Settings → Cutroom AI${account.plan === 'free' ? ` (free credits come back on ${new Date(account.renewsAt).toDateString()})` : ''}.`
        : `This request needs about ${estimate} credits and ${account.credits.total} are left. Top up in Settings → Cutroom AI, or use a cheaper model.`,
    );
  if ((running.get(userId) ?? 0) >= cfg.maxConcurrent) return openaiError(429, 'too_many_requests', `At most ${cfg.maxConcurrent} AI requests can run at once per account; wait for one to finish`);
  if (!cfg.upstreamKey && cfg.upstreamUrl.includes('openrouter.ai')) return openaiError(503, 'not_configured', 'Cutroom Cloud has no upstream key configured (OPENROUTER_API_KEY)');

  const stream = body.stream === true;
  const route = model.visionRoute && hasImages(body.messages) ? model.visionRoute : model.route;
  const out: Record<string, unknown> = { ...body, model: route[0], usage: { include: true }, user: userId };
  delete out.models;
  if (route.length > 1) out.models = route;
  if (stream) out.stream_options = { ...((body.stream_options as object) ?? {}), include_usage: true };

  running.set(userId, (running.get(userId) ?? 0) + 1);
  let settled = false;
  const settle = (usage: Usage | undefined, upstreamModel: string | undefined, fallback: boolean) => {
    if (settled) return;
    settled = true;
    running.set(userId, Math.max(0, (running.get(userId) ?? 1) - 1));
    const input = usage?.prompt_tokens ?? (fallback ? estIn : 0);
    const output = usage?.completion_tokens ?? 0;
    const cost = typeof usage?.cost === 'number' ? usage.cost : costOfTokens(model, input, output);
    if (cost <= 0 && !input && !output) return;
    try {
      ledger.charge(userId, creditsFor(cfg, model, cost), {
        note: fallback ? `${model.name} (stopped early)` : model.name,
        model: upstreamModel && upstreamModel !== model.id ? `${model.id} → ${upstreamModel}` : model.id,
        inputTokens: input,
        outputTokens: output,
        costUsd: Math.round(cost * 1e7) / 1e7,
      });
    } catch (err) {
      console.error('[cloud] charge failed', err);
    }
  };

  const abort = new AbortController();
  signal?.addEventListener('abort', () => abort.abort(), { once: true });
  let upstream: Response;
  try {
    upstream = await deps.fetch(`${cfg.upstreamUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.upstreamKey || 'none'}`, 'HTTP-Referer': 'https://github.com/aashir01/youtube-video-editor', 'X-Title': 'Cutroom' },
      body: JSON.stringify(out),
      signal: abort.signal,
    });
  } catch (err) {
    settled = true;
    running.set(userId, Math.max(0, (running.get(userId) ?? 1) - 1));
    return openaiError(502, 'upstream_unreachable', `The AI provider could not be reached: ${(err as Error).message}`);
  }
  if (!upstream.ok || !upstream.body) {
    settled = true;
    running.set(userId, Math.max(0, (running.get(userId) ?? 1) - 1));
    const text = await upstream.text().catch(() => '');
    return new Response(text || JSON.stringify({ error: { message: `Upstream error ${upstream.status}` } }), { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' } });
  }

  if (!stream) {
    try {
      const json = (await upstream.json()) as { usage?: Usage; model?: string };
      settle(json.usage, json.model, !json.usage);
      return new Response(JSON.stringify(json), { headers: { 'Content-Type': 'application/json', 'X-Cutroom-Credits': String(ledger.account(userId).credits.total) } });
    } catch (err) {
      settle(undefined, undefined, true);
      return openaiError(502, 'upstream_error', `Bad reply from the AI provider: ${(err as Error).message}`);
    }
  }

  // stream through, watching for the usage the last chunk carries
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let usage: Usage | undefined;
  let upstreamModel: string | undefined;
  const scan = (text: string) => {
    buf += text;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data) as { usage?: Usage; model?: string };
        if (j.usage) usage = j.usage;
        if (j.model) upstreamModel = j.model;
      } catch {
        /* partial or non-JSON line */
      }
    }
  };
  const piped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          scan(decoder.decode() + '\n');
          settle(usage, upstreamModel, !usage);
          controller.close();
          return;
        }
        scan(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      } catch (err) {
        settle(usage, upstreamModel, !usage);
        controller.error(err);
      }
    },
    cancel() {
      abort.abort();
      settle(usage, upstreamModel, !usage);
    },
  });
  return new Response(piped, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
};

export { CloudError };

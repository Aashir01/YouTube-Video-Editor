/**
 * The models Cutroom Cloud offers. Clients send the catalog id; the gateway sends the upstream
 * (OpenRouter) id, with fallbacks when a route lists more than one. "auto" and "auto-fast" are the
 * defaults the app uses, so the operator can move everyone to a better or cheaper model at once.
 *
 * A route can differ for requests that carry images (visionRoute), so "auto" sends text to a cheap
 * text model and only the steps that look at frames to a vision model.
 *
 * Prices are USD per million tokens and only used when the upstream does not report a request's
 * cost (OpenRouter does) and to estimate whether an account can afford a request.
 * Replace the whole list with a JSON file (CLOUD_MODELS): [{ id, name, route, tier, ... }].
 */
import fs from 'node:fs';
import { z } from 'zod';

export const ModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** upstream model ids, the first preferred (the rest are fallbacks) */
  route: z.array(z.string().min(1)).min(1),
  /** a different route for requests with images (a cheap text model for the rest, a vision model for these) */
  visionRoute: z.array(z.string().min(1)).min(1).optional(),
  /** premium models need the Creator plan or bought credits */
  tier: z.enum(['standard', 'premium']).default('standard'),
  vision: z.boolean().default(false),
  /** what it is good for, shown in the app */
  note: z.string().default(''),
  price: z.object({ input: z.number().min(0), output: z.number().min(0) }),
  /** per-model multiplier on top of the global markup (default 1) */
  markup: z.number().positive().optional(),
});
export type CloudModel = z.infer<typeof ModelSchema>;

export const DEFAULT_MODELS: CloudModel[] = [
  {
    id: 'auto',
    name: 'Cutroom Auto',
    // most Director steps are text (cached prompts make DeepSeek very cheap); steps with frames go to Gemini
    route: ['deepseek/deepseek-v3.2', 'qwen/qwen3-235b-a22b-2507'],
    visionRoute: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
    tier: 'standard',
    vision: true,
    note: 'The Director default: good at editing with tools, sees your footage, low cost',
    // the dearer of the two routes, for estimates (the upstream reports the real cost)
    price: { input: 0.3, output: 2.5 },
  },
  {
    id: 'auto-fast',
    name: 'Cutroom Fast',
    route: ['google/gemini-2.5-flash-lite', 'deepseek/deepseek-v3.2'],
    tier: 'standard',
    vision: true,
    note: 'Summaries, titles, translations and Find Shorts: the cheapest',
    price: { input: 0.1, output: 0.4 },
  },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', route: ['deepseek/deepseek-v3.2'], tier: 'standard', vision: false, note: 'Open model, strong writer, very cheap', price: { input: 0.28, output: 0.42 } },
  { id: 'qwen/qwen3-235b-a22b-2507', name: 'Qwen3 235B', route: ['qwen/qwen3-235b-a22b-2507'], tier: 'standard', vision: false, note: 'Open model, many languages', price: { input: 0.1, output: 0.6 } },
  { id: 'moonshotai/kimi-k2', name: 'Kimi K2', route: ['moonshotai/kimi-k2'], tier: 'standard', vision: false, note: 'Open model, good with tools', price: { input: 0.5, output: 2.4 } },
  { id: 'z-ai/glm-4.6', name: 'GLM 4.6', route: ['z-ai/glm-4.6'], tier: 'standard', vision: false, note: 'Open model, good with tools', price: { input: 0.45, output: 1.9 } },
  { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', route: ['meta-llama/llama-4-maverick'], tier: 'standard', vision: true, note: 'Open model with vision', price: { input: 0.15, output: 0.6 } },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', route: ['google/gemini-2.5-flash'], tier: 'standard', vision: true, note: 'Fast, sees images', price: { input: 0.3, output: 2.5 } },
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', route: ['google/gemini-2.5-flash-lite'], tier: 'standard', vision: true, note: 'Cheapest with vision', price: { input: 0.1, output: 0.4 } },
  { id: 'openai/gpt-5-mini', name: 'GPT-5 mini', route: ['openai/gpt-5-mini'], tier: 'standard', vision: true, note: 'Small OpenAI model', price: { input: 0.25, output: 2 } },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', route: ['google/gemini-2.5-pro'], tier: 'premium', vision: true, note: 'Pro: long videos, careful edits', price: { input: 1.25, output: 10 } },
  { id: 'openai/gpt-5', name: 'GPT-5', route: ['openai/gpt-5'], tier: 'premium', vision: true, note: 'Pro: strongest OpenAI model', price: { input: 1.25, output: 10 } },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', route: ['anthropic/claude-sonnet-4.5'], tier: 'premium', vision: true, note: 'Pro: best writing and planning', price: { input: 3, output: 15 } },
];

export const loadCatalog = (file?: string): CloudModel[] => {
  if (!file) return DEFAULT_MODELS;
  const list = z.array(ModelSchema).parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!list.length) throw new Error(`${file} lists no models`);
  return list;
};

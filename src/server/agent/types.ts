import { z } from 'zod';
import type { AnswerItem, AskPayload, PlanItem } from '../../shared/agent-types';
import type { Settings } from '../config';

export interface ToolImage {
  mime: string;
  data: string;
}

export interface ToolOutput {
  /** what the model reads */
  text: string;
  images?: ToolImage[];
  isError?: boolean;
  /** one-line summary for the UI tool card */
  summary?: string;
  /** browser-loadable image URLs for the UI */
  imageUrls?: string[];
}

export interface ToolContext {
  projectId: string;
  settings: Settings;
  signal: AbortSignal;
  /** 'director', a sub-agent id, 'mcp', or 'user' (editor buttons) */
  agentName: string;
  source: 'agent' | 'mcp' | 'user';
  /** live status line on the running tool card */
  progress: (text: string) => void;
  ask: (payload: Omit<AskPayload, 'id'>) => Promise<AnswerItem[]>;
  /** Ask the user to approve an action. `always` forces a prompt even in full-auto mode (outward-facing actions). */
  approve: (summary: string, cost?: string, opts?: { always?: boolean }) => Promise<boolean>;
  updatePlan: (items: PlanItem[]) => void;
  runSubagent: (agent: string, task: string) => Promise<string>;
}

export type Category = 'conversation' | 'project' | 'media' | 'research' | 'script' | 'edit' | 'generate' | 'motion' | 'review' | 'publish' | 'external';

export interface AgentTool {
  name: string;
  description: string;
  category: Category;
  /** zod schema (preferred) or raw JSON schema (external MCP tools) */
  schema?: z.ZodTypeAny;
  jsonSchema?: Record<string, unknown>;
  /** needs approval in "confirm costly" mode (paid APIs) */
  costly?: boolean | ((input: Record<string, unknown>) => boolean);
  /** safe to run in parallel with other tools */
  readOnly?: boolean;
  /** only meaningful inside the in-app chat (not exported over MCP) */
  uiOnly?: boolean;
  execute: (input: any, ctx: ToolContext) => Promise<ToolOutput | string>;
}

export const defineTool = <S extends z.ZodTypeAny>(t: Omit<AgentTool, 'schema' | 'execute'> & { schema: S; execute: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutput | string> }): AgentTool => t as AgentTool;

const cleanSchema = (s: Record<string, unknown>): Record<string, unknown> => {
  const { $schema: _x, ...rest } = s;
  void _x;
  return rest;
};

export const toolJsonSchema = (t: AgentTool): Record<string, unknown> => {
  if (t.jsonSchema) return cleanSchema(t.jsonSchema);
  if (!t.schema) return { type: 'object', properties: {} };
  return cleanSchema(z.toJSONSchema(t.schema, { io: 'input', unrepresentable: 'any', target: 'draft-7' }) as Record<string, unknown>);
};

export const normalizeOutput = (out: ToolOutput | string): ToolOutput => (typeof out === 'string' ? { text: out } : out);

/** Compact JSON for tool results (keeps token usage down). */
export const j = (v: unknown): string => JSON.stringify(v, (_k, val) => (typeof val === 'number' ? Math.round(val * 1000) / 1000 : val));

/** Wire types shared by the agent runtime (server) and the chat UI (web). */

export type PlanStatus = 'pending' | 'in_progress' | 'done' | 'skipped';
export interface PlanItem {
  id: string;
  title: string;
  status: PlanStatus;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  id: string;
  question: string;
  header?: string;
  /** choice = pick one, multi = pick many, text = free text, files = upload/attach media */
  kind: 'choice' | 'multi' | 'text' | 'files';
  options?: QuestionOption[];
  placeholder?: string;
  /** For `files`: which kinds the agent wants (video, audio, image, document) */
  accept?: string[];
  required?: boolean;
  allowOther?: boolean;
}

export interface AskPayload {
  id: string;
  title?: string;
  questions: Question[];
}

export interface AnswerItem {
  questionId: string;
  value: string | string[];
  assetIds?: string[];
}

export interface ApprovalPayload {
  id: string;
  tool: string;
  summary: string;
  cost?: string;
}

export interface Attachment {
  assetId: string;
  name: string;
  kind: string;
}

interface Base {
  id: string;
  createdAt: string;
  /** Sub-agent that produced the message, if any */
  agent?: string;
}

export type ChatMessage =
  | (Base & { role: 'user'; text: string; attachments?: Attachment[] })
  | (Base & { role: 'assistant'; text: string; streaming?: boolean })
  | (Base & {
      role: 'tool';
      toolCallId: string;
      name: string;
      input: unknown;
      status: 'running' | 'done' | 'error';
      summary?: string;
      output?: string;
      images?: string[];
      durationMs?: number;
    })
  | (Base & { role: 'question'; payload: AskPayload; answer?: AnswerItem[]; status: 'open' | 'answered' | 'cancelled' })
  | (Base & { role: 'approval'; payload: ApprovalPayload; decision?: 'approved' | 'denied' })
  | (Base & { role: 'system'; text: string; level: 'info' | 'warning' | 'error' });

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'error';

export interface AgentState {
  status: AgentStatus;
  detail?: string;
  model?: string;
}

export type AgentEvent =
  | { kind: 'status'; state: AgentState }
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'message-update'; message: ChatMessage }
  | { kind: 'text-delta'; messageId: string; delta: string }
  | { kind: 'plan'; items: PlanItem[] }
  | { kind: 'usage'; inputTokens: number; outputTokens: number; model: string }
  | { kind: 'reset' };

export interface ChatSnapshot {
  messages: ChatMessage[];
  plan: PlanItem[];
  state: AgentState;
  usage: { inputTokens: number; outputTokens: number };
}

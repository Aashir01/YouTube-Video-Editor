import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AgentEvent, AgentState, AnswerItem, AskPayload, Attachment, ChatMessage, ChatSnapshot, PlanItem } from '../../shared/agent-types';
import { uid } from '../../shared/ids';
import { formatTime } from '../../shared/timeline';
import { getSettings } from '../config';
import { bus } from '../events';
import { store } from '../storage/projects';
import { NoModelConfiguredError, resolveModel, type ChatModel, type LlmMessage, type LlmToolCall, type LlmToolResult, type ToolSpec } from '../ai/llm';
import { BUILTIN_TOOLS, SUBAGENT_TOOLS } from './tools';
import { buildSubagentPrompt, buildSystemPrompt, studioStateBlock } from './prompts';
import { normalizeOutput, toolJsonSchema, type AgentTool, type ToolContext, type ToolOutput } from './types';
import { mcpManager } from '../mcp/client';

const MAX_TOOL_TEXT = 40_000;
const COMPACT_AT_TOKENS = 150_000;
const SUBAGENT_MAX_STEPS = 40;

interface ChatFile {
  version: 1;
  messages: ChatMessage[];
  llm: LlmMessage[];
  plan: PlanItem[];
  usage: { inputTokens: number; outputTokens: number };
}

const now = () => new Date().toISOString();

const estimateTokens = (msgs: LlmMessage[]): number => {
  let chars = 0;
  let images = 0;
  for (const m of msgs) {
    if (m.role === 'user') for (const p of m.content) p.type === 'text' ? (chars += p.text.length) : images++;
    else if (m.role === 'assistant') chars += m.text.length + JSON.stringify(m.toolCalls).length;
    else for (const r of m.results) (chars += r.content.length), (images += r.images?.length ?? 0);
  }
  return Math.round(chars / 3.6) + images * 1200;
};

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… [truncated ${s.length - n} characters]` : s);

/** All tools available to the main agent: built-ins plus connected external MCP servers. */
export const allTools = (): AgentTool[] => [...BUILTIN_TOOLS, ...mcpManager.tools()];

const specs = (tools: AgentTool[]): ToolSpec[] => tools.map((t) => ({ name: t.name, description: t.description, parameters: toolJsonSchema(t) }));

export class AgentSession {
  private data: ChatFile = { version: 1, messages: [], llm: [], plan: [], usage: { inputTokens: 0, outputTokens: 0 } };
  private state: AgentState = { status: 'idle' };
  private abort: AbortController | null = null;
  private running: Promise<void> | null = null;
  private inbox: { text: string; attachments: Attachment[] }[] = [];
  private pendingAsk = new Map<string, (answers: AnswerItem[]) => void>();
  private pendingApproval = new Map<string, (ok: boolean) => void>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(readonly projectId: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as ChatFile;
      if (raw.version === 1) this.data = raw;
      // questions/approvals left open by a previous server run can't be resumed
      for (const m of this.data.messages) {
        if (m.role === 'question' && m.status === 'open') m.status = 'cancelled';
        if (m.role === 'tool' && m.status === 'running') m.status = 'error';
        if (m.role === 'assistant' && m.streaming) m.streaming = false;
      }
    } catch {
      /* new chat */
    }
  }

  private file() {
    return path.join(store.dir(this.projectId), 'chat.json');
  }

  private scheduleSave(immediate = false) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const write = async () => {
      this.saveTimer = null;
      const tmp = `${this.file()}.tmp`;
      try {
        await fsp.writeFile(tmp, JSON.stringify(this.data));
        await fsp.rename(tmp, this.file());
      } catch (err) {
        console.warn('[agent] could not save chat:', (err as Error).message);
      }
    };
    if (immediate) void write();
    else this.saveTimer = setTimeout(() => void write(), 400);
  }

  snapshot(): ChatSnapshot {
    return { messages: this.data.messages, plan: this.data.plan, state: this.state, usage: this.data.usage };
  }

  private emit(event: AgentEvent) {
    bus.emit(this.projectId, { type: 'agent', event });
  }

  private setState(status: AgentState['status'], detail?: string, model?: string) {
    this.state = { status, detail, model: model ?? this.state.model };
    this.emit({ kind: 'status', state: this.state });
  }

  private addMessage(m: ChatMessage) {
    this.data.messages.push(m);
    this.emit({ kind: 'message', message: m });
    this.scheduleSave();
    return m;
  }

  private updateMessage(m: ChatMessage) {
    const i = this.data.messages.findIndex((x) => x.id === m.id);
    if (i >= 0) this.data.messages[i] = m;
    this.emit({ kind: 'message-update', message: m });
    this.scheduleSave();
  }

  private system(text: string, level: 'info' | 'warning' | 'error' = 'info') {
    this.addMessage({ id: uid('m'), role: 'system', text, level, createdAt: now() });
  }

  get busy() {
    return this.running !== null;
  }

  // -------------------------------------------------------------------------
  // Public API (used by HTTP routes)
  // -------------------------------------------------------------------------

  async send(text: string, attachmentIds: string[] = []): Promise<void> {
    const project = await store.get(this.projectId);
    const attachments: Attachment[] = attachmentIds
      .map((id) => project.assets.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => ({ assetId: a.id, name: a.name, kind: a.kind }));
    this.addMessage({ id: uid('m'), role: 'user', text, attachments: attachments.length ? attachments : undefined, createdAt: now() });
    // a typed message while a question is open answers that question
    const open = [...this.data.messages].reverse().find((m) => m.role === 'question' && m.status === 'open');
    if (open && open.role === 'question' && this.pendingAsk.has(open.id)) {
      const answers: AnswerItem[] = open.payload.questions.map((q, i) => ({ questionId: q.id, value: i === 0 ? text : '', assetIds: i === 0 && attachmentIds.length ? attachmentIds : undefined }));
      this.answer(open.id, answers);
      return;
    }
    if (this.running) {
      this.inbox.push({ text, attachments });
      return;
    }
    this.start(text, attachments);
  }

  answer(messageId: string, answers: AnswerItem[]) {
    const m = this.data.messages.find((x) => x.id === messageId);
    const resolve = this.pendingAsk.get(messageId);
    if (!m || m.role !== 'question' || !resolve) throw new Error('This question is no longer waiting for an answer');
    m.status = 'answered';
    m.answer = answers;
    this.updateMessage(m);
    this.pendingAsk.delete(messageId);
    resolve(answers);
  }

  decide(messageId: string, approved: boolean) {
    const m = this.data.messages.find((x) => x.id === messageId);
    const resolve = this.pendingApproval.get(messageId);
    if (!m || m.role !== 'approval' || !resolve) throw new Error('This approval is no longer pending');
    m.decision = approved ? 'approved' : 'denied';
    this.updateMessage(m);
    this.pendingApproval.delete(messageId);
    resolve(approved);
  }

  stop() {
    this.inbox = [];
    this.abort?.abort();
  }

  async reset() {
    this.stop();
    await this.running?.catch(() => undefined);
    this.data = { version: 1, messages: [], llm: [], plan: [], usage: { inputTokens: 0, outputTokens: 0 } };
    this.emit({ kind: 'reset' });
    this.emit({ kind: 'plan', items: [] });
    this.scheduleSave(true);
  }

  // -------------------------------------------------------------------------
  // The agent loop
  // -------------------------------------------------------------------------

  private start(text: string, attachments: Attachment[]) {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.running = this.run(text, attachments, signal)
      .catch((err) => console.error('[agent] run crashed', err))
      .finally(() => {
        this.running = null;
        this.abort = null;
        this.setState('idle');
        this.scheduleSave(true);
        const next = this.inbox.shift();
        if (next) {
          const rest = this.inbox.splice(0);
          this.start([next, ...rest].map((x) => x.text).join('\n\n'), [next, ...rest].flatMap((x) => x.attachments));
        }
      });
  }

  private async userContent(text: string, attachments: Attachment[]): Promise<string> {
    const p = await store.get(this.projectId);
    const att = attachments.length
      ? `\n\nAttached files (already in the project): ${attachments
          .map((a) => {
            const asset = p.assets.find((x) => x.id === a.assetId);
            return `${a.assetId} (${a.kind} "${a.name}"${asset?.meta.duration ? `, ${formatTime(asset.meta.duration)}` : ''})`;
          })
          .join(', ')}`
      : '';
    return `${await studioStateBlock(p, getSettings())}\n\n${text}${att}`;
  }

  private async run(text: string, attachments: Attachment[], signal: AbortSignal) {
    const settings = getSettings();
    let model: ChatModel;
    try {
      model = resolveModel(undefined, 'main');
    } catch (err) {
      this.system(err instanceof NoModelConfiguredError ? err.message : `Model error: ${(err as Error).message}`, 'error');
      return;
    }
    this.data.llm.push({ role: 'user', content: [{ type: 'text', text: await this.userContent(text, attachments) }] });
    const tools = allTools();
    const system = buildSystemPrompt();
    const toolSpecs = specs(tools);
    try {
      await this.loop({ model, system, tools, toolSpecs, history: this.data.llm, signal, agentName: 'director', maxSteps: settings.agent.maxSteps });
    } catch (err) {
      if (signal.aborted) this.system('Stopped.', 'info');
      else {
        const msg = (err as Error).message ?? String(err);
        this.system(`The AI request failed: ${msg.slice(0, 600)}`, 'error');
        this.setState('error', msg.slice(0, 200));
      }
    }
  }

  private async loop(opts: { model: ChatModel; system: string; tools: AgentTool[]; toolSpecs: ToolSpec[]; history: LlmMessage[]; signal: AbortSignal; agentName: string; maxSteps: number }): Promise<string> {
    const { model, tools, history, signal, agentName } = opts;
    const isMain = agentName === 'director';
    let lastText = '';
    for (let step = 0; step < opts.maxSteps; step++) {
      if (signal.aborted) throw new Error('aborted');
      if (isMain) await this.maybeCompact(history, model);
      this.setState('thinking', agentName === 'director' ? undefined : `${agentName} is thinking`, model.label);
      let msg: Extract<ChatMessage, { role: 'assistant' }> | null = null;
      const res = await model.chat({
        system: opts.system,
        messages: history,
        tools: opts.toolSpecs,
        signal,
        effort: isMain ? undefined : agentName === 'reviewer' || agentName === 'researcher' ? 'medium' : undefined,
        onText: (delta) => {
          if (!msg) msg = this.addMessage({ id: uid('m'), role: 'assistant', text: '', streaming: true, createdAt: now(), agent: isMain ? undefined : agentName }) as Extract<ChatMessage, { role: 'assistant' }>;
          msg.text += delta;
          this.emit({ kind: 'text-delta', messageId: msg.id, delta });
        },
      });
      this.data.usage.inputTokens += res.usage.input;
      this.data.usage.outputTokens += res.usage.output;
      this.emit({ kind: 'usage', inputTokens: this.data.usage.inputTokens, outputTokens: this.data.usage.outputTokens, model: model.label });
      history.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw });
      if (res.text.trim()) lastText = res.text;
      const finalMsg = msg as Extract<ChatMessage, { role: 'assistant' }> | null;
      if (finalMsg) this.updateMessage({ ...finalMsg, text: res.text || finalMsg.text, streaming: false });
      else if (res.text.trim()) this.addMessage({ id: uid('m'), role: 'assistant', text: res.text, createdAt: now(), agent: isMain ? undefined : agentName });
      this.scheduleSave();

      if (res.stop === 'refusal') {
        this.system('The model declined to continue this request.', 'warning');
        break;
      }
      if (res.toolCalls.length === 0) {
        if (res.stop === 'max_tokens') {
          history.push({ role: 'user', content: [{ type: 'text', text: 'Your last response hit the output token limit. Continue exactly where you left off, in smaller steps.' }] });
          continue;
        }
        break;
      }
      if (res.stop === 'max_tokens') {
        // never run tools whose input may be truncated
        history.push({ role: 'tool', results: res.toolCalls.map((c) => ({ callId: c.id, name: c.name, content: 'Not executed: your response hit the output token limit so this tool input may be truncated. Retry with smaller inputs (split large edits/code into several calls).', isError: true })) });
        continue;
      }
      this.setState('working', undefined, model.label);
      const results = await this.executeCalls(res.toolCalls, tools, signal, agentName);
      history.push({ role: 'tool', results });
      if (isMain && this.inbox.length) {
        const msgs = this.inbox.splice(0);
        history.push({
          role: 'user',
          content: [{ type: 'text', text: `New message from the user while you were working:\n${msgs.map((m) => m.text + (m.attachments.length ? ` [attached: ${m.attachments.map((a) => `${a.assetId} ${a.kind} "${a.name}"`).join(', ')}]` : '')).join('\n')}` }],
        });
      }
      this.scheduleSave();
      if (step === opts.maxSteps - 1) {
        this.system(`Reached the step limit (${opts.maxSteps}). Send "continue" to keep going.`, 'warning');
      }
    }
    return lastText;
  }

  private toolContext(signal: AbortSignal, agentName: string, onProgress: (t: string) => void): ToolContext {
    const isMain = agentName === 'director';
    return {
      projectId: this.projectId,
      settings: getSettings(),
      signal,
      agentName,
      source: 'agent',
      progress: onProgress,
      ask: (payload) => {
        if (!isMain) return Promise.reject(new Error('Sub-agents cannot ask the user; report the open question to the Director instead.'));
        return this.ask(payload, signal);
      },
      approve: (summary, cost, opts) => this.approve(summary, cost, signal, opts?.always ?? false),
      updatePlan: (items) => {
        if (!isMain) return;
        this.data.plan = items;
        this.emit({ kind: 'plan', items });
        this.scheduleSave();
      },
      runSubagent: (agent, task) => (isMain ? this.runSubagent(agent, task, signal) : Promise.reject(new Error('Sub-agents cannot delegate further.'))),
    };
  }

  private ask(payload: Omit<AskPayload, 'id'>, signal: AbortSignal): Promise<AnswerItem[]> {
    const id = uid('m');
    const full: AskPayload = { ...payload, id };
    this.addMessage({ id, role: 'question', payload: full, status: 'open', createdAt: now() });
    this.setState('waiting', 'Waiting for your answer');
    return new Promise<AnswerItem[]>((resolve, reject) => {
      this.pendingAsk.set(id, (a) => {
        this.setState('working');
        resolve(a);
      });
      signal.addEventListener(
        'abort',
        () => {
          this.pendingAsk.delete(id);
          const m = this.data.messages.find((x) => x.id === id);
          if (m && m.role === 'question' && m.status === 'open') {
            m.status = 'cancelled';
            this.updateMessage(m);
          }
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  }

  private approve(summary: string, cost: string | undefined, signal: AbortSignal, always: boolean): Promise<boolean> {
    if (!always && getSettings().agent.autonomy === 'auto') return Promise.resolve(true);
    const id = uid('m');
    this.addMessage({ id, role: 'approval', payload: { id, tool: '', summary, cost }, createdAt: now() });
    this.setState('waiting', 'Waiting for approval');
    return new Promise<boolean>((resolve, reject) => {
      this.pendingApproval.set(id, (ok) => {
        this.setState('working');
        resolve(ok);
      });
      signal.addEventListener(
        'abort',
        () => {
          this.pendingApproval.delete(id);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  }

  private async executeCalls(calls: LlmToolCall[], tools: AgentTool[], signal: AbortSignal, agentName: string): Promise<LlmToolResult[]> {
    const run = async (call: LlmToolCall): Promise<LlmToolResult> => {
      const tool = tools.find((t) => t.name === call.name);
      const started = Date.now();
      const uiMsg = this.addMessage({
        id: uid('m'),
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        input: call.input,
        status: 'running',
        createdAt: now(),
        agent: agentName === 'director' ? undefined : agentName,
      }) as Extract<ChatMessage, { role: 'tool' }>;
      const finish = (out: ToolOutput): LlmToolResult => {
        this.updateMessage({ ...uiMsg, status: out.isError ? 'error' : 'done', summary: out.summary ?? (out.isError ? out.text.slice(0, 160) : undefined), output: truncate(out.text, 4000), images: out.imageUrls, durationMs: Date.now() - started });
        return { callId: call.id, name: call.name, content: truncate(out.text, MAX_TOOL_TEXT), images: out.images, isError: out.isError };
      };
      if (!tool) return finish({ text: `Unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(', ')}`, isError: true });
      if (call.parseError) return finish({ text: `${call.parseError}. Re-send the call with valid JSON arguments.`, isError: true });
      let input: unknown = call.input;
      if (tool.schema) {
        const parsed = tool.schema.safeParse(call.input);
        if (!parsed.success) {
          return finish({ text: `Invalid arguments for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`, isError: true });
        }
        input = parsed.data;
      }
      const ctx = this.toolContext(signal, agentName, (t) => this.updateMessage({ ...uiMsg, summary: t }));
      try {
        const out = normalizeOutput(await tool.execute(input, ctx));
        return finish(out);
      } catch (err) {
        if (signal.aborted) {
          finish({ text: 'Stopped by the user.', isError: true });
          throw err;
        }
        return finish({ text: `Error: ${(err as Error).message ?? String(err)}`, isError: true });
      }
    };
    const allReadOnly = calls.every((c) => tools.find((t) => t.name === c.name)?.readOnly);
    if (allReadOnly && calls.length > 1) return Promise.all(calls.map(run));
    const out: LlmToolResult[] = [];
    for (const c of calls) {
      if (signal.aborted) {
        out.push({ callId: c.id, name: c.name, content: 'Not executed: stopped by the user.', isError: true });
        continue;
      }
      out.push(await run(c));
    }
    return out;
  }

  private async runSubagent(agent: string, task: string, signal: AbortSignal): Promise<string> {
    const names = SUBAGENT_TOOLS[agent];
    if (!names) throw new Error(`Unknown sub-agent ${agent}`);
    const tools = allTools().filter((t) => names.includes(t.name));
    const model = resolveModel(undefined, 'main');
    const p = await store.get(this.projectId);
    const history: LlmMessage[] = [{ role: 'user', content: [{ type: 'text', text: `${await studioStateBlock(p, getSettings())}\n\nTask from the Director:\n${task}` }] }];
    this.system(`🧑‍🎨 ${agent.replace('_', ' ')} started: ${task.slice(0, 140)}${task.length > 140 ? '…' : ''}`, 'info');
    const report = await this.loop({ model, system: buildSubagentPrompt(agent), tools, toolSpecs: specs(tools), history, signal, agentName: agent, maxSteps: SUBAGENT_MAX_STEPS });
    return report || '(the sub-agent finished without a report)';
  }

  // -------------------------------------------------------------------------
  // Context compaction
  // -------------------------------------------------------------------------

  private async maybeCompact(history: LlmMessage[], model: ChatModel) {
    if (estimateTokens(history) < COMPACT_AT_TOKENS) return;
    this.setState('thinking', 'Summarizing earlier conversation to free up context');
    let cut = history.length - 8;
    while (cut > 0 && !(history[cut]!.role === 'user')) cut--;
    if (cut <= 0) cut = history.length;
    const old = history.slice(0, cut);
    const transcript = old
      .map((m) => {
        if (m.role === 'user') return `USER: ${m.content.map((p) => (p.type === 'text' ? p.text.replace(/<studio_state[\s\S]*?<\/studio_state>/g, '[state]') : '[image]')).join(' ')}`;
        if (m.role === 'assistant') return `ASSISTANT: ${m.text}${m.toolCalls.length ? `\nTOOLS: ${m.toolCalls.map((c) => `${c.name}(${truncate(JSON.stringify(c.input), 300)})`).join('; ')}` : ''}`;
        return `RESULTS: ${m.results.map((r) => `${r.name}: ${truncate(r.content, 400)}`).join(' | ')}`;
      })
      .join('\n');
    let summary = '';
    try {
      const fast = resolveModel(undefined, 'fast');
      const res = await fast.chat({
        system: 'You compress a video-editing agent session so the agent can continue seamlessly. Keep: the brief and user preferences/decisions (verbatim when important), what has been built on the timeline (with clip ids/times when relevant), assets and what they contain, facts gathered with sources, open questions, and the remaining plan. Be dense and factual.',
        messages: [{ role: 'user', content: [{ type: 'text', text: truncate(transcript, 300_000) }] }],
        tools: [],
        maxTokens: 6000,
        effort: 'low',
      });
      summary = res.text;
    } catch {
      summary = truncate(transcript, 20_000);
    }
    const tail = history.slice(cut).map((m) => (m.role === 'assistant' ? { ...m, raw: undefined } : m));
    history.splice(0, history.length, { role: 'user', content: [{ type: 'text', text: `<session_summary>\nThe earlier part of this session was summarized to save context:\n${summary}\n</session_summary>` }] }, ...tail);
    if (tail.length === 0 || tail[0]!.role !== 'user') history.push({ role: 'user', content: [{ type: 'text', text: 'Continue the work from the summary above.' }] });
    void model;
    this.system('Context compacted: the earlier conversation was summarized so the session can keep going.', 'info');
  }
}

const sessions = new Map<string, AgentSession>();

export const getSession = (projectId: string): AgentSession => {
  let s = sessions.get(projectId);
  if (!s) {
    s = new AgentSession(projectId);
    sessions.set(projectId, s);
  }
  return s;
};

/** Tool context for MCP callers (no chat UI: no questions, auto-approve). */
export const mcpToolContext = (projectId: string, signal: AbortSignal): ToolContext => ({
  projectId,
  settings: getSettings(),
  signal,
  agentName: 'mcp',
  source: 'mcp',
  progress: (t) => bus.emit(projectId, { type: 'job', id: 'mcp', label: 'MCP tool', status: 'running', detail: t }),
  ask: () => Promise.reject(new Error('ask_user is not available over MCP; ask your user directly.')),
  approve: () => Promise.resolve(true),
  updatePlan: () => undefined,
  runSubagent: () => Promise.reject(new Error('Sub-agents are not available over MCP.')),
});

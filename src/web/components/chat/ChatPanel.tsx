import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { ArrowUp, Bot, ChevronDown, Circle, CircleCheck, CircleDot, CircleSlash, Ellipsis, Info, KeyRound, ListTodo, Paperclip, RotateCcw, Square, TriangleAlert, X } from 'lucide-react';
import type { ChatMessage, PlanItem } from '../../../shared/agent-types';
import { api } from '../../lib/api';
import { editorContext, useStudio } from '../../lib/store';
import { cn, errorText, formatClock } from '../../lib/utils';
import { Menu, Spinner } from '../ui';
import { ToolGroup, type ToolMsg } from './ToolCard';
import { ApprovalCard, QuestionCard } from './QuestionCard';

type Item = { kind: 'msg'; m: ChatMessage } | { kind: 'tools'; id: string; agent?: string; tools: ToolMsg[] };

const HIDDEN_TOOLS = new Set(['ask_user', 'update_plan']);

const groupMessages = (messages: ChatMessage[]): Item[] => {
  const out: Item[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      if (HIDDEN_TOOLS.has(m.name)) continue;
      const last = out[out.length - 1];
      if (last?.kind === 'tools' && last.agent === m.agent) last.tools.push(m);
      else out.push({ kind: 'tools', id: m.id, agent: m.agent, tools: [m] });
      continue;
    }
    out.push({ kind: 'msg', m });
  }
  return out;
};

const AgentBadge: React.FC<{ agent: string }> = ({ agent }) => (
  <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-accent-2/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-2">{agent.replace('_', ' ')}</span>
);

const MarkdownText: React.FC<{ text: string }> = React.memo(({ text }) => (
  <div className="markdown text-[13px] leading-relaxed">
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </Markdown>
  </div>
));
MarkdownText.displayName = 'MarkdownText';

const MessageView: React.FC<{ m: ChatMessage }> = React.memo(({ m }) => {
  switch (m.role) {
    case 'user':
      return (
        <div className="flex justify-end">
          <div className="max-w-[88%] rounded-2xl rounded-br-md bg-accent/90 px-3 py-2 text-[13px] leading-relaxed text-white shadow">
            <div className="whitespace-pre-wrap break-words">{m.text}</div>
            {m.attachments && m.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.attachments.map((a) => (
                  <span key={a.assetId} className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px]">
                    <Paperclip className="size-3" /> {a.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    case 'assistant':
      if (!m.text.trim() && !m.streaming) return null;
      return (
        <div className={cn(m.agent && 'ml-3 border-l-2 border-accent-2/30 pl-3')}>
          {m.agent && <AgentBadge agent={m.agent} />}
          <MarkdownText text={m.text} />
          {m.streaming && <span className="typing-dot ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 rounded-sm bg-accent" />}
        </div>
      );
    case 'question':
      return <QuestionCard m={m} />;
    case 'approval':
      return <ApprovalCard m={m} />;
    case 'system':
      return (
        <div className={cn('flex items-start justify-center gap-1.5 px-4 text-center text-[11px] leading-snug', m.level === 'error' ? 'text-danger' : m.level === 'warning' ? 'text-warn' : 'text-dim')}>
          {m.level === 'error' ? <TriangleAlert className="mt-px size-3.5 shrink-0" /> : m.level === 'warning' ? <TriangleAlert className="mt-px size-3.5 shrink-0" /> : <Info className="mt-px size-3.5 shrink-0" />}
          <span>{m.text}</span>
        </div>
      );
    default:
      return null;
  }
});
MessageView.displayName = 'MessageView';

const PlanView: React.FC<{ plan: PlanItem[] }> = ({ plan }) => {
  const [open, setOpen] = useState(true);
  const done = plan.filter((p) => p.status === 'done' || p.status === 'skipped').length;
  const current = plan.find((p) => p.status === 'in_progress');
  return (
    <div className="border-b border-line bg-panel px-3 py-2">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <ListTodo className="size-4 text-accent" />
        <span className="text-xs font-bold">Plan</span>
        <span className="text-[11px] text-dim">
          {done}/{plan.length}
          {!open && current ? ` · ${current.title}` : ''}
        </span>
        <span className="flex-1" />
        <div className="h-1 w-16 overflow-hidden rounded-full bg-panel-3">
          <div className="h-full bg-ok transition-[width]" style={{ width: `${(done / Math.max(1, plan.length)) * 100}%` }} />
        </div>
        <ChevronDown className={cn('size-3.5 text-dim transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <ol className="mt-1.5 flex max-h-44 flex-col gap-0.5 overflow-y-auto">
          {plan.map((p) => (
            <li key={p.id} className="flex items-start gap-2 py-0.5 text-xs">
              {p.status === 'done' ? (
                <CircleCheck className="mt-px size-3.5 shrink-0 text-ok" />
              ) : p.status === 'in_progress' ? (
                <CircleDot className="mt-px size-3.5 shrink-0 animate-pulse text-accent" />
              ) : p.status === 'skipped' ? (
                <CircleSlash className="mt-px size-3.5 shrink-0 text-dim" />
              ) : (
                <Circle className="mt-px size-3.5 shrink-0 text-dim" />
              )}
              <span className={cn('leading-snug', p.status === 'done' || p.status === 'skipped' ? 'text-dim line-through' : p.status === 'in_progress' ? 'font-semibold text-text' : 'text-muted')}>{p.title}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

const STARTERS: { title: string; text: string; when?: (p: { hasVideo: boolean; topic: string }) => boolean }[] = [
  { title: 'Edit my footage', text: 'Edit my footage into a polished YouTube video: cut silences and filler words, add punch-in zooms, captions, b-roll and music.', when: ({ hasVideo }) => hasVideo },
  { title: 'Make this video', text: 'Let’s make this video. Ask me what you need, then plan it.', when: ({ topic }) => Boolean(topic) },
  { title: 'Explainer from a topic', text: 'Make a 3-minute explainer video about ' },
  { title: 'Turn a doc into a video', text: 'I’ll attach a document — turn it into an engaging video with a voiceover and animated graphics.' },
  { title: 'Make a YouTube Short', text: 'Make a punchy 45-second YouTube Short about ' },
  { title: 'Package for YouTube', text: 'Design the thumbnail and write the title options, description with chapters and tags.' },
];

const Welcome: React.FC<{ onPick: (t: string) => void }> = ({ onPick }) => {
  const project = useStudio((s) => s.project!);
  const system = useStudio((s) => s.system);
  const openSettings = useStudio((s) => s.openSettings);
  const ctx = { hasVideo: project.assets.some((a) => a.kind === 'video'), topic: project.brief.topic };
  const starters = STARTERS.filter((s) => !s.when || s.when(ctx)).slice(0, 4);
  return (
    <div className="flex flex-col items-center px-5 pb-6 pt-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-2 shadow-lg shadow-accent/20">
        <Bot className="size-6 text-white" />
      </div>
      <h3 className="text-base font-bold">I’m your Director</h3>
      <p className="mt-1 max-w-[300px] text-xs leading-relaxed text-muted">
        Tell me what you want to make. I’ll ask for what I need, then script, edit, animate, caption, add music and package it for YouTube — live on your timeline.
      </p>
      {system && !system.llm && (
        <button onClick={() => openSettings('models')} className="mt-4 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-left text-xs">
          <KeyRound className="size-4 shrink-0 text-accent" />
          <span>
            <span className="block font-semibold">Connect an AI model first</span>
            <span className="text-muted">OpenAI, Gemini, Claude, OpenRouter, local Ollama…</span>
          </span>
        </button>
      )}
      <div className="mt-5 grid w-full grid-cols-2 gap-2">
        {starters.map((s) => (
          <button key={s.title} onClick={() => onPick(s.text)} className="rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-left transition-colors hover:border-accent/60">
            <div className="text-xs font-semibold">{s.title}</div>
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-dim">{s.text}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

const StatusLine: React.FC = () => {
  const state = useStudio((s) => s.chat.state);
  const [elapsed, setElapsed] = useState(0);
  const active = state.status === 'thinking' || state.status === 'working';
  useEffect(() => {
    if (!active) return setElapsed(0);
    const start = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 1000);
    return () => clearInterval(t);
  }, [active, state.status]);
  if (state.status === 'idle') return null;
  const text =
    state.status === 'waiting'
      ? state.detail ?? 'Waiting for you'
      : state.status === 'error'
        ? `Error: ${state.detail ?? 'something went wrong'}`
        : state.detail ?? (state.status === 'thinking' ? 'Thinking' : 'Working');
  return (
    <div className={cn('flex items-center gap-2 px-3 pb-1.5 text-[11px]', state.status === 'error' ? 'text-danger' : 'text-muted')}>
      {active && (
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="typing-dot size-1 rounded-full bg-accent" style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </span>
      )}
      <span className="truncate">{text}</span>
      {active && elapsed >= 3 && <span className="ml-auto tabular-nums text-dim">{formatClock(elapsed)}</span>}
    </div>
  );
};

const Composer: React.FC = () => {
  const projectId = useStudio((s) => s.projectId)!;
  const project = useStudio((s) => s.project!);
  const busy = useStudio((s) => s.chat.state.status === 'thinking' || s.chat.state.status === 'working' || s.chat.state.status === 'waiting');
  const attachments = useStudio((s) => s.composerAttachments);
  const prefill = useStudio((s) => s.composerPrefill);
  const focusTick = useStudio((s) => s.composerFocusTick);
  const selection = useStudio((s) => s.selection.length);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [text]);

  useEffect(() => {
    if (prefill === null) return;
    setText(prefill);
    useStudio.setState({ composerPrefill: null });
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(prefill.length, prefill.length);
    });
  }, [prefill]);

  useEffect(() => {
    if (focusTick > 0) ta.current?.focus();
  }, [focusTick]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const { assets } = await api.upload(projectId, files);
      useStudio.getState().attachToChat(assets.map((a) => a.id));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await api.sendChat(projectId, t, attachments, editorContext());
      setText('');
      useStudio.setState({ composerAttachments: [] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-line bg-panel p-2.5">
      <div
        className="rounded-xl border border-line bg-panel-2 focus-within:border-accent/70"
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          void upload([...e.dataTransfer.files]);
        }}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {attachments.map((id) => (
              <span key={id} className="flex max-w-[200px] items-center gap-1 rounded-full bg-panel-3 py-0.5 pl-2 pr-1 text-[11px]">
                <Paperclip className="size-3 shrink-0 text-muted" />
                <span className="truncate">{project.assets.find((a) => a.id === id)?.name ?? id}</span>
                <button onClick={() => useStudio.setState({ composerAttachments: attachments.filter((x) => x !== id) })} className="rounded-full p-0.5 text-dim hover:text-text">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void upload(files);
            }
          }}
          placeholder={busy ? 'Message the Director — it reads it between steps…' : 'Describe what you want…'}
          className="block max-h-[220px] w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-[13px] leading-relaxed outline-none placeholder:text-dim"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <button className="btn btn-ghost btn-icon text-muted" title="Attach files" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : <Paperclip className="size-4" />}
          </button>
          <input ref={fileInput} type="file" hidden multiple onChange={(e) => (void upload([...(e.target.files ?? [])]), (e.target.value = ''))} />
          <span className="min-w-0 flex-1 truncate text-[10px] text-dim" title="Sent to the Director with your message">
            {project.tracks.some((t) => t.clips.length) ? `Sees: playhead${selection ? ` · ${selection} selected clip${selection > 1 ? 's' : ''}` : ''}` : ''}
          </span>
          {busy && (
            <button className="btn btn-sm" onClick={() => void api.stop(projectId)} title="Stop the Director">
              <Square className="size-3" fill="currentColor" /> Stop
            </button>
          )}
          <button className="flex size-7 items-center justify-center rounded-lg bg-accent text-white transition-opacity disabled:opacity-35" disabled={!text.trim() || sending} onClick={() => void send()} aria-label="Send">
            {sending ? <Spinner className="size-3.5" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ChatPanel: React.FC = () => {
  const chat = useStudio((s) => s.chat);
  const projectId = useStudio((s) => s.projectId)!;
  const system = useStudio((s) => s.system);
  const openSettings = useStudio((s) => s.openSettings);
  const items = useMemo(() => groupMessages(chat.messages), [chat.messages]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const model = chat.state.model ?? system?.llm?.model;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const tokens = chat.usage.inputTokens + chat.usage.outputTokens;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="min-w-0 flex-1 truncate text-[11px] text-dim" title={model ?? ''}>
          {model ? (
            <>
              <span className="mr-1 inline-block size-1.5 rounded-full bg-ok align-middle" /> {model}
            </>
          ) : (
            <button className="text-warn hover:underline" onClick={() => openSettings('models')}>
              No AI model connected
            </button>
          )}
          {tokens > 0 && <span className="ml-2">· {(tokens / 1000).toFixed(1)}k tokens</span>}
        </span>
        <Menu
          trigger={
            <button className="btn btn-ghost btn-icon text-muted" aria-label="Chat menu">
              <Ellipsis className="size-4" />
            </button>
          }
          items={[
            {
              label: 'New conversation',
              icon: <RotateCcw />,
              onSelect: () => {
                if (confirm('Start a new conversation? The project stays as it is; the Director forgets this chat.')) void api.resetChat(projectId).catch((e) => toast.error(errorText(e)));
              },
            },
            { label: 'AI model settings', icon: <KeyRound />, onSelect: () => openSettings('models') },
          ]}
        />
      </div>
      {chat.plan.length > 0 && <PlanView plan={chat.plan} />}
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {items.length === 0 ? (
          <Welcome onPick={(t) => useStudio.setState({ composerPrefill: t })} />
        ) : (
          <div className="flex flex-col gap-3 px-3 py-4">
            {items.map((it) =>
              it.kind === 'tools' ? (
                <div key={it.id} className={cn(it.agent && 'ml-3 border-l-2 border-accent-2/30 pl-3')}>
                  <ToolGroup tools={it.tools} />
                </div>
              ) : (
                <MessageView key={it.m.id} m={it.m} />
              ),
            )}
          </div>
        )}
      </div>
      <StatusLine />
      <Composer />
    </div>
  );
};

import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, CircleHelp, FileUp, Paperclip, ShieldCheck, X } from 'lucide-react';
import type { AnswerItem, ChatMessage, Question } from '../../../shared/agent-types';
import { api } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { cn, errorText } from '../../lib/utils';
import { Spinner } from '../ui';

type QuestionMsg = Extract<ChatMessage, { role: 'question' }>;
type ApprovalMsg = Extract<ChatMessage, { role: 'approval' }>;

interface Draft {
  picked: string[];
  other: string;
  text: string;
  assetIds: string[];
}

const ACCEPT: Record<string, string> = { video: 'video/*', audio: 'audio/*', image: 'image/*', document: '.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.srt,.vtt,.html,.htm,.xml,.yaml,.yml,.rtf' };

const FilesQuestion: React.FC<{ q: Question; draft: Draft; set: (d: Partial<Draft>) => void }> = ({ q, draft, set }) => {
  const project = useStudio((s) => s.project!);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const kinds = q.accept?.length ? q.accept : ['video', 'audio', 'image', 'document'];
  const existing = project.assets.filter((a) => kinds.includes(a.kind) || (kinds.includes('document') && a.kind === 'other'));
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(0);
    try {
      const { assets } = await api.upload(project.id, files, setUploading);
      set({ assetIds: [...draft.assetIds, ...assets.map((a) => a.id)] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setUploading(null);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload([...e.dataTransfer.files]);
        }}
        onClick={() => input.current?.click()}
        className={cn('flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center transition-colors', over ? 'border-accent bg-accent/10' : 'border-line-2 hover:border-accent/60')}
      >
        {uploading !== null ? <Spinner className="text-accent" /> : <FileUp className="size-5 text-accent" />}
        <span className="text-xs font-semibold">{uploading !== null ? `Uploading ${Math.round(uploading * 100)}%` : 'Drop files or click to upload'}</span>
        <span className="text-[11px] text-dim">{kinds.join(', ')}</span>
        <input ref={input} type="file" hidden multiple accept={kinds.map((k) => ACCEPT[k] ?? '').join(',')} onChange={(e) => (void upload([...(e.target.files ?? [])]), (e.target.value = ''))} />
      </div>
      {existing.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {existing.map((a) => {
            const on = draft.assetIds.includes(a.id);
            return (
              <button
                key={a.id}
                onClick={() => set({ assetIds: on ? draft.assetIds.filter((x) => x !== a.id) : [...draft.assetIds, a.id] })}
                className={cn('flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', on ? 'border-accent bg-accent/15 text-text' : 'border-line text-muted hover:text-text')}
              >
                {on ? <Check className="size-3" /> : <Paperclip className="size-3" />}
                <span className="truncate">{a.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <input className="field" value={draft.text} onChange={(e) => set({ text: e.target.value })} placeholder={q.placeholder ?? 'Or describe / paste a link…'} />
    </div>
  );
};

export const QuestionCard: React.FC<{ m: QuestionMsg }> = ({ m }) => {
  const projectId = useStudio((s) => s.projectId)!;
  const assets = useStudio((s) => s.project?.assets ?? []);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(m.payload.questions.map((q) => [q.id, { picked: [], other: '', text: '', assetIds: [] }])));
  const [sending, setSending] = useState(false);
  const set = (id: string) => (d: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...all[id]!, ...d } }));

  if (m.status !== 'open') {
    return (
      <div className={cn('rounded-xl border border-line bg-panel-2/60 px-3 py-2.5', m.status === 'cancelled' && 'opacity-60')}>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">
          <CircleHelp className="size-3.5" /> {m.payload.title ?? 'Questions'} {m.status === 'cancelled' && '· closed'}
        </div>
        {m.payload.questions.map((q) => {
          const a = m.answer?.find((x) => x.questionId === q.id);
          const val = Array.isArray(a?.value) ? a.value.join(', ') : a?.value;
          const files = a?.assetIds?.map((id) => assets.find((x) => x.id === id)?.name ?? id) ?? [];
          return (
            <div key={q.id} className="mb-1 text-xs leading-snug last:mb-0">
              <span className="text-muted">{q.question}</span>
              {(val || files.length > 0) && (
                <span className="font-semibold text-text">
                  {' '}
                  → {[val, files.length ? `📎 ${files.join(', ')}` : ''].filter(Boolean).join(' ')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const answerFor = (q: Question): AnswerItem => {
    const d = drafts[q.id]!;
    if (q.kind === 'files') return { questionId: q.id, value: d.text || (d.assetIds.length ? `Attached ${d.assetIds.length} file(s)` : ''), assetIds: d.assetIds.length ? d.assetIds : undefined };
    if (q.kind === 'text') return { questionId: q.id, value: d.text };
    const values = [...d.picked, ...(d.other.trim() ? [d.other.trim()] : [])];
    return { questionId: q.id, value: q.kind === 'multi' ? values : values[0] ?? '' };
  };
  const complete = m.payload.questions.every((q) => {
    // attachments are optional unless the agent says otherwise: not everyone has footage
    if (q.required === false || (q.kind === 'files' && q.required !== true)) return true;
    const a = answerFor(q);
    return Array.isArray(a.value) ? a.value.length > 0 : Boolean(a.value) || Boolean(a.assetIds?.length);
  });

  const submit = async (skip = false) => {
    setSending(true);
    try {
      await api.answer(projectId, m.id, skip ? m.payload.questions.map((q) => ({ questionId: q.id, value: 'No preference — you decide.' })) : m.payload.questions.map(answerFor));
    } catch (err) {
      toast.error(errorText(err));
      setSending(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-accent/50 bg-gradient-to-b from-accent/10 to-panel-2 shadow-lg shadow-accent/5">
      <div className="flex items-center gap-1.5 border-b border-accent/20 px-3 py-2 text-[12px] font-bold text-[#c9bcff]">
        <CircleHelp className="size-4" /> {m.payload.title ?? 'A few questions'}
      </div>
      <div className="flex flex-col gap-4 px-3 py-3">
        {m.payload.questions.map((q) => {
          const d = drafts[q.id]!;
          return (
            <div key={q.id} className="flex flex-col gap-2">
              <div>
                {q.header && <span className="mr-1.5 rounded bg-panel-3 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{q.header}</span>}
                <span className="text-[13px] font-semibold leading-snug">{q.question}</span>
              </div>
              {(q.kind === 'choice' || q.kind === 'multi') && (
                <div className="flex flex-col gap-1.5">
                  {(q.options ?? []).map((o) => {
                    const on = d.picked.includes(o.label);
                    return (
                      <button
                        key={o.label}
                        onClick={() => set(q.id)({ picked: q.kind === 'multi' ? (on ? d.picked.filter((x) => x !== o.label) : [...d.picked, o.label]) : on ? [] : [o.label], ...(q.kind === 'choice' ? { other: '' } : {}) })}
                        className={cn('flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors', on ? 'border-accent bg-accent/15' : 'border-line bg-panel hover:border-line-2')}
                      >
                        <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center border', q.kind === 'multi' ? 'rounded' : 'rounded-full', on ? 'border-accent bg-accent text-white' : 'border-line-2')}>{on && <Check className="size-3" />}</span>
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold">{o.label}</span>
                          {o.description && <span className="block text-[11px] leading-snug text-muted">{o.description}</span>}
                        </span>
                      </button>
                    );
                  })}
                  {q.allowOther !== false && (
                    <input
                      className="field text-xs"
                      value={d.other}
                      onChange={(e) => set(q.id)({ other: e.target.value, ...(q.kind === 'choice' && e.target.value ? { picked: [] } : {}) })}
                      placeholder="Other…"
                    />
                  )}
                </div>
              )}
              {q.kind === 'text' && <textarea className="field text-xs" rows={3} value={d.text} onChange={(e) => set(q.id)({ text: e.target.value })} placeholder={q.placeholder ?? 'Type your answer…'} />}
              {q.kind === 'files' && <FilesQuestion q={q} draft={d} set={set(q.id)} />}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
        <button className="btn btn-ghost btn-sm text-muted" disabled={sending} onClick={() => void submit(true)}>
          Skip — you decide
        </button>
        <button className="btn btn-primary btn-sm" disabled={sending || !complete} onClick={() => void submit()}>
          {sending ? <Spinner className="size-3.5" /> : <Check className="size-3.5" />} Send answers
        </button>
      </div>
    </div>
  );
};

export const ApprovalCard: React.FC<{ m: ApprovalMsg }> = ({ m }) => {
  const projectId = useStudio((s) => s.projectId)!;
  const [busy, setBusy] = useState(false);
  const decide = async (ok: boolean) => {
    setBusy(true);
    try {
      await api.approve(projectId, m.id, ok);
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  };
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', m.decision ? 'border-line bg-panel-2/60' : 'border-warn/50 bg-warn/5')}>
      <div className="flex items-start gap-2">
        <ShieldCheck className={cn('mt-0.5 size-4 shrink-0', m.decision ? 'text-dim' : 'text-warn')} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold leading-snug">{m.payload.summary}</div>
          {m.payload.cost && <div className="mt-0.5 text-[11px] text-muted">Estimated cost: {m.payload.cost}</div>}
        </div>
      </div>
      {m.decision ? (
        <div className={cn('mt-1.5 pl-6 text-[11px] font-semibold', m.decision === 'approved' ? 'text-ok' : 'text-danger')}>{m.decision === 'approved' ? 'Approved' : 'Declined'}</div>
      ) : (
        <div className="mt-2 flex justify-end gap-2">
          <button className="btn btn-sm" disabled={busy} onClick={() => void decide(false)}>
            <X className="size-3.5" /> Decline
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void decide(true)}>
            <Check className="size-3.5" /> Approve
          </button>
        </div>
      )}
    </div>
  );
};

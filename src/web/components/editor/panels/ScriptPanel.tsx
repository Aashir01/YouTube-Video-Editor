import React, { useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Mic, Plus, ScrollText, Trash2, WandSparkles } from 'lucide-react';
import type { Script, ScriptSection } from '../../../../shared/schema';
import { uid } from '../../../../shared/ids';
import { api } from '../../../lib/api';
import { useStudio } from '../../../lib/store';
import { errorText, formatClock } from '../../../lib/utils';
import { Badge, Empty, Spinner, TextArea, TextInput } from '../../ui';
import { PanelHeader } from '../LeftPanel';

const WPS = 2.4; // narration pace used for estimates
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

const SectionCard: React.FC<{ s: ScriptSection; i: number; count: number; onChange: (patch: Partial<ScriptSection>) => void; onMove: (d: -1 | 1) => void; onDelete: () => void }> = ({ s, i, count, onChange, onMove, onDelete }) => {
  const projectId = useStudio((st) => st.projectId)!;
  const [busy, setBusy] = useState(false);
  const est = s.durationSec ?? words(s.narration) / WPS;
  const voice = async () => {
    setBusy(true);
    try {
      const r = await api.runTool(projectId, 'generate_voiceover', { sectionIds: [s.id] });
      toast.success(`Voiced "${s.title || `section ${i + 1}`}"${r.summary ? ` (${r.summary})` : ''}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="group rounded-xl border border-line bg-panel-2 p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-panel-3 text-[10px] font-bold text-muted">{i + 1}</span>
        <TextInput value={s.title} onChange={(v) => onChange({ title: v })} placeholder="Section title" className="border-transparent bg-transparent px-1 py-0.5 font-semibold hover:border-line" />
        <Badge tone={s.status === 'placed' ? 'ok' : s.status === 'voiced' ? 'accent' : 'default'}>{s.status}</Badge>
      </div>
      <span className="label">Narration</span>
      <TextArea value={s.narration} onChange={(v) => onChange({ narration: v })} rows={4} placeholder="Exact words to be spoken…" />
      <span className="label mt-2">On screen</span>
      <TextArea value={s.visuals} onChange={(v) => onChange({ visuals: v })} rows={2} placeholder="B-roll, graphics, text…" />
      <div className="mt-2 flex items-center gap-1">
        <span className="flex-1 text-[11px] text-dim">
          {words(s.narration)} words · ~{formatClock(est)}
        </span>
        <button className="btn btn-ghost btn-icon text-dim" disabled={i === 0} onClick={() => onMove(-1)} title="Move up">
          <ArrowUp className="size-3.5" />
        </button>
        <button className="btn btn-ghost btn-icon text-dim" disabled={i === count - 1} onClick={() => onMove(1)} title="Move down">
          <ArrowDown className="size-3.5" />
        </button>
        <button className="btn btn-ghost btn-icon text-dim hover:text-danger" onClick={onDelete} title="Delete section">
          <Trash2 className="size-3.5" />
        </button>
        <button className="btn btn-sm" disabled={busy || !s.narration.trim()} onClick={() => void voice()}>
          {busy ? <Spinner className="size-3.5" /> : <Mic className="size-3.5" />}
          {s.voiceAssetId ? 'Re-voice' : 'Voice'}
        </button>
      </div>
    </div>
  );
};

export const ScriptPanel: React.FC = () => {
  const script = useStudio((s) => s.project!.script);
  const projectId = useStudio((s) => s.projectId)!;
  const editSoon = useStudio((s) => s.editSoon);
  const [voicingAll, setVoicingAll] = useState(false);

  const save = (next: Script) => editSoon('script', { op: 'setScript', script: next as unknown as Record<string, unknown> }, 'Edit script');
  const patchSection = (id: string, patch: Partial<ScriptSection>) => save({ ...script, sections: script.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const addSection = () => save({ ...script, sections: [...script.sections, { id: uid('sec'), title: '', narration: '', visuals: '', status: 'draft' }] });

  const askDirector = (text = 'Write the script for this video based on the brief. Show me the outline first.') => {
    useStudio.setState({ composerPrefill: text });
    useStudio.getState().focusComposer();
  };

  if (script.sections.length === 0 && !script.title) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Script" />
        <Empty icon={<ScrollText className="size-8" />} title="No script yet">
          The Director writes retention-focused scripts from your brief, documents and research — or write your own.
          <div className="mt-4 flex flex-col gap-2">
            <button className="btn btn-primary" onClick={() => askDirector()}>
              <WandSparkles className="size-4" /> Ask the Director to write it
            </button>
            <button className="btn" onClick={addSection}>
              <Plus className="size-4" /> Start a blank script
            </button>
          </div>
        </Empty>
      </div>
    );
  }

  const totalWords = script.sections.reduce((n, s) => n + words(s.narration), 0);
  const voiceAll = async () => {
    setVoicingAll(true);
    try {
      const r = await api.runTool(projectId, 'generate_voiceover', {});
      toast.success(r.summary ? `Voiceover placed (${r.summary})` : 'Voiceover placed');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setVoicingAll(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Script">
        <span className="text-[11px] text-dim">
          {totalWords} words · ~{formatClock(totalWords / WPS)}
        </span>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <span className="label">Title</span>
        <TextInput value={script.title} onChange={(v) => save({ ...script, title: v })} placeholder="Working title" />
        <span className="label mt-3">Hook</span>
        <TextArea value={script.hook} onChange={(v) => save({ ...script, hook: v })} rows={2} placeholder="The first 5 seconds…" />
        <div className="mt-4 flex flex-col gap-2.5">
          {script.sections.map((s, i) => (
            <SectionCard
              key={s.id}
              s={s}
              i={i}
              count={script.sections.length}
              onChange={(patch) => patchSection(s.id, patch)}
              onMove={(d) => {
                const next = [...script.sections];
                const [item] = next.splice(i, 1);
                next.splice(i + d, 0, item!);
                save({ ...script, sections: next });
              }}
              onDelete={() => save({ ...script, sections: script.sections.filter((x) => x.id !== s.id) })}
            />
          ))}
        </div>
        <button className="btn btn-ghost mt-2 w-full border-dashed border-line text-muted" onClick={addSection}>
          <Plus className="size-4" /> Add section
        </button>
        <span className="label mt-4">Call to action</span>
        <TextArea value={script.callToAction} onChange={(v) => save({ ...script, callToAction: v })} rows={2} placeholder="Subscribe, comment, watch next…" />
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <button className="btn flex-1" onClick={() => askDirector('Review the script and tighten it: a stronger hook, better pacing, concrete visuals for every section. Tell me what you changed.')}>
          <WandSparkles className="size-4" /> Improve
        </button>
        <button className="btn btn-primary flex-1" disabled={voicingAll || totalWords === 0} onClick={() => void voiceAll()}>
          {voicingAll ? <Spinner /> : <Mic className="size-4" />} Voice all
        </button>
      </div>
    </div>
  );
};

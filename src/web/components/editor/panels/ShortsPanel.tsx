import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ExternalLink, Play, Smartphone, Sparkles } from 'lucide-react';
import { MOMENT_LENGTHS, wordsSignature, type Moment } from '../../../../shared/moments';
import { timelineWords } from '../../../../shared/timeline';
import { api } from '../../../lib/api';
import { useStudio } from '../../../lib/store';
import { player } from '../../../lib/player';
import { navigate } from '../../../lib/nav';
import { cn, errorText, formatClock } from '../../../lib/utils';
import { Empty, Segmented, Spinner, TextInput, Tip } from '../../ui';
import { PanelHeader } from '../LeftPanel';

/**
 * Find Shorts: the AI reads the transcript and picks the moments that work on their own as
 * Shorts. Click one to play it; one more click turns it into a vertical, captioned Short.
 */

type Length = keyof typeof MOMENT_LENGTHS;
const LENGTH_LABELS: Record<Length, string> = { short: '15–30s', standard: '20–60s', long: '30–90s' };

const playMoment = (m: Moment) => {
  useStudio.setState({ range: [m.start, m.end], loopRange: true });
  player.seek(m.start);
  player.play();
};

const MomentCard: React.FC<{ m: Moment; rank: number; stale: boolean; busy: boolean; onMake: () => void }> = ({ m, rank, stale, busy, onMake }) => {
  const active = useStudio((s) => s.range?.[0] === m.start && s.range?.[1] === m.end);
  return (
    <div
      data-moment={m.id}
      className={cn('group rounded-xl border bg-white/[0.025] p-2.5 transition-colors', active ? 'border-hue-ember/70 bg-hue-ember/[0.06]' : 'border-line hover:border-line-2')}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn('mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold', m.score >= 8 ? 'bg-hue-ember/20 text-hue-ember' : 'bg-white/[0.06] text-muted')}
          title={`Score ${m.score}/10 (rank ${rank})`}
        >
          {m.score}/10
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold leading-snug">{m.title}</div>
          <div className="mt-0.5 font-mono text-[10px] text-dim">
            {formatClock(m.start)}–{formatClock(m.end)} · {Math.round(m.end - m.start)}s
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs italic leading-relaxed text-text/85">“{m.hook}”</p>
      {m.why && <p className="mt-1 text-[11px] leading-relaxed text-muted">{m.why}</p>}
      <div className="mt-2.5 flex gap-1.5">
        <button className="btn btn-sm" onClick={() => playMoment(m)} aria-label={`Play ${m.title}`}>
          <Play className="size-3.5" /> Play
        </button>
        {m.shortId ? (
          <button className="btn btn-sm flex-1" onClick={() => navigate(m.shortId!)}>
            <ExternalLink className="size-3.5" /> Open the Short
          </button>
        ) : (
          <Tip label={stale ? 'The video changed since this was found: find Shorts again' : 'A new 9:16 project, reframed on the speaker and captioned'}>
            <button className="btn btn-sm btn-primary flex-1" disabled={busy || stale} onClick={onMake} aria-label={`Make a Short: ${m.title}`}>
              {busy ? <Spinner className="size-3.5" /> : <Smartphone className="size-3.5" />} Make Short
            </button>
          </Tip>
        )}
      </div>
    </div>
  );
};

export const ShortsPanel: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const transcripts = useStudio((s) => s.transcripts);
  const state = useStudio((s) => s.moments);
  const hasModel = useStudio((s) => s.system?.llm !== null);
  const words = useMemo(() => timelineWords(project, transcripts), [project, transcripts]);
  const stale = Boolean(state && words.length && wordsSignature(words) !== state.signature);
  const [count, setCount] = useState(String(state?.options.count ?? 5));
  const [length, setLength] = useState<Length>(() => (Object.entries(MOMENT_LENGTHS).find(([, [a, b]]) => a === state?.options.minSec && b === state?.options.maxSec)?.[0] as Length) ?? 'standard');
  const [focus, setFocus] = useState(state?.options.focus ?? '');
  const [finding, setFinding] = useState(false);
  const [making, setMaking] = useState<Set<string>>(new Set());

  const find = async () => {
    setFinding(true);
    try {
      const [minSec, maxSec] = MOMENT_LENGTHS[length];
      const r = await api.findMoments(project.id, { count: Number(count), minSec, maxSec, focus: focus.trim() || undefined });
      useStudio.setState({ moments: r.state });
      toast.success(`Found ${r.state.moments.length} moment${r.state.moments.length === 1 ? '' : 's'} for Shorts`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setFinding(false);
    }
  };

  const make = async (list: Moment[]) => {
    for (const m of list) {
      setMaking((s) => new Set(s).add(m.id));
      const t = toast.loading(`Making the Short “${m.title}”…`);
      try {
        const r = await api.shortFromMoment(project.id, m.id);
        toast.success(`Short ready: ${r.name} (${r.duration.toFixed(0)}s, 9:16, captioned)`, { id: t, duration: 8000, action: { label: 'Open', onClick: () => navigate(r.id) } });
      } catch (err) {
        toast.error(errorText(err), { id: t });
        break;
      } finally {
        setMaking((s) => {
          const next = new Set(s);
          next.delete(m.id);
          return next;
        });
      }
    }
  };

  const remaining = state?.moments.filter((m) => !m.shortId) ?? [];

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Shorts">{state && <span className="font-mono text-[10px] text-dim">{state.moments.length} found</span>}</PanelHeader>
      <div className="flex flex-col gap-2.5 border-b border-line px-3 py-3">
        <p className="text-[11px] leading-relaxed text-muted">The AI reads the transcript and picks moments that open on a hook and end on a payoff. Each one becomes a vertical, captioned Short in one click.</p>
        <div className="flex items-center gap-2">
          <span className="w-14 text-[11px] text-dim">How many</span>
          <Segmented size="sm" className="flex-1" value={count} onChange={setCount} options={['3', '5', '8'].map((v) => ({ value: v, label: v }))} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 text-[11px] text-dim">Length</span>
          <Segmented size="sm" className="flex-1" value={length} onChange={setLength} options={(Object.keys(MOMENT_LENGTHS) as Length[]).map((v) => ({ value: v, label: LENGTH_LABELS[v] }))} />
        </div>
        <TextInput value={focus} onChange={setFocus} placeholder="Look for… e.g. the funniest bits, practical tips (optional)" className="text-xs" />
        {words.length === 0 ? (
          <div className="rounded-lg border border-line bg-black/20 px-2.5 py-2 text-[11px] text-muted">
            Finding Shorts needs a transcript.{' '}
            <button className="font-semibold text-accent-2-ink hover:underline" onClick={() => useStudio.getState().setLeftTab('transcript')}>
              Transcribe in the Text tab
            </button>
          </div>
        ) : !hasModel ? (
          <div className="rounded-lg border border-line bg-black/20 px-2.5 py-2 text-[11px] text-muted">
            Finding Shorts needs an AI model.{' '}
            <button className="font-semibold text-accent-2-ink hover:underline" onClick={() => useStudio.getState().openSettings('models')}>
              Add one in Settings
            </button>
          </div>
        ) : null}
        <button className="btn btn-primary" disabled={finding || words.length === 0} onClick={() => void find()}>
          {finding ? <Spinner /> : <Sparkles className="size-4" />} {finding ? 'Reading the transcript…' : state ? 'Find Shorts again' : 'Find Shorts'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!state ? (
          <Empty icon={<Smartphone className="size-6" />} title="No moments yet">
            Find the parts of this video that work best as Shorts.
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {stale && (
              <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-[11px] text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                The video was edited since these moments were found. Find Shorts again so the times match.
              </div>
            )}
            {remaining.length > 1 && !stale && (
              <button className="btn btn-sm" disabled={making.size > 0} onClick={() => void make(remaining)}>
                <Smartphone className="size-3.5" /> Make all {remaining.length} Shorts
              </button>
            )}
            {state.moments.map((m, i) => (
              <MomentCard key={m.id} m={m} rank={i + 1} stale={stale} busy={making.has(m.id)} onMake={() => void make([m])} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

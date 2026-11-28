import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CircleCheck, CircleX, Gauge, Wand2 } from 'lucide-react';
import { analyzeRetention, type RetentionFix, type RetentionIssue } from '../../../../shared/retention';
import { api } from '../../../lib/api';
import { askDirector } from '../../../lib/commands';
import { useStudio } from '../../../lib/store';
import { player } from '../../../lib/player';
import { cn, errorText, formatClock } from '../../../lib/utils';
import { Empty, Spinner } from '../../ui';
import { PanelHeader } from '../LeftPanel';

/**
 * Retention coach: scores the hook and flags where viewers would leave, worked out from the edit
 * as it is now (instant, no AI needed). Each finding plays from its spot, and most fix in one click.
 */

const tone = (score: number, of = 100) => (score >= of * 0.75 ? 'text-ok' : score >= of * 0.5 ? 'text-warn' : 'text-danger');

const useFix = () => {
  const projectId = useStudio((s) => s.projectId!);
  const edit = useStudio((s) => s.edit);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fix: RetentionFix) => {
    if (fix.kind === 'ask') return askDirector(fix.prompt);
    setBusy(key);
    try {
      if (fix.kind === 'ops') await edit(fix.ops, `Coach: ${fix.label}`);
      else await api.runTool(projectId, fix.tool, fix.input);
      toast.success(`Fixed: ${fix.label}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
};

const FixButton: React.FC<{ id: string; fix: RetentionFix; busy: string | null; run: (k: string, f: RetentionFix) => void; primary?: boolean }> = ({ id, fix, busy, run, primary }) => (
  <button className={cn('btn btn-sm h-auto min-h-7 whitespace-normal py-1 text-left', primary && 'btn-primary', fix.kind === 'ask' && 'btn-ghost text-accent-2-ink')} disabled={busy !== null} onClick={() => run(id, fix)}>
    {busy === id ? <Spinner className="size-3 shrink-0" /> : <Wand2 className="size-3 shrink-0" />} {fix.label}
  </button>
);

const SEVERITY: Record<RetentionIssue['severity'], string> = { high: 'bg-danger', medium: 'bg-warn', low: 'bg-dim' };

export const CoachPanel: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const transcripts = useStudio((s) => s.transcripts);
  const report = useMemo(() => analyzeRetention(project, transcripts), [project, transcripts]);
  const { busy, run } = useFix();
  const seek = (t: number) => {
    player.seek(t);
    useStudio.setState({ range: null });
  };
  const noWords = report.stats.words === 0;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Coach">
        <span className="font-mono text-[10px] text-dim">{report.short ? 'Short' : 'long video'}</span>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {noWords ? (
          <Empty icon={<Gauge className="size-6" />} title="Nothing to coach yet">
            The coach reads the transcript of the footage on the timeline. Transcribe it in the Text tab first.
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-line bg-black/20 px-3 py-2.5">
              <div className="text-center">
                <div className={cn('text-2xl font-bold tabular-nums', tone(report.score))} data-testid="retention-score">
                  {report.score}
                </div>
                <div className="text-[9px] uppercase tracking-wider text-dim">retention</div>
              </div>
              <div className="min-w-0 flex-1 text-[10px] leading-relaxed text-dim">
                {report.stats.wpm} words a minute · {report.stats.changesPerMinute} visual changes a minute · longest shot {Math.round(report.stats.longestShot)}s
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="text-xs font-bold">The hook</span>
                <span className="text-[10px] text-dim">first {report.hook.window} seconds</span>
                <span className={cn('ml-auto font-mono text-xs font-bold', tone(report.hook.score, 10))} data-testid="hook-score">
                  {report.hook.score}/10
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {report.hook.checks.map((c) => (
                  <div key={c.id} className="rounded-lg border border-line bg-black/20 px-2.5 py-1.5" data-check={c.id} data-ok={c.ok}>
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                      {c.ok ? <CircleCheck className="size-3.5 shrink-0 text-ok" /> : <CircleX className="size-3.5 shrink-0 text-danger" />}
                      {c.label}
                    </div>
                    <div className="mt-0.5 pl-5 text-[10px] leading-snug text-dim">{c.detail}</div>
                    {!c.ok && c.fix && (
                      <div className="mt-1 pl-5">
                        <FixButton id={c.id} fix={c.fix} busy={busy} run={run} primary={c.fix.kind !== 'ask'} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="text-xs font-bold">Where viewers may leave</span>
                <span className="ml-auto text-[10px] text-dim">{report.issues.length}</span>
              </div>
              {report.bulk.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {report.bulk.map((b, i) => (
                    <FixButton key={b.label} id={`bulk-${i}`} fix={b} busy={busy} run={run} primary />
                  ))}
                </div>
              )}
              {report.issues.length === 0 ? (
                <div className="rounded-lg border border-line bg-black/20 px-2.5 py-2 text-[11px] text-muted">No dead spots: it keeps moving.</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {report.issues.map((i) => (
                    <div key={i.id} className="rounded-lg border border-line bg-black/20 px-2.5 py-1.5" data-issue={i.kind}>
                      <button className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold hover:text-accent-2-ink" onClick={() => seek(i.at)} title="Play from here">
                        <span className={cn('size-1.5 shrink-0 rounded-full', SEVERITY[i.severity])} />
                        <span className="font-mono text-[10px] text-dim">{formatClock(i.at)}</span>
                        <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      </button>
                      <div className="mt-0.5 pl-3 text-[10px] leading-snug text-dim">{i.detail}</div>
                      {i.fix && (
                        <div className="mt-1 pl-3">
                          <FixButton id={i.id} fix={i.fix} busy={busy} run={run} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

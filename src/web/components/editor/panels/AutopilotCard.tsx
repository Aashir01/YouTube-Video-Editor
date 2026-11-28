import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, CircleCheck, CircleX, ExternalLink, RotateCcw, Rocket, Square } from 'lucide-react';
import { nextSlot, type AutopilotItem } from '../../../../shared/autopilot';
import { api } from '../../../lib/api';
import { useStudio } from '../../../lib/store';
import { navigate } from '../../../lib/nav';
import { cn, errorText } from '../../../lib/utils';
import { ProgressBar, Segmented, Spinner, Switch } from '../../ui';

/** "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local"> */
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const STATUS: Record<AutopilotItem['status'], string> = {
  queued: 'Waiting',
  making: 'Making the Short',
  rendering: 'Rendering',
  uploading: 'Uploading',
  scheduled: 'Scheduled',
  rendered: 'Rendered',
  failed: 'Failed',
  cancelled: 'Stopped',
};

const Item: React.FC<{ it: AutopilotItem }> = ({ it }) => {
  const busy = ['making', 'rendering', 'uploading'].includes(it.status);
  const good = it.status === 'scheduled' || it.status === 'rendered';
  return (
    <div className="rounded-lg border border-line bg-black/20 px-2.5 py-2" data-autopilot-item={it.momentId} data-status={it.status}>
      <div className="flex items-center gap-1.5">
        {busy ? <Spinner className="size-3.5 text-accent" /> : good ? <CircleCheck className="size-3.5 text-ok" /> : it.status === 'failed' ? <CircleX className="size-3.5 text-danger" /> : <CalendarClock className="size-3.5 text-dim" />}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{it.title}</span>
        {it.shortId && (
          <button className="text-[10px] text-accent-2-ink hover:underline" onClick={() => navigate(it.shortId!)}>
            Open
          </button>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 pl-5 text-[10px] text-dim">
        <span className={cn('whitespace-nowrap', it.status === 'failed' && 'text-danger', good && 'text-ok')}>{STATUS[it.status]}</span>
        {it.publishAt && <span className="whitespace-nowrap">{when(it.publishAt)}</span>}
        {it.url && (
          <a className="ml-auto flex items-center gap-0.5 whitespace-nowrap text-accent-2-ink hover:underline" href={it.url} target="_blank" rel="noreferrer">
            YouTube <ExternalLink className="size-2.5" />
          </a>
        )}
      </div>
      {busy && it.progress !== undefined && <ProgressBar className="mt-1.5" value={it.progress} />}
      {(it.error || it.note) && <div className={cn('mt-1 text-[10px] leading-snug', it.error ? 'text-danger' : 'text-muted')}>{it.error ?? it.note}</div>}
    </div>
  );
};

/** The Shorts autopilot: make, render and schedule every found Short in one go. */
export const AutopilotCard: React.FC<{ projectId: string; count: number; disabled: boolean }> = ({ projectId, count, disabled }) => {
  const state = useStudio((s) => s.autopilot);
  const [youtube, setYoutube] = useState<{ connected: boolean; channelTitle: string } | null>(null);
  const [first, setFirst] = useState(() => localInput(nextSlot(new Date())));
  const [every, setEvery] = useState('24');
  const [upload, setUpload] = useState(true);
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .youtubeStatus()
      .then(setYoutube)
      .catch(() => setYoutube({ connected: false, channelTitle: '' }));
  }, []);

  const running = state?.status === 'running';
  const showSetup = !running && (setup || !state);
  const canUpload = Boolean(youtube?.connected);
  const retryable = state && !running && state.items.some((i) => i.status === 'failed' || i.status === 'cancelled');

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      setSetup(false);
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    act(
      () => api.startAutopilot(projectId, { upload: upload && canUpload, firstAt: new Date(first).toISOString(), everyHours: Number(every) }),
      upload && canUpload ? `Autopilot started: ${count} Shorts, one every ${every === '24' ? 'day' : `${every} hours`}` : `Autopilot started: rendering ${count} Shorts`,
    );

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-2.5" data-testid="autopilot">
      <div className="mb-2 flex items-center gap-1.5">
        <Rocket className="size-3.5 text-accent" />
        <span className="flex-1 text-xs font-bold">Autopilot</span>
        {running && (
          <button className="btn btn-sm btn-ghost text-dim" disabled={busy} onClick={() => void act(() => api.stopAutopilot(projectId), 'Stopping after the current step')}>
            <Square className="size-3" /> Stop
          </button>
        )}
      </div>
      {showSetup ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-muted">Makes every Short below, renders them and schedules them on YouTube, best first. Posting on a schedule keeps the channel active without you.</p>
          <label className="flex flex-col gap-1 text-[11px] text-dim">
            First one goes public
            <input type="datetime-local" aria-label="First one goes public" className="field w-full min-w-0 py-1 text-xs" value={first} onChange={(e) => setFirst(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1 text-[11px] text-dim">
            Then one every
            <Segmented size="sm" value={every} onChange={setEvery} options={[{ value: '12', label: '12 hours' }, { value: '24', label: 'day' }, { value: '48', label: '2 days' }]} />
          </div>
          <Switch label={canUpload ? `Upload to YouTube${youtube?.channelTitle ? ` (${youtube.channelTitle})` : ''}` : 'Upload to YouTube'} checked={upload && canUpload} disabled={!canUpload} onChange={setUpload} />
          {youtube && !canUpload && (
            <div className="text-[10px] text-dim">
              <button className="font-semibold text-accent-2-ink hover:underline" onClick={() => useStudio.getState().openSettings('youtube')}>
                Connect YouTube
              </button>{' '}
              to schedule them; until then the autopilot only renders.
            </div>
          )}
          <div className="flex gap-2">
            {state && (
              <button className="btn btn-sm" onClick={() => setSetup(false)}>
                Back
              </button>
            )}
            <button className="btn btn-sm btn-primary flex-1 justify-center" disabled={busy || disabled || count === 0} onClick={() => void start()}>
              {busy ? <Spinner className="size-3.5" /> : <Rocket className="size-3.5" />} {upload && canUpload ? `Schedule ${count} Shorts` : `Render ${count} Shorts`}
            </button>
          </div>
        </div>
      ) : (
        state && (
          <div className="flex flex-col gap-1.5">
            {state.items.map((it) => (
              <Item key={it.momentId} it={it} />
            ))}
            {!running && (
              <div className="mt-1 flex gap-2">
                {retryable && (
                  <button className="btn btn-sm flex-1 justify-center" disabled={busy} onClick={() => void act(() => api.startAutopilot(projectId, { retry: true }), 'Running the rest again')}>
                    <RotateCcw className="size-3" /> Retry the rest
                  </button>
                )}
                <button className="btn btn-sm flex-1 justify-center" onClick={() => setSetup(true)}>
                  <Rocket className="size-3" /> New run
                </button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
};

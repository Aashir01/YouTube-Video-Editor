import React, { useEffect, useState } from 'react';
import { Popover } from 'radix-ui';
import { ArrowLeft, ChevronDown, CircleCheck, CircleX, CloudCheck, Download, Monitor, Redo2, Search, Settings, Smartphone, Square, Undo2, WifiOff } from 'lucide-react';
import { ASPECTS, aspectOf, type Aspect } from '../../../shared/timeline';
import { useStudio } from '../../lib/store';
import { navigate } from '../../lib/nav';
import { cn, modKey } from '../../lib/utils';
import { Logo } from '../icons';
import { CreditMeter } from '../CreditMeter';
import { IconBtn, Menu, ProgressBar, Spinner, Tip } from '../ui';

const ProjectName: React.FC = () => {
  const name = useStudio((s) => s.project?.name ?? '');
  const edit = useStudio((s) => s.edit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft.trim() !== name) void edit([{ op: 'renameProject', name: draft.trim() }], 'Rename project');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(name);
            setEditing(false);
          }
        }}
        className="field w-72 py-1 font-semibold"
      />
    );
  }
  return (
    <button
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      className="max-w-[340px] truncate rounded-md px-2 py-1 font-semibold hover:bg-panel-3"
      title="Rename"
    >
      {name}
    </button>
  );
};

const FormatMenu: React.FC = () => {
  const canvas = useStudio((s) => s.project!.canvas);
  const edit = useStudio((s) => s.edit);
  const aspect = aspectOf(canvas.width, canvas.height);
  const set = (a: Aspect) => void edit([{ op: 'setCanvas', patch: { ...ASPECTS[a] } }], `Change format to ${a}`);
  const portrait = canvas.height > canvas.width;
  return (
    <Menu
      align="start"
      trigger={
        <button className="btn btn-sm border-line bg-panel-3/60 font-mono text-[11px] text-muted hover:text-text" title="Canvas format">
          {portrait ? <Smartphone className="size-3.5 text-hue-pink" /> : <Monitor className="size-3.5 text-hue-sky" />}
          {aspect === 'custom' ? `${canvas.width}×${canvas.height}` : aspect} · {canvas.fps}fps
        </button>
      }
      items={[
        { label: '16:9 — YouTube video (1920×1080)', icon: <Monitor />, onSelect: () => set('16:9') },
        { label: '9:16 — YouTube Short (1080×1920)', icon: <Smartphone />, onSelect: () => set('9:16') },
        { label: '1:1 — Square (1080×1080)', icon: <Square />, onSelect: () => set('1:1') },
        { label: '4:5 — Portrait (1080×1350)', icon: <Smartphone />, onSelect: () => set('4:5') },
        'separator',
        { label: '24 fps', onSelect: () => void edit([{ op: 'setCanvas', patch: { fps: 24 } }], 'Set 24 fps') },
        { label: '30 fps', onSelect: () => void edit([{ op: 'setCanvas', patch: { fps: 30 } }], 'Set 30 fps') },
        { label: '60 fps', onSelect: () => void edit([{ op: 'setCanvas', patch: { fps: 60 } }], 'Set 60 fps') },
      ]}
    />
  );
};

const Activity: React.FC = () => {
  const jobs = useStudio((s) => s.jobs);
  const renders = useStudio((s) => s.project?.renders ?? []);
  const active = renders.filter((r) => ['queued', 'bundling', 'rendering', 'finishing'].includes(r.status));
  const list = Object.values(jobs).sort((a, b) => b.at - a.at);
  const running = list.filter((j) => j.status === 'running').length + active.length;
  if (list.length === 0 && active.length === 0) return null;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="btn btn-ghost btn-sm text-muted">
          {running > 0 ? <Spinner className="size-3.5 text-accent" /> : <CircleCheck className="size-3.5 text-ok" />}
          {running > 0 ? `${running} task${running === 1 ? '' : 's'} running` : 'Done'}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="glass-pop z-[90] w-80 rounded-xl p-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Activity</div>
          <div className="flex flex-col gap-2.5">
            {active.map((r) => (
              <div key={r.id}>
                <div className="flex justify-between text-xs">
                  <span>Rendering ({r.preset})</span>
                  <span className="tabular-nums text-muted">{Math.round(r.progress * 100)}%</span>
                </div>
                <ProgressBar value={r.progress} className="mt-1" />
              </div>
            ))}
            {list.map((j) => (
              <div key={j.id}>
                <div className="flex items-center gap-1.5 text-xs">
                  {j.status === 'running' ? <Spinner className="size-3" /> : j.status === 'done' ? <CircleCheck className="size-3 text-ok" /> : <CircleX className="size-3 text-danger" />}
                  <span className="flex-1 truncate">{j.label}</span>
                  {j.progress !== undefined && <span className="tabular-nums text-muted">{Math.round(j.progress * 100)}%</span>}
                </div>
                {j.detail && <div className="mt-0.5 truncate pl-4.5 text-[11px] text-dim">{j.detail}</div>}
                {j.status === 'running' && j.progress !== undefined && <ProgressBar value={j.progress} className="mt-1" />}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

/** Undo history: jump back several steps at once. */
const HistoryMenu: React.FC = () => {
  const past = useStudio((s) => s.history.past ?? []);
  const undoSteps = useStudio((s) => s.undoSteps);
  if (past.length === 0) return null;
  return (
    <Popover.Root>
      <Tip label="Undo history">
        <Popover.Trigger asChild>
          <button className="-ml-1 rounded-md p-0.5 text-dim hover:bg-panel-3 hover:text-text" aria-label="Undo history">
            <ChevronDown className="size-3" />
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="glass-pop z-[90] w-72 rounded-xl p-1">
          <div className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-dim">Undo back to…</div>
          <div className="max-h-80 overflow-y-auto">
            {past.map((label, i) => (
              <Popover.Close asChild key={i}>
                <button onClick={() => void undoSteps(i + 1)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted hover:bg-panel-3 hover:text-text">
                  <Undo2 className="size-3.5 shrink-0 text-accent-2-ink" />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="shrink-0 text-[10px] text-dim">{i === 0 ? 'last' : `${i + 1} steps`}</span>
                </button>
              </Popover.Close>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

/** Saving… / Saved: every edit is persisted on the server as it happens. */
const SaveState: React.FC = () => {
  const unsaved = useStudio((s) => s.unsaved);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (unsaved > 0) return setShow(true);
    const t = setTimeout(() => setShow(false), 2500);
    return () => clearTimeout(t);
  }, [unsaved]);
  return (
    <span className={cn('ml-1.5 flex items-center gap-1 text-[11px] transition-opacity', show ? 'opacity-100' : 'opacity-0')} aria-live="polite">
      {unsaved > 0 ? (
        <>
          <Spinner className="size-3 text-dim" /> <span className="text-dim">Saving…</span>
        </>
      ) : (
        <>
          <CloudCheck className="size-3.5 text-ok" /> <span className="text-dim">Saved</span>
        </>
      )}
    </span>
  );
};

export const TopBar: React.FC = () => {
  const history = useStudio((s) => s.history);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const connected = useStudio((s) => s.connected);
  const openSettings = useStudio((s) => s.openSettings);
  const setExportOpen = useStudio((s) => s.setExportOpen);
  const renders = useStudio((s) => s.project?.renders ?? []);
  const rendering = renders.find((r) => ['queued', 'bundling', 'rendering', 'finishing'].includes(r.status));

  return (
    <header className="relative z-20 flex h-[52px] shrink-0 items-center gap-1 px-3">
      <Tip label="All projects">
        <button className="group flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-panel-3" onClick={() => navigate(null)}>
          <ArrowLeft className="size-4 text-muted transition-transform group-hover:-translate-x-0.5" />
          <Logo className="size-6 drop-shadow-[0_2px_8px_rgb(255_90_31/0.35)]" />
        </button>
      </Tip>
      <div className="mx-0.5 h-5 w-px bg-line" />
      <ProjectName />
      <FormatMenu />
      <div className="mx-1 h-5 w-px bg-line" />
      <IconBtn label="Undo" shortcut={`${modKey}Z`} disabled={!history.canUndo} onClick={() => void undo()}>
        <Undo2 className="size-4" />
      </IconBtn>
      <HistoryMenu />
      <IconBtn label="Redo" shortcut={`⇧${modKey}Z`} disabled={!history.canRedo} onClick={() => void redo()}>
        <Redo2 className="size-4" />
      </IconBtn>
      <SaveState />
      {!connected && (
        <span className="ml-2 flex items-center gap-1 text-xs text-warn" title="Live updates are reconnecting">
          <WifiOff className="size-3.5" /> Reconnecting…
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('cutroom:palette'))}
        className="mr-1 hidden h-8 w-64 items-center gap-2 rounded-lg border border-line bg-black/25 px-2.5 text-xs text-dim transition-colors hover:border-line-2 hover:text-muted lg:flex"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search or ask the Director…</span>
        <kbd className="rounded border border-line-2 px-1 font-mono text-[10px]">{modKey}K</kbd>
      </button>
      <Activity />
      <CreditMeter />
      <IconBtn label="Settings" onClick={() => openSettings()}>
        <Settings className="size-4" />
      </IconBtn>
      <button className={cn('btn btn-primary ml-1 px-3.5', rendering && 'opacity-90')} onClick={() => setExportOpen(true)}>
        {rendering ? <Spinner className="size-4" /> : <Download className="size-4" />}
        {rendering ? `Rendering ${Math.round(rendering.progress * 100)}%` : 'Export'}
      </button>
    </header>
  );
};

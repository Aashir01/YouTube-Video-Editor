import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Bot, SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { player } from '../../lib/player';
import { prefs } from '../../lib/prefs';
import { navigate } from '../../lib/nav';
import { cn, clamp, errorText, isTypingTarget } from '../../lib/utils';
import { takeKickoff } from '../home/Home';
import { deleteSelection, duplicateSelection, splitAtPlayhead } from '../../lib/actions';
import { Empty, Spinner } from '../ui';
import { TopBar } from './TopBar';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { LeftPanel } from './LeftPanel';
import { Inspector } from './Inspector';
import { ChatPanel } from '../chat/ChatPanel';
import { ExportDialog } from './ExportDialog';

/** Drag handle between panels. */
const Resizer: React.FC<{ dir: 'x' | 'y'; onDrag: (delta: number) => void; className?: string }> = ({ dir, onDrag, className }) => (
  <div
    className={cn('group relative z-10 shrink-0', dir === 'x' ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize', className)}
    onPointerDown={(e) => {
      e.preventDefault();
      let last = dir === 'x' ? e.clientX : e.clientY;
      const move = (ev: PointerEvent) => {
        const cur = dir === 'x' ? ev.clientX : ev.clientY;
        onDrag(cur - last);
        last = cur;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = dir === 'x' ? 'col-resize' : 'row-resize';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }}
  >
    <div className={cn('absolute rounded-full bg-accent opacity-0 shadow-[0_0_10px_rgb(255_90_31/0.8)] transition-opacity group-hover:opacity-80', dir === 'x' ? 'inset-y-6 left-1/2 w-0.5 -translate-x-1/2' : 'inset-x-6 top-1/2 h-0.5 -translate-y-1/2')} />
  </div>
);

const useShortcuts = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStudio.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        s.focusComposer();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        void (e.shiftKey ? s.redo() : s.undo());
      } else if (mod && key === 'y') {
        e.preventDefault();
        void s.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && key === 'e') {
        e.preventDefault();
        s.setExportOpen(true);
      } else if (mod && key === 'b') {
        e.preventDefault();
        splitAtPlayhead();
      } else if (mod) {
        return;
      } else if (e.key === ' ') {
        e.preventDefault();
        player.toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        player.step(dir * (e.shiftKey ? player.fps : 1));
      } else if (e.key === 'Home') {
        player.seek(0);
      } else if (e.key === 'End') {
        player.toEnd();
      } else if (key === 's') {
        splitAtPlayhead();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection(e.shiftKey);
      } else if (e.key === 'Escape') {
        s.select([]);
      } else if (e.key === '=' || e.key === '+') {
        useStudio.setState({ autoFit: false });
        s.setZoom(clamp((s.zoom || 40) * 1.25, 2, 600));
      } else if (e.key === '-') {
        useStudio.setState({ autoFit: false });
        s.setZoom(clamp((s.zoom || 40) / 1.25, 2, 600));
      } else if (e.key === '/') {
        e.preventDefault();
        s.focusComposer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
};

export const Editor: React.FC<{ projectId: string }> = ({ projectId }) => {
  const openProject = useStudio((s) => s.openProject);
  const closeProject = useStudio((s) => s.closeProject);
  const project = useStudio((s) => s.project);
  const loadError = useStudio((s) => s.loadError);
  const rightTab = useStudio((s) => s.rightTab);
  const setRightTab = useStudio((s) => s.setRightTab);
  const busy = useStudio((s) => s.chat.state.status !== 'idle' && s.chat.state.status !== 'error');
  const selectionCount = useStudio((s) => s.selection.length);

  const [leftW, setLeftW] = useState(() => prefs.get('leftW', 300));
  const [rightW, setRightW] = useState(() => prefs.get('rightW', 400));
  const [timelineH, setTimelineH] = useState(() => prefs.get('timelineH', 290));
  const kicked = useRef(false);

  useShortcuts();
  useEffect(() => prefs.set('leftW', leftW), [leftW]);
  useEffect(() => prefs.set('rightW', rightW), [rightW]);
  useEffect(() => prefs.set('timelineH', timelineH), [timelineH]);

  useEffect(() => {
    void openProject(projectId);
    return () => closeProject();
  }, [projectId, openProject, closeProject]);

  useEffect(() => {
    if (project) document.title = `${project.name} — Cutroom`;
  }, [project?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // send the topic typed on the home screen as the first message
  const system = useStudio((s) => s.system);
  useEffect(() => {
    if (!project || !system || kicked.current) return;
    kicked.current = true;
    const text = takeKickoff(projectId);
    if (!text) return;
    if (system.llm) {
      api.sendChat(projectId, text).catch((err) => toast.error(errorText(err)));
    } else {
      useStudio.setState({ composerPrefill: text });
      toast.info('Connect an AI model in Settings, then send your brief to the Director.');
      useStudio.getState().openSettings('models');
    }
  }, [project, system, projectId]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty title="Could not open this project">
          {loadError}
          <div className="mt-4">
            <button className="btn" onClick={() => navigate(null)}>
              <ArrowLeft className="size-4" /> Back to projects
            </button>
          </div>
        </Empty>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6 text-dim" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      {/* floating glass panels with gutters (the gutters are the resize handles) */}
      <div className="flex min-h-0 flex-1 px-2 pb-2">
        <div style={{ width: leftW }} className="glass flex min-w-0 shrink-0 flex-col overflow-hidden rounded-2xl">
          <LeftPanel />
        </div>
        <Resizer dir="x" onDrag={(d) => setLeftW((w) => clamp(w + d, 240, 520))} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="glass min-h-0 flex-1 overflow-hidden rounded-2xl">
            <Preview />
          </div>
          <Resizer dir="y" onDrag={(d) => setTimelineH((h) => clamp(h - d, 150, window.innerHeight * 0.7))} />
          <div style={{ height: timelineH }} className="glass shrink-0 overflow-hidden rounded-2xl">
            <Timeline />
          </div>
        </div>
        <Resizer dir="x" onDrag={(d) => setRightW((w) => clamp(w - d, 320, 720))} />
        <div style={{ width: rightW }} className="glass flex min-w-0 shrink-0 flex-col overflow-hidden rounded-2xl">
          <div className="flex shrink-0 items-center gap-1 border-b border-line bg-white/[0.02] px-2 py-1.5">
            <TabButton active={rightTab === 'director'} onClick={() => setRightTab('director')}>
              <Bot className={cn('size-4', rightTab === 'director' && 'text-accent-2')} /> Director
              {busy && rightTab !== 'director' && <span className="typing-dot size-1.5 rounded-full bg-accent-2" />}
            </TabButton>
            <TabButton active={rightTab === 'inspector'} onClick={() => setRightTab('inspector')}>
              <SlidersHorizontal className={cn('size-4', rightTab === 'inspector' && 'text-hue-sky')} /> Inspector
              {selectionCount > 0 && <span className="rounded-full bg-panel-3 px-1.5 text-[10px] text-muted">{selectionCount}</span>}
            </TabButton>
          </div>
          <div className="min-h-0 flex-1">{rightTab === 'director' ? <ChatPanel /> : <Inspector />}</div>
        </div>
      </div>
      <ExportDialog />
    </div>
  );
};

export const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; className?: string }> = ({ active, onClick, children, className }) => (
  <button
    onClick={onClick}
    className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-semibold text-muted transition-colors hover:bg-panel-2 hover:text-text', active && 'bg-white/[0.09] text-text shadow-sm shadow-black/30 ring-1 ring-white/[0.1]', className)}
  >
    {children}
  </button>
);

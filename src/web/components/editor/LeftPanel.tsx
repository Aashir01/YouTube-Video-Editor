import React from 'react';
import { Film, Music, Palette, ScrollText, Sparkles } from 'lucide-react';
import { useStudio, type LeftTab } from '../../lib/store';
import { cn } from '../../lib/utils';
import { MediaPanel } from './panels/MediaPanel';
import { GraphicsPanel } from './panels/GraphicsPanel';
import { AudioPanel } from './panels/AudioPanel';
import { ScriptPanel } from './panels/ScriptPanel';
import { ProjectPanel } from './panels/ProjectPanel';

// each area has its own hue (the same one the timeline uses for its clips)
const TABS: { id: LeftTab; label: string; icon: React.ElementType; hue: string; bar: string }[] = [
  { id: 'media', label: 'Media', icon: Film, hue: 'text-hue-sky', bar: 'bg-hue-sky' },
  { id: 'graphics', label: 'Graphics', icon: Sparkles, hue: 'text-hue-violet', bar: 'bg-hue-violet' },
  { id: 'audio', label: 'Audio', icon: Music, hue: 'text-hue-green', bar: 'bg-hue-green' },
  { id: 'script', label: 'Script', icon: ScrollText, hue: 'text-hue-amber', bar: 'bg-hue-amber' },
  { id: 'brand', label: 'Project', icon: Palette, hue: 'text-hue-pink', bar: 'bg-hue-pink' },
];

export const LeftPanel: React.FC = () => {
  const tab = useStudio((s) => s.leftTab);
  const setTab = useStudio((s) => s.setLeftTab);
  const assetCount = useStudio((s) => s.project?.assets.length ?? 0);
  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-[66px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-black/20 py-2.5">
        {TABS.map(({ id, label, icon: Icon, hue, bar }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn('group relative flex w-[58px] flex-col items-center gap-1 rounded-xl py-1 text-[10px] font-semibold text-dim transition-colors hover:text-text', tab === id && 'text-text')}
          >
            {tab === id && <span className={cn('absolute -left-1 top-2 bottom-6 w-[3px] rounded-r-full', bar)} />}
            <span className={cn('flex size-9 items-center justify-center rounded-[10px] transition-all', tab === id ? cn('tile shadow-[0_4px_16px_-6px_currentColor]', hue) : 'group-hover:bg-panel-3')}>
              <Icon className={cn('size-[18px] transition-all', tab !== id && cn(hue, 'opacity-60 group-hover:opacity-100'))} />
            </span>
            {label}
            {id === 'media' && assetCount > 0 && <span className="absolute right-0 top-0 rounded-full bg-hue-sky px-1 text-[9px] font-bold text-[#04121c]">{assetCount}</span>}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {tab === 'media' && <MediaPanel />}
        {tab === 'graphics' && <GraphicsPanel />}
        {tab === 'audio' && <AudioPanel />}
        {tab === 'script' && <ScriptPanel />}
        {tab === 'brand' && <ProjectPanel />}
      </div>
    </div>
  );
};

export const PanelHeader: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-white/[0.02] px-3">
    <span className="flex-1 text-[14px] font-bold tracking-tight">{title}</span>
    {children}
  </div>
);

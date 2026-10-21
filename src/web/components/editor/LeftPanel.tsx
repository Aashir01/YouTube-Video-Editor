import React from 'react';
import { Film, Music, Palette, ScrollText, Sparkles } from 'lucide-react';
import { useStudio, type LeftTab } from '../../lib/store';
import { cn } from '../../lib/utils';
import { MediaPanel } from './panels/MediaPanel';
import { GraphicsPanel } from './panels/GraphicsPanel';
import { AudioPanel } from './panels/AudioPanel';
import { ScriptPanel } from './panels/ScriptPanel';
import { ProjectPanel } from './panels/ProjectPanel';

const TABS: { id: LeftTab; label: string; icon: React.ElementType }[] = [
  { id: 'media', label: 'Media', icon: Film },
  { id: 'graphics', label: 'Graphics', icon: Sparkles },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'script', label: 'Script', icon: ScrollText },
  { id: 'brand', label: 'Project', icon: Palette },
];

export const LeftPanel: React.FC = () => {
  const tab = useStudio((s) => s.leftTab);
  const setTab = useStudio((s) => s.setLeftTab);
  const assetCount = useStudio((s) => s.project?.assets.length ?? 0);
  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line py-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn('relative flex w-12 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold text-dim transition-colors hover:bg-panel-2 hover:text-text', tab === id && 'bg-panel-3 text-text')}
          >
            <Icon className={cn('size-[18px]', tab === id && 'text-accent')} />
            {label}
            {id === 'media' && assetCount > 0 && <span className="absolute right-1 top-0.5 rounded-full bg-panel-3 px-1 text-[9px] text-muted">{assetCount}</span>}
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
  <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
    <span className="flex-1 text-[13px] font-bold">{title}</span>
    {children}
  </div>
);

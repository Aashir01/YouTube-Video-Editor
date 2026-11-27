import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Bot, Clock, CornerDownLeft, Film, Search } from 'lucide-react';
import { clipLabel, useStudio } from '../../lib/store';
import { player } from '../../lib/player';
import { prefs } from '../../lib/prefs';
import { AI_ACTIONS, askDirector, buildCommands, commandSearchText, fuzzy, parseTime } from '../../lib/commands';
import { cn, formatClock } from '../../lib/utils';
import { ClipIcon } from '../icons';

interface Item {
  id: string;
  title: string;
  group: string;
  icon: React.ReactNode;
  run: () => void;
  shortcut?: string;
  hint?: string;
  score: number;
}

const RECENT_KEY = 'recentCommands';

/** Ctrl/⌘+K: run any command, jump to a time, find a clip, or ask the Director. */
export const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener('cutroom:palette', toggle);
    return () => window.removeEventListener('cutroom:palette', toggle);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const items = useMemo((): Item[] => {
    if (!open) return [];
    const query = q.trim();
    const commands = buildCommands();
    const out: Item[] = [];
    const t = parseTime(query);
    if (t !== null) out.push({ id: 'goto', title: `Go to ${formatClock(t)}${t % 1 ? `.${String(Math.round((t % 1) * 100)).padStart(2, '0')}` : ''}`, group: 'Go to', icon: <Clock />, run: () => player.seek(t), score: 5000 });
    if (!query) {
      const recent: string[] = prefs.get(RECENT_KEY, []);
      for (const id of recent) {
        const c = commands.find((x) => x.id === id);
        if (c) out.push({ id: c.id, title: c.title, group: 'Recent', icon: <c.icon />, run: c.run, shortcut: c.shortcut, score: 0 });
      }
      for (const a of AI_ACTIONS.slice(0, 6)) out.push({ id: `ai-${a.id}`, title: a.title, hint: a.hint, group: 'Ask the Director', icon: <a.icon />, run: () => askDirector(a.prompt), score: 0 });
      for (const c of commands.filter((x) => ['split', 'paste', 'marker', 'add-title', 'add-captions', 'rec-voice', 'export', 'shortcuts'].includes(x.id))) {
        if (!out.some((o) => o.id === c.id)) out.push({ id: c.id, title: c.title, group: 'Suggested', icon: <c.icon />, run: c.run, shortcut: c.shortcut, score: 0 });
      }
      return out;
    }
    if (t === null && query.length > 2) out.push({ id: 'ask', title: `Ask the Director: “${query}”`, group: 'Director', icon: <Bot />, run: () => askDirector(query), score: 50 });
    for (const a of AI_ACTIONS) {
      const s = fuzzy(query, `${a.title} ${a.hint}`);
      if (s > 0) out.push({ id: `ai-${a.id}`, title: a.title, hint: a.hint, group: 'Director', icon: <a.icon />, run: () => askDirector(a.prompt), score: s + 30 });
    }
    for (const c of commands) {
      const s = Math.max(fuzzy(query, c.title) + 40, fuzzy(query, commandSearchText(c)));
      if (s > 0) out.push({ id: c.id, title: c.title, group: c.group, icon: <c.icon />, run: c.run, shortcut: c.shortcut, score: s });
    }
    const { project } = useStudio.getState();
    if (project) {
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          const label = clipLabel(clip, project);
          const s = fuzzy(query, `${label} ${clip.type}`);
          if (s <= 0) continue;
          out.push({
            id: `clip-${clip.id}`,
            title: label,
            hint: `${track.name} · ${formatClock(clip.start)}`,
            group: 'Clip',
            icon: <ClipIcon clip={clip} className="size-4" />,
            run: () => {
              useStudio.getState().select([clip.id]);
              useStudio.getState().setRightTab('inspector');
              player.seek(clip.start + 0.001);
            },
            score: s - 20,
          });
        }
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }, [open, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (it: Item) => {
    setOpen(false);
    if (!it.id.startsWith('clip-') && it.id !== 'goto' && it.id !== 'ask') {
      const recent: string[] = prefs.get(RECENT_KEY, []);
      prefs.set(RECENT_KEY, [it.id, ...recent.filter((x) => x !== it.id)].slice(0, 5));
    }
    // let the dialog close (and give focus back) before running
    setTimeout(it.run, 30);
  };

  const grouped = !q.trim();
  let lastGroup = '';
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-[#03040a]/40 backdrop-blur-[3px]" />
        <Dialog.Content className="glass-pop fixed left-1/2 top-[12vh] z-[81] flex w-[min(640px,94vw)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl outline-none" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4.5 shrink-0 text-accent" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(items.length - 1, a + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const it = items[active];
                  if (it) run(it);
                }
              }}
              placeholder="Type a command, find a clip, go to 1:23, or ask the Director…"
              className="h-13 w-full bg-transparent text-[15px] outline-none placeholder:text-dim focus-visible:outline-none"
            />
          </div>
          <div ref={list} className="max-h-[56vh] overflow-y-auto p-1.5">
            {items.length === 0 && <div className="px-3 py-8 text-center text-xs text-dim">Nothing matches. Press Enter on “Ask the Director” to hand it over.</div>}
            {items.map((it, i) => {
              const header = grouped && it.group !== lastGroup;
              lastGroup = it.group;
              return (
                <React.Fragment key={it.id}>
                  {header && <div className="px-2.5 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-dim">{it.group}</div>}
                  <button
                    data-index={i}
                    onMouseMove={() => active !== i && setActive(i)}
                    onClick={() => run(it)}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px]', i === active ? 'bg-white/[0.09] text-text' : 'text-muted')}
                  >
                    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5', it.group === 'Director' || it.group === 'Ask the Director' ? 'bg-accent-2/15 text-accent-2-ink' : 'bg-panel-3 text-muted')}>{it.icon}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {it.title}
                      {it.hint && <span className="ml-2 text-[11px] text-dim">{it.hint}</span>}
                    </span>
                    {!grouped && <span className="shrink-0 text-[10px] text-dim">{it.group}</span>}
                    {it.shortcut && <kbd className="shrink-0 rounded border border-line-2 bg-panel-2 px-1.5 font-mono text-[10px] text-muted">{it.shortcut}</kbd>}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10px] text-dim">
            <span>↑↓ to move</span>
            <span className="flex items-center gap-1">
              <CornerDownLeft className="size-3" /> to run
            </span>
            <span>esc to close</span>
            <span className="flex-1" />
            <Film className="size-3" /> clips · times · commands · Director
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

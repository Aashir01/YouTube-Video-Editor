import React, { useEffect, useState } from 'react';
import { isMac } from '../../lib/utils';
import { Modal } from '../ui';

const M = isMac ? '⌘' : 'Ctrl';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Playback',
    rows: [
      ['Space', 'Play / pause'],
      ['J · K · L', 'Reverse · pause · forward (again: 2×, 4×, 8×)'],
      ['← / →', 'Previous / next frame'],
      ['⇧ ← / →', 'Back / forward one second'],
      ['↑ / ↓', 'Previous / next edit point'],
      ['Home / End', 'Start / end'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['S  or  ' + M + ' B', 'Split at playhead'],
      ['Q / W', 'Ripple-trim clip start / end to playhead'],
      ['⌫', 'Delete selected'],
      ['⇧ ⌫', 'Ripple delete (close the gap)'],
      [`${M} D`, 'Duplicate'],
      [`${M} C · X · V`, 'Copy · cut · paste at playhead'],
      [`${M} A`, 'Select all clips'],
      ['Alt ← / →', 'Nudge clips one frame (⇧: 10)'],
      [`${M} Z · ${M} ⇧ Z`, 'Undo · redo'],
    ],
  },
  {
    title: 'Markers & range',
    rows: [
      ['M', 'Add marker'],
      ['I / O', 'Mark in / out'],
      ['Alt X', 'Clear in/out range'],
    ],
  },
  {
    title: 'Preview canvas',
    rows: [
      ['Click', 'Select what is under the pointer'],
      ['Drag', 'Move (full-frame media: pan the crop)'],
      ['Handles', 'Resize (corners keep aspect; ⇧ frees it)'],
      ['Arrows', 'Nudge 0.5% (⇧ 5%, Alt fine)'],
      ['Double-click', 'Edit text in the Inspector'],
    ],
  },
  {
    title: 'Timeline & text',
    rows: [
      ['Drag on empty space', 'Rubber-band select (⇧ adds)'],
      [`${M} wheel · + / −`, 'Zoom'],
      ['\\', 'Zoom to fit'],
      ['Drag the volume line', 'Clip volume (fade handles at the ends)'],
      ['Transcript: drag + ⌫', 'Cut words from the video'],
    ],
  },
  {
    title: 'App',
    rows: [
      [`${M} K`, 'Command palette: commands, clips, times, the Director'],
      ['/', 'Message the Director'],
      [`${M} E`, 'Export & publish'],
      ['?', 'This sheet'],
    ],
  },
];

export const ShortcutsDialog: React.FC = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('cutroom:shortcuts', show);
    return () => window.removeEventListener('cutroom:shortcuts', show);
  }, []);
  return (
    <Modal open={open} onOpenChange={setOpen} title="Keyboard shortcuts" description="Work at the speed of a pro editor." className="w-[min(920px,96vw)]">
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="label mb-2">{g.title}</h3>
            <div className="flex flex-col gap-1.5">
              {g.rows.map(([keys, what]) => (
                <div key={keys + what} className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-muted">{what}</span>
                  <kbd className="shrink-0 rounded-md border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-text">{keys}</kbd>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
};

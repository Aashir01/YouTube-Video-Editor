import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Captions, Clock, Copy, CornerDownLeft, Mic, Play, Scissors, Search, Smartphone, SquareDashedMousePointer, Wand } from 'lucide-react';
import type { Word } from '../../../../shared/schema';
import { fillerRanges, formatTime, isFiller, pauseRanges, rangesDuration, speechClips, timelineWordsDetailed, type TimelineWord } from '../../../../shared/timeline';
import { api } from '../../../lib/api';
import { useStudio } from '../../../lib/store';
import { player } from '../../../lib/player';
import { cutRanges, makeShort } from '../../../lib/actions';
import { cn, copyText, errorText, formatClock } from '../../../lib/utils';
import { Empty, Spinner, Tip } from '../../ui';
import { PanelHeader } from '../LeftPanel';

/**
 * Edit the video by editing its words: click a word to jump there, drag across words
 * to select, Delete to cut them (gaps close, other tracks stay in sync), double-click
 * a word to fix a transcription mistake. Fillers and long pauses can go in one click.
 */

const PARAGRAPH_GAP = 1.1;
const PAUSE_SHOWN = 0.6;

interface Para {
  start: number;
  words: { w: TimelineWord; i: number; gapBefore: number }[];
}

const toParagraphs = (words: TimelineWord[]): Para[] => {
  const out: Para[] = [];
  let cur: Para | null = null;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const gap = prev ? w.start - prev.end : 0;
    const sentenceEnd = prev && /[.!?…]["')\]]?$/.test(prev.text.trim());
    if (!cur || gap > PARAGRAPH_GAP || (sentenceEnd && gap > 0.6 && cur.words.length > 25)) {
      cur = { start: w.start, words: [] };
      out.push(cur);
    }
    cur.words.push({ w, i, gapBefore: gap });
  });
  return out;
};

export const TranscriptPanel: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const transcripts = useStudio((s) => s.transcripts);
  const words = useMemo(() => timelineWordsDetailed(project, transcripts), [project, transcripts]);
  const paras = useMemo(() => toParagraphs(words), [words]);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const spans = useRef(new Map<number, HTMLSpanElement>());
  const scroller = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const fillers = useMemo(() => fillerRanges(words), [words]);
  const pauses = useMemo(() => pauseRanges(words, 0.7, 0.3), [words]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return new Set<number>();
    return new Set(words.flatMap((w, i) => (w.text.toLowerCase().includes(q) ? [i] : [])));
  }, [words, query]);

  // karaoke highlight without re-rendering the whole transcript every frame
  useEffect(() => {
    let active = -1;
    const find = (t: number) => {
      let lo = 0;
      let hi = words.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const w = words[mid]!;
        if (t < w.start) hi = mid - 1;
        else if (t >= w.end) lo = mid + 1;
        else return mid;
      }
      return -1;
    };
    const apply = (t: number) => {
      const i = find(t);
      if (i === active) return;
      spans.current.get(active)?.classList.remove('bg-accent', 'text-white');
      active = i;
      const el = spans.current.get(i);
      if (!el) return;
      el.classList.add('bg-accent', 'text-white');
      if (useStudio.getState().playing) el.scrollIntoView({ block: 'nearest' });
    };
    apply(useStudio.getState().time);
    return useStudio.subscribe((s, prev) => s.time !== prev.time && apply(s.time));
  }, [words]);

  useEffect(() => {
    const up = () => (dragging.current = null);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const selRange = sel ? ([Math.min(sel[0], sel[1]), Math.max(sel[0], sel[1])] as [number, number]) : null;
  const selWords = selRange ? words.slice(selRange[0], selRange[1] + 1) : [];
  const selTime: [number, number] | null = selWords.length ? [selWords[0]!.start, selWords[selWords.length - 1]!.end] : null;

  const deleteSelection = async () => {
    if (!selTime) return;
    const ok = await cutRanges([selTime], selWords.length === 1 ? `Cut "${selWords[0]!.text}"` : `Cut ${selWords.length} words`);
    if (ok) {
      setSel(null);
      player.seek(selTime[0]);
    }
  };

  // Delete / Backspace cuts the selected words while the transcript has focus
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing !== null) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selTime) {
      e.preventDefault();
      e.stopPropagation();
      void deleteSelection();
    } else if (e.key === 'Escape') {
      setSel(null);
      e.stopPropagation();
    }
  };

  const fixWord = async (w: TimelineWord, text: string) => {
    setEditing(null);
    const clean = text.trim();
    if (!clean || clean === w.text) return;
    const src = transcripts[w.assetId];
    if (!src?.[w.index]) return;
    const next: Word[] = src.map((x, i) => (i === w.index ? { ...x, text: clean } : x));
    useStudio.setState({ transcripts: { ...transcripts, [w.assetId]: next } });
    try {
      await api.saveTranscript(project.id, w.assetId, next);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const transcribeAll = async () => {
    const ids = [...new Set(speechClips(project).map((c) => c.assetId))].filter((id) => {
      const a = project.assets.find((x) => x.id === id);
      return a && a.transcript.status !== 'done' && a.transcript.status !== 'pending';
    });
    if (ids.length === 0) return toast('Everything on the timeline is already transcribed or in progress.');
    setBusy(true);
    try {
      for (const id of ids) await api.transcribe(project.id, id);
      toast.success(`Transcribing ${ids.length} clip${ids.length === 1 ? '' : 's'}…`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const speechAssets = [...new Set(speechClips(project).map((c) => c.assetId))].map((id) => project.assets.find((a) => a.id === id)).filter(Boolean);
  const pending = speechAssets.some((a) => a!.transcript.status === 'pending');
  const duration = words.length ? words[words.length - 1]!.end - words[0]!.start : 0;
  const wpm = duration > 10 ? Math.round((words.length / duration) * 60) : 0;

  if (words.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Transcript" />
        <Empty icon={<Captions className="size-6" />} title={speechAssets.length ? (pending ? 'Transcribing…' : 'No transcript yet') : 'No speech on the timeline'}>
          {speechAssets.length ? (
            <>
              Transcribe the footage and voiceover on the timeline, then edit the video by editing its words: select text and press Delete to cut it.
              <div className="mt-4">
                <button className="btn btn-primary" disabled={busy || pending} onClick={() => void transcribeAll()}>
                  {busy || pending ? <Spinner /> : <Mic className="size-4" />} {pending ? 'Transcribing…' : 'Transcribe the timeline'}
                </button>
              </div>
            </>
          ) : (
            'Add footage or a voiceover to the timeline. Its words show up here, and editing the text edits the video.'
          )}
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <PanelHeader title="Transcript">
        <span className="font-mono text-[10px] text-dim" title="Words · speaking pace">
          {words.length} words{wpm ? ` · ${wpm} wpm` : ''}
        </span>
      </PanelHeader>
      <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <label className="flex items-center gap-2 rounded-lg border border-line bg-black/25 px-2 focus-within:border-accent/70">
          <Search className="size-3.5 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || matches.size === 0) return;
              const t = useStudio.getState().time;
              const list = [...matches].sort((a, b) => a - b);
              const next = list.find((i) => words[i]!.start > t + 0.05) ?? list[0]!;
              player.seek(words[next]!.start);
              spans.current.get(next)?.scrollIntoView({ block: 'center' });
            }}
            placeholder="Find in transcript… (Enter = next)"
            className="w-full bg-transparent py-1.5 text-xs outline-none"
          />
          {query.trim().length >= 2 && <span className="shrink-0 text-[10px] text-dim">{matches.size}</span>}
        </label>
        <div className="flex gap-1.5">
          <Tip label={`Cut every “um”, “uh”… (${rangesDuration(fillers).toFixed(1)}s)`}>
            <button className="btn btn-sm flex-1" disabled={fillers.length === 0} onClick={() => void cutRanges(fillers, `Remove ${fillers.length} filler${fillers.length === 1 ? '' : 's'}`)}>
              <Wand className="size-3.5 text-hue-amber" /> Fillers ({fillers.length})
            </button>
          </Tip>
          <Tip label={`Shorten pauses over 0.7s to 0.3s (saves ${rangesDuration(pauses).toFixed(1)}s)`}>
            <button className="btn btn-sm flex-1" disabled={pauses.length === 0} onClick={() => void cutRanges(pauses, `Tighten ${pauses.length} pause${pauses.length === 1 ? '' : 's'}`)}>
              <Clock className="size-3.5 text-hue-sky" /> Pauses ({pauses.length})
            </button>
          </Tip>
        </div>
      </div>

      {/* the bar keeps its slot so selecting never shifts the text under the pointer */}
      {!selTime && (
        <div className="flex h-9 items-center gap-1.5 border-b border-line px-3 text-[11px] text-dim">
          <CornerDownLeft className="size-3" /> Drag across words, then Delete to cut · double-click to fix a word
        </div>
      )}
      {selTime && (
        <div className="flex h-9 items-center gap-1 border-b border-line bg-accent/10 px-2">
          <span className="min-w-0 flex-1 truncate pl-1 text-[11px] text-accent-ink">
            {selWords.length} word{selWords.length === 1 ? '' : 's'} · {(selTime[1] - selTime[0]).toFixed(2)}s
          </span>
          <Tip label="Play the selection">
            <button
              className="rounded p-1 text-muted hover:bg-panel-3 hover:text-text"
              aria-label="Play selection"
              onClick={() => {
                useStudio.setState({ range: selTime, loopRange: true });
                player.seek(selTime[0]);
                player.play();
              }}
            >
              <Play className="size-3.5" />
            </button>
          </Tip>
          <Tip label="Use as in/out range">
            <button className="rounded p-1 text-muted hover:bg-panel-3 hover:text-text" aria-label="Set range" onClick={() => useStudio.setState({ range: selTime })}>
              <SquareDashedMousePointer className="size-3.5" />
            </button>
          </Tip>
          <Tip label="Make a vertical Short from these words">
            <button className="rounded p-1 text-muted hover:bg-panel-3 hover:text-hue-pink" aria-label="Make a Short" onClick={() => void makeShort([selTime])}>
              <Smartphone className="size-3.5" />
            </button>
          </Tip>
          <Tip label="Copy text">
            <button className="rounded p-1 text-muted hover:bg-panel-3 hover:text-text" aria-label="Copy text" onClick={() => void copyText(selWords.map((w) => w.text).join(' ')).then(() => toast('Copied', { duration: 1000 }))}>
              <Copy className="size-3.5" />
            </button>
          </Tip>
          <button className="btn btn-sm ml-1 border-danger/40 bg-danger/15 text-danger hover:bg-danger/25" onClick={() => void deleteSelection()}>
            <Scissors className="size-3.5" /> Cut
          </button>
        </div>
      )}

      <div ref={scroller} tabIndex={-1} className="min-h-0 flex-1 select-none overflow-y-auto px-3 py-3 outline-none">
        {paras.map((para) => (
          <div key={para.words[0]!.i} className="mb-3">
            <button className="mb-0.5 font-mono text-[10px] text-dim hover:text-accent-ink" onClick={() => player.seek(para.start)}>
              {formatClock(para.start)}
            </button>
            <p className="text-[13px] leading-[1.75] text-text/90">
              {para.words.map(({ w, i, gapBefore }) => {
                const selected = selRange && i >= selRange[0] && i <= selRange[1];
                const filler = isFiller(w.text);
                return (
                  <React.Fragment key={i}>
                    {gapBefore >= PAUSE_SHOWN && i > para.words[0]!.i && (
                      <span className="mx-0.5 inline-block rounded bg-hue-sky/15 px-1 align-middle font-mono text-[9px] leading-4 text-hue-sky" title="Pause">
                        {gapBefore.toFixed(1)}s
                      </span>
                    )}
                    {editing === i ? (
                      <input
                        autoFocus
                        defaultValue={w.text}
                        className="field inline-block w-28 px-1 py-0 text-[13px]"
                        onBlur={(e) => void fixWord(w, e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <span
                        ref={(el) => {
                          if (el) spans.current.set(i, el);
                          else spans.current.delete(i);
                        }}
                        title={`${formatTime(w.start)} · double-click to fix`}
                        className={cn(
                          'cursor-text rounded-[3px] px-[1px] transition-colors hover:bg-panel-3',
                          filler && 'text-hue-amber underline decoration-hue-amber/50 decoration-dotted underline-offset-4',
                          (w.confidence ?? 1) < 0.5 && 'decoration-wavy',
                          matches.has(i) && 'bg-hue-yellow/25 text-text',
                          selected && 'bg-accent-2/35 text-white',
                        )}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          scroller.current?.focus({ preventScroll: true });
                          if (e.shiftKey && sel) setSel([sel[0], i]);
                          else {
                            setSel([i, i]);
                            dragging.current = i;
                          }
                        }}
                        onPointerEnter={() => {
                          if (dragging.current !== null) setSel([dragging.current, i]);
                        }}
                        onClick={(e) => {
                          if (e.shiftKey) return;
                          if (sel && sel[0] === sel[1]) player.seek(w.start);
                        }}
                        onDoubleClick={() => setEditing(i)}
                      >
                        {w.text}
                      </span>
                    )}{' '}
                  </React.Fragment>
                );
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

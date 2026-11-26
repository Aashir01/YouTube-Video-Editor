import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu } from 'radix-ui';
import { toast } from 'sonner';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Bookmark,
  ClipboardPaste,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Maximize2,
  MessageSquareText,
  Plus,
  Repeat,
  Rows3,
  Scissors,
  Smartphone,
  Trash2,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { TRACK_ACCEPTS, type Clip, type Project, type Track } from '../../../shared/schema';
import { clipEnd, conflictsOnTrack, projectDuration } from '../../../shared/timeline';
import { uid } from '../../../shared/ids';
import type { EditOp } from '../../../shared/ops';
import { getClipRef, useStudio } from '../../lib/store';
import { player } from '../../lib/player';
import { prefs } from '../../lib/prefs';
import { addMarkerAtPlayhead, clearRangeMarks, deleteSelection, liftRangeMarks, makeShort, pasteAtPlayhead, rippleDeleteRange, selectForward, splitAtPlayhead } from '../../lib/actions';
import { api } from '../../lib/api';
import { activeDrag, clearDragPayload, DND_TYPE, dropFiles, dropPayload, readDragPayload } from '../../lib/dnd';
import { cn, clamp, formatClock, formatTimecode, modKey } from '../../lib/utils';
import { TrackIcon } from '../icons';
import { IconBtn, Menu, Tip } from '../ui';
import { ClipBlock, type DragMode } from './TimelineClip';

const HEADER_W = 172;
const RULER_H = 26;
const TRACK_H: Record<Track['kind'], number> = { video: 58, overlay: 46, captions: 34, audio: 46 };
/** Header icon color, matching the clips on the track. */
const trackHue = (track: Track) => {
  if (track.kind === 'audio') return track.name.toLowerCase().includes('music') ? 'text-hue-violet' : track.name.toLowerCase().includes('voice') ? 'text-hue-green' : 'text-hue-amber';
  return track.kind === 'captions' ? 'text-hue-yellow' : track.kind === 'overlay' ? 'text-hue-violet' : 'text-hue-sky';
};
const MIN_ZOOM = 2;
const MAX_ZOOM = 600;

interface DragState {
  ids: string[];
  mode: DragMode;
  delta: number; // move: seconds
  trackId: string; // move: target track of the grabbed clip
  start: number; // trim: new edges of the grabbed clip
  end: number;
  snapAt: number | null;
}

const niceStep = (zoom: number): { major: number; minor: number } => {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
  const major = steps.find((s) => s * zoom >= 80) ?? 1800;
  const minor = major >= 60 ? major / 6 : major === 15 ? 5 : major / 5;
  return { major, minor };
};

const tickLabel = (t: number, major: number) => {
  if (major < 1) return `${formatClock(t)}.${Math.round((t % 1) * 10)}`;
  return formatClock(t);
};

// ---------------------------------------------------------------------------
// Ruler (canvas, draws only the visible range)
// ---------------------------------------------------------------------------

const Ruler: React.FC<{ zoom: number; scrollLeft: number; width: number; project: Project; onScrub: (t: number) => void }> = ({ zoom, scrollLeft, width, project, onScrub }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const range = useStudio((s) => s.range);
  useEffect(() => {
    const c = canvas.current;
    if (!c || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(width * dpr);
    c.height = RULER_H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, RULER_H);
    const { major, minor } = niceStep(zoom);
    const t0 = scrollLeft / zoom;
    const t1 = (scrollLeft + width) / zoom;
    g.strokeStyle = '#353c55';
    g.fillStyle = '#a3abc1';
    g.font = '10px "JetBrains Mono Variable", monospace';
    g.textBaseline = 'top';
    const perMajor = Math.round(major / minor);
    for (let i = Math.floor(t0 / minor); i * minor <= t1 + minor; i++) {
      const t = Math.round(i * minor * 1000) / 1000;
      const x = Math.round(t * zoom - scrollLeft) + 0.5;
      const isMajor = i % perMajor === 0;
      g.beginPath();
      g.moveTo(x, isMajor ? 10 : 18);
      g.lineTo(x, RULER_H);
      g.stroke();
      if (isMajor && t >= 0) g.fillText(tickLabel(Math.max(0, t), major), x + 3, 3);
    }
    // chapters & markers
    for (const ch of project.youtube.chapters) {
      const x = ch.time * zoom - scrollLeft;
      if (x < -100 || x > width) continue;
      g.fillStyle = '#f0506e';
      g.fillRect(x, 0, 2, RULER_H);
      g.font = '600 10px "Inter Variable", sans-serif';
      const w = g.measureText(ch.title).width;
      g.fillStyle = 'rgba(240,80,110,0.9)';
      g.fillRect(x + 2, 13, Math.min(w + 8, 160), 12);
      g.fillStyle = '#fff';
      g.fillText(ch.title.slice(0, 26), x + 6, 14);
    }
    for (const m of project.markers) {
      const x = m.time * zoom - scrollLeft;
      if (x < -120 || x > width + 10) continue;
      g.fillStyle = m.color;
      g.beginPath();
      g.moveTo(x - 5, 0);
      g.lineTo(x + 5, 0);
      g.lineTo(x, 8);
      g.fill();
      g.font = '600 9px "Inter Variable", sans-serif';
      g.fillText(m.label.slice(0, 22), x + 7, 1);
    }
    if (range) {
      const x0 = range[0] * zoom - scrollLeft;
      const x1 = range[1] * zoom - scrollLeft;
      g.fillStyle = 'rgba(139,123,255,0.22)';
      g.fillRect(x0, 0, x1 - x0, RULER_H);
      g.fillStyle = '#8b7bff';
      g.fillRect(x0, 0, 2, RULER_H);
      g.fillRect(x1 - 2, 0, 2, RULER_H);
      g.fillRect(x0, RULER_H - 3, x1 - x0, 3);
    }
  }, [zoom, scrollLeft, width, project.youtube.chapters, project.markers, range]);

  const markerAt = (clientX: number, rect: DOMRect) => project.markers.find((m) => Math.abs(m.time * zoom - scrollLeft - (clientX - rect.left)) <= 6);

  return (
    <canvas
      ref={canvas}
      style={{ width, height: RULER_H }}
      className="block cursor-text"
      title="Click to move the playhead · markers: click to jump, double-click to rename, right-click to remove"
      onContextMenu={(e) => {
        const m = markerAt(e.clientX, e.currentTarget.getBoundingClientRect());
        if (!m) return;
        e.preventDefault();
        void useStudio.getState().edit([{ op: 'removeMarker', markerId: m.id }], 'Remove marker');
      }}
      onDoubleClick={(e) => {
        const m = markerAt(e.clientX, e.currentTarget.getBoundingClientRect());
        if (!m) return;
        const label = prompt('Marker label', m.label);
        if (label?.trim()) void useStudio.getState().edit([{ op: 'updateMarker', markerId: m.id, patch: { label: label.trim() } }], 'Rename marker');
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const m = markerAt(e.clientX, rect);
        if (m && e.clientY - rect.top < 12) {
          onScrub(m.time);
          return;
        }
        const at = (x: number) => Math.max(0, (x - rect.left + scrollLeft) / zoom);
        onScrub(at(e.clientX));
        const move = (ev: PointerEvent) => onScrub(at(ev.clientX));
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
};

/** Playhead line inside the scroll area; also keeps itself in view during playback. */
const Playhead: React.FC<{ zoom: number; scroller: React.RefObject<HTMLDivElement | null> }> = ({ zoom, scroller }) => {
  const time = useStudio((s) => s.time);
  const playing = useStudio((s) => s.playing);
  const x = time * zoom;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const view = el.clientWidth - HEADER_W;
    if (x < el.scrollLeft || x > el.scrollLeft + view - 30) el.scrollLeft = Math.max(0, x - 60);
  }, [x, playing, scroller]);
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-[5] w-0.5 -translate-x-1/2 bg-accent shadow-[0_0_10px_rgb(255_90_31/0.7)]" style={{ left: HEADER_W + x }}>
    </div>
  );
};

const RulerHead: React.FC<{ zoom: number; scrollLeft: number }> = ({ zoom, scrollLeft }) => {
  const time = useStudio((s) => s.time);
  const x = time * zoom - scrollLeft;
  if (x < -6) return null;
  return (
    <div className="pointer-events-none absolute top-0 z-10" style={{ left: HEADER_W + x - 6 }}>
      <svg width="12" height="14" viewBox="0 0 12 14">
        <path d="M0 0h12v8l-6 6-6-6z" fill="#ff5a1f" />
      </svg>
    </div>
  );
};

const TimecodeCorner: React.FC = () => {
  const time = useStudio((s) => s.time);
  const fps = useStudio((s) => s.project?.canvas.fps ?? 30);
  const f = Math.round(time * fps) % fps;
  return (
    <div className="flex h-full items-center gap-1.5 px-3 font-mono text-[11px] font-semibold tabular-nums text-accent-ink">
      <span className="size-1.5 rounded-full bg-accent shadow-[0_0_6px_rgb(255_90_31/0.9)]" />
      {formatClock(time)}:{String(f).padStart(2, '0')}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Track header
// ---------------------------------------------------------------------------

const TrackHeader: React.FC<{ track: Track; height: number }> = ({ track, height }) => {
  const compact = height < 40;
  const edit = useStudio((s) => s.edit);
  const [renaming, setRenaming] = useState(false);
  const toggle = (patch: Partial<Pick<Track, 'muted' | 'hidden' | 'locked'>>, label: string) => void edit([{ op: 'updateTrack', trackId: track.id, patch }], label);
  const visual = track.kind === 'video' || track.kind === 'overlay' || track.kind === 'captions';
  const audible = track.kind === 'audio' || track.kind === 'video' || track.kind === 'overlay';
  return (
    <div className="group flex items-center gap-2 border-b border-r border-line bg-solid/80 px-2 backdrop-blur-xl" style={{ height, width: HEADER_W }}>
      <span className={cn('tile rounded-md', compact ? 'size-5' : 'size-6', trackHue(track))}>
        <TrackIcon track={track} className="size-3.5" />
      </span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={track.name}
          className="field min-w-0 flex-1 px-1 py-0 text-xs"
          onBlur={(e) => {
            setRenaming(false);
            const v = e.target.value.trim();
            if (v && v !== track.name) void edit([{ op: 'updateTrack', trackId: track.id, patch: { name: v } }], 'Rename track');
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <span className={cn('min-w-0 flex-1 truncate text-xs font-semibold', track.hidden && 'text-dim line-through')} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
          {track.name}
        </span>
      )}
      <div className={cn('flex items-center opacity-60 group-hover:opacity-100', (track.muted || track.hidden || track.locked) && 'opacity-100')}>
        {audible && (
          <button className={cn('rounded p-0.5 hover:bg-panel-3', track.muted ? 'text-warn' : 'text-dim')} title={track.muted ? 'Unmute track' : 'Mute track'} onClick={() => toggle({ muted: !track.muted }, track.muted ? 'Unmute track' : 'Mute track')}>
            {track.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </button>
        )}
        {visual && (
          <button className={cn('rounded p-0.5 hover:bg-panel-3', track.hidden ? 'text-warn' : 'text-dim')} title={track.hidden ? 'Show track' : 'Hide track'} onClick={() => toggle({ hidden: !track.hidden }, track.hidden ? 'Show track' : 'Hide track')}>
            {track.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
        <button className={cn('rounded p-0.5 hover:bg-panel-3', track.locked ? 'text-warn' : 'text-dim')} title={track.locked ? 'Unlock track' : 'Lock track'} onClick={() => toggle({ locked: !track.locked }, track.locked ? 'Unlock track' : 'Lock track')}>
          {track.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const Timeline: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const selection = useStudio((s) => s.selection);
  const storeZoom = useStudio((s) => s.zoom);
  const setZoom = useStudio((s) => s.setZoom);
  const snapping = useStudio((s) => s.snapping);
  const setSnapping = useStudio((s) => s.setSnapping);
  const edit = useStudio((s) => s.edit);
  const select = useStudio((s) => s.select);
  const trackScale = useStudio((s) => s.trackScale);
  const range = useStudio((s) => s.range);
  const loopRange = useStudio((s) => s.loopRange);
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const th = useCallback((t: Track) => Math.round(TRACK_H[t.kind] * trackScale), [trackScale]);

  const scroller = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewW, setViewW] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dropHint, setDropHint] = useState<{ trackId: string; time: number } | null>(null);
  const [menuClip, setMenuClip] = useState<string | null>(null);
  const [menuTrack, setMenuTrack] = useState<string | null>(null);

  const duration = projectDuration(project);
  const zoom = storeZoom > 0 ? storeZoom : 40;
  const contentW = Math.max(viewW, (Math.max(duration, 10) + 30) * zoom);

  const autoFit = useStudio((s) => s.autoFit);
  const fit = useCallback(() => {
    const w = (scroller.current?.clientWidth ?? 800) - HEADER_W - 40;
    setZoom(clamp(w / Math.max(duration, 5), MIN_ZOOM, MAX_ZOOM));
    useStudio.setState({ autoFit: true });
    if (scroller.current) scroller.current.scrollLeft = 0;
  }, [duration, setZoom]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth - HEADER_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // keep the whole video in view while it grows (e.g. the Director adding scenes), until the user zooms by hand
  useEffect(() => {
    if (!autoFit || viewW <= 0) return;
    const t = setTimeout(fit, 150);
    return () => clearTimeout(t);
  }, [autoFit, viewW, duration, fit]);

  const zoomAround = useCallback(
    (next: number, anchorPx?: number) => {
      const el = scroller.current;
      const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
      useStudio.setState({ autoFit: false });
      if (!el) return setZoom(z);
      const anchor = anchorPx ?? (useStudio.getState().time * zoom - el.scrollLeft);
      const t = (el.scrollLeft + anchor) / zoom;
      setZoom(z);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, t * z - anchor);
      });
    },
    [zoom, setZoom],
  );

  // ctrl/cmd + wheel (and trackpad pinch) zooms around the pointer
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(zoom * Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left - HEADER_W);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, zoomAround]);

  const tracks = project.tracks;
  const offsets = useMemo(() => {
    let y = 0;
    return tracks.map((t) => {
      const top = y;
      y += th(t);
      return top;
    });
  }, [tracks, th]);

  // older video assets get their filmstrip generated on demand
  useEffect(() => {
    for (const a of project.assets) {
      if (a.kind !== 'video' || a.status !== 'ready' || a.filmstrip || stripRequested.has(`${project.id}/${a.id}`)) continue;
      stripRequested.add(`${project.id}/${a.id}`);
      void api.filmstrip(project.id, a.id).catch(() => undefined);
    }
  }, [project.assets, project.id]);

  const trackAtY = (clientY: number): Track | undefined => {
    const el = scroller.current;
    if (!el) return undefined;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
    for (let i = tracks.length - 1; i >= 0; i--) if (y >= offsets[i]!) return tracks[i];
    return undefined;
  };

  const snapPoints = (exclude: string[]): number[] => {
    const pts = [0, useStudio.getState().time];
    for (const t of tracks) for (const c of t.clips) if (!exclude.includes(c.id)) pts.push(c.start, clipEnd(c));
    for (const m of project.markers) pts.push(m.time);
    for (const ch of project.youtube.chapters) pts.push(ch.time);
    return pts;
  };

  const snapTo = (candidates: number[], pts: number[]): { offset: number; at: number } | null => {
    if (!snapping) return null;
    const threshold = 8 / zoom;
    let best: { offset: number; at: number } | null = null;
    for (const c of candidates) {
      for (const p of pts) {
        const d = p - c;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.offset))) best = { offset: d, at: p };
      }
    }
    return best;
  };

  const onClipPointerDown = (e: React.PointerEvent, clip: Clip, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useStudio.getState();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      st.select([clip.id], 'toggle');
      return;
    }
    const ref = getClipRef(st.project, clip.id);
    if (!ref) return;
    const sel = st.selection.includes(clip.id) ? st.selection : [clip.id];
    if (!st.selection.includes(clip.id)) st.select([clip.id]);
    if (st.rightTab !== 'inspector' && e.detail >= 2) st.setRightTab('inspector');
    if (ref.track.locked) return;

    if (mode === 'fade-in' || mode === 'fade-out' || mode === 'volume') {
      const el = (e.currentTarget as HTMLElement).closest('[data-clip-id]') as HTMLElement | null;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const audio = clip.type === 'audio';
      const key = mode === 'volume' ? 'volume' : mode === 'fade-in' ? (audio ? 'fadeIn' : 'audioFadeIn') : audio ? 'fadeOut' : 'audioFadeOut';
      const label = mode === 'volume' ? 'Volume' : mode === 'fade-in' ? 'Fade in' : 'Fade out';
      const onMove = (ev: PointerEvent) => {
        let value: number;
        let text: string;
        if (mode === 'volume') {
          const h = rect.height - 2;
          const y = clamp(ev.clientY - rect.top, 6, h - 6);
          value = Math.round(clamp((1 - (y - 6) / (h - 12)) * 2, 0, 2) * 100) / 100;
          text = `${Math.round(value * 100)}% · ${value > 0 ? `${(20 * Math.log10(value)).toFixed(1)} dB` : '−∞ dB'}`;
        } else {
          const px = mode === 'fade-in' ? ev.clientX - rect.left : rect.right - ev.clientX;
          value = Math.round(clamp(px / zoom, 0, clip.duration / 2) * 100) / 100;
          text = `${label} ${value.toFixed(2)}s`;
        }
        useStudio.getState().editSoon(`env:${clip.id}:${key}`, { op: 'updateClip', clipId: clip.id, patch: { [key]: value } }, label);
        setReadout({ x: ev.clientX, y: ev.clientY, text });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setReadout(null);
        useStudio.getState().flushEdits();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    const p = st.project!;
    const group = mode === 'move' ? sel.map((id) => getClipRef(p, id)).filter((r): r is NonNullable<typeof r> => Boolean(r) && !r!.track.locked) : [ref];
    const ids = group.map((g) => g.clip.id);
    const pts = snapPoints(ids);
    const asset = 'assetId' in clip ? p.assets.find((a) => a.id === clip.assetId) : undefined;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return;
      moved = true;
      const dt = (ev.clientX - startX) / zoom;
      let next: DragState;
      if (mode === 'move') {
        const minStart = Math.min(...group.map((g) => g.clip.start));
        let delta = Math.max(dt, -minStart);
        const snap = snapTo([clip.start + delta, clipEnd(clip) + delta], pts);
        if (snap) delta = Math.max(-minStart, delta + snap.offset);
        let trackId = ref.track.id;
        if (group.length === 1) {
          const t = trackAtY(ev.clientY);
          if (t && !t.locked && TRACK_ACCEPTS[t.kind].includes(clip.type)) trackId = t.id;
        }
        next = { ids, mode, delta, trackId, start: 0, end: 0, snapAt: snap?.at ?? null };
      } else if (mode === 'trim-start') {
        const media = clip.type === 'video' || clip.type === 'audio' ? clip : null;
        const minStart = Math.max(0, media ? clip.start - media.trimStart / media.speed : 0);
        let s = clamp(clip.start + dt, minStart, clipEnd(clip) - 0.1);
        const snap = snapTo([s], pts);
        if (snap) s = clamp(s + snap.offset, minStart, clipEnd(clip) - 0.1);
        next = { ids, mode, delta: 0, trackId: ref.track.id, start: s, end: clipEnd(clip), snapAt: snap?.at ?? null };
      } else {
        const media = clip.type === 'video' || clip.type === 'audio' ? clip : null;
        const loop = clip.type === 'audio' && clip.loop;
        const srcDur = asset?.meta.duration;
        const maxEnd = media && srcDur && !loop ? clip.start + (srcDur - media.trimStart) / media.speed : Infinity;
        let en = clamp(clipEnd(clip) + dt, clip.start + 0.1, maxEnd);
        const snap = snapTo([en], pts);
        if (snap) en = clamp(en + snap.offset, clip.start + 0.1, maxEnd);
        next = { ids, mode, delta: 0, trackId: ref.track.id, start: clip.start, end: en, snapAt: snap?.at ?? null };
      }
      dragRef.current = next;
      setDrag(next);
      const fps = p.canvas.fps;
      if (mode === 'move') {
        const d = next.delta;
        setReadout({ x: ev.clientX, y: ev.clientY, text: `${formatTimecode(clip.start + d, fps)}  ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}s` });
      } else {
        const len = next.end - next.start;
        const edge = mode === 'trim-start' ? next.start : next.end;
        const delta = mode === 'trim-start' ? next.start - clip.start : next.end - clipEnd(clip);
        setReadout({ x: ev.clientX, y: ev.clientY, text: `${mode === 'trim-start' ? 'In' : 'Out'} ${formatTimecode(edge, fps)} · ${len.toFixed(2)}s (${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)})` });
      }
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      setReadout(null);
      if (!moved || !d) return;
      const proj = useStudio.getState().project!;
      let ops: EditOp[] = [];
      if (d.mode === 'move') {
        if (Math.abs(d.delta) < 1e-4 && d.trackId === ref.track.id) return;
        if (group.length === 1) {
          const target = proj.tracks.find((t) => t.id === d.trackId)!;
          const moved1 = { ...clip, start: Math.max(0, clip.start + d.delta) } as Clip;
          if (conflictsOnTrack(target, moved1, clip.id).length > 0) {
            toast.error(`That spot on "${target.name}" is taken. Drop the clip on an empty area or another track.`);
            return;
          }
          ops = [{ op: 'moveClip', clipId: clip.id, start: moved1.start, trackId: d.trackId }];
        } else {
          const ordered = [...group].sort((a, b) => (d.delta > 0 ? b.clip.start - a.clip.start : a.clip.start - b.clip.start));
          ops = ordered.map((g) => ({ op: 'moveClip' as const, clipId: g.clip.id, start: Math.max(0, g.clip.start + d.delta) }));
        }
        void edit(ops, group.length > 1 ? `Move ${group.length} clips` : 'Move clip');
      } else {
        void edit([{ op: 'trimClip', clipId: clip.id, ...(d.mode === 'trim-start' ? { start: d.start } : { end: d.end }) }], 'Trim clip');
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Click empty space = move the playhead; drag = rubber-band select (Shift adds). */
  const onLanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = scroller.current!;
    const box = () => el.getBoundingClientRect();
    const toContent = (cx: number, cy: number) => ({ x: cx - box().left - HEADER_W + el.scrollLeft, y: cy - box().top + el.scrollTop });
    const a = toContent(e.clientX, e.clientY);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? useStudio.getState().selection : [];
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      const b = toContent(ev.clientX, ev.clientY);
      if (!dragging && Math.hypot(b.x - a.x, b.y - a.y) < 5) return;
      dragging = true;
      const r = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
      setMarquee(r);
      const t0 = r.x0 / zoom;
      const t1 = r.x1 / zoom;
      const hits: string[] = [];
      tracks.forEach((t, i) => {
        const top = offsets[i]!;
        if (t.locked || top + th(t) < r.y0 || top > r.y1) return;
        for (const c of t.clips) if (c.start < t1 && clipEnd(c) > t0) hits.push(c.id);
      });
      useStudio.setState({ selection: [...new Set([...base, ...hits])] });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
      if (!dragging) {
        if (!additive) select([]);
        player.seek(Math.max(0, a.x / zoom));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const dropTime = (e: React.DragEvent): number => {
    const el = scroller.current!;
    const x = e.clientX - el.getBoundingClientRect().left - HEADER_W + el.scrollLeft;
    let t = Math.max(0, x / zoom);
    const snap = snapTo([t], snapPoints([]));
    if (snap) t = snap.at;
    return t;
  };

  const onDragOver = (e: React.DragEvent, track: Track) => {
    const files = e.dataTransfer.types.includes('Files');
    if (!files && !e.dataTransfer.types.includes(DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const payload = activeDrag();
    const ok = files || !payload || payload.kind === 'captions' || track.kind !== 'captions';
    setDropHint(ok ? { trackId: track.id, time: dropTime(e) } : null);
  };

  const onDrop = (e: React.DragEvent, track: Track) => {
    e.preventDefault();
    setDropHint(null);
    const t = dropTime(e);
    if (e.dataTransfer.files.length > 0) {
      void dropFiles([...e.dataTransfer.files], t, track.id);
      return;
    }
    const payload = readDragPayload(e);
    clearDragPayload();
    if (payload) void dropPayload(payload, t, track.id);
  };

  const menuRef = menuClip ? getClipRef(project, menuClip) : null;
  const time = () => useStudio.getState().time;

  const clipMenuItems = menuRef
    ? [
        { label: 'Split at playhead', shortcut: 'S', icon: <Scissors />, disabled: !(time() > menuRef.clip.start && time() < clipEnd(menuRef.clip)), onSelect: () => void edit([{ op: 'splitClip', clipId: menuRef.clip.id, at: time() }], 'Split clip') },
        {
          label: 'Duplicate',
          shortcut: `${modKey}D`,
          icon: <Copy />,
          onSelect: () => void edit([{ op: 'addClip', trackId: menuRef.track.id, onConflict: 'new-track', clip: { ...structuredClone(menuRef.clip), id: uid('clip'), start: clipEnd(menuRef.clip) } }], 'Duplicate clip'),
        },
        { label: 'Move to playhead', icon: <ArrowLeftToLine />, onSelect: () => void edit([{ op: 'moveClip', clipId: menuRef.clip.id, start: time(), onConflict: 'new-track' }], 'Move clip') },
        {
          label: 'Ask Director about this clip',
          icon: <MessageSquareText />,
          onSelect: () => {
            useStudio.getState().select([menuRef.clip.id]);
            useStudio.setState({ composerPrefill: 'About the selected clip: ' });
            useStudio.getState().focusComposer();
          },
        },
        'separator' as const,
        { label: 'Delete', shortcut: '⌫', icon: <Trash2 />, danger: true, onSelect: () => void edit([{ op: 'removeClips', clipIds: [menuRef.clip.id] }], 'Delete clip') },
        { label: 'Ripple delete', shortcut: '⇧⌫', icon: <Trash2 />, danger: true, onSelect: () => void edit([{ op: 'removeClips', clipIds: [menuRef.clip.id], ripple: true }], 'Ripple delete') },
      ]
    : menuTrack
      ? [
          { label: 'Paste at playhead', shortcut: `${modKey}V`, icon: <ClipboardPaste />, onSelect: pasteAtPlayhead },
          { label: 'Select clips after playhead', icon: <ArrowRightToLine />, onSelect: selectForward },
          { label: 'Add marker at playhead', shortcut: 'M', icon: <Bookmark />, onSelect: addMarkerAtPlayhead },
          'separator' as const,
          { label: 'Close gaps on this track', icon: <ArrowLeftToLine />, onSelect: () => void edit([{ op: 'closeGaps', trackId: menuTrack }], 'Close gaps') },
        ]
      : [];

  const sliderVal = Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);

  return (
    <div className="flex h-full select-none flex-col">
      {/* toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line bg-white/[0.02] px-2">
        <IconBtn label="Split at playhead" shortcut="S" onClick={splitAtPlayhead}>
          <Scissors className="size-4" />
        </IconBtn>
        <IconBtn label="Delete selected" shortcut="⌫" disabled={selection.length === 0} onClick={() => deleteSelection()}>
          <Trash2 className="size-4" />
        </IconBtn>
        <div className="mx-1 h-4 w-px bg-line" />
        <IconBtn label={snapping ? 'Snapping on' : 'Snapping off'} active={snapping} onClick={() => setSnapping(!snapping)}>
          <Magnet className="size-4" />
        </IconBtn>
        <Menu
          align="start"
          trigger={
            <button className="btn btn-ghost btn-sm text-muted">
              <Plus className="size-3.5" /> Track
            </button>
          }
          items={[
            { label: 'Video track', onSelect: () => void edit([{ op: 'addTrack', name: `Video ${tracks.filter((t) => t.kind === 'video').length + 1}`, kind: 'video', index: 1 }], 'Add track') },
            { label: 'Overlay track', onSelect: () => void edit([{ op: 'addTrack', name: `Overlay ${tracks.filter((t) => t.kind === 'overlay').length + 1}`, kind: 'overlay' }], 'Add track') },
            { label: 'Audio track', onSelect: () => void edit([{ op: 'addTrack', name: `Audio ${tracks.filter((t) => t.kind === 'audio').length + 1}`, kind: 'audio' }], 'Add track') },
            { label: 'Captions track', onSelect: () => void edit([{ op: 'addTrack', name: 'Captions 2', kind: 'captions' }], 'Add track') },
          ]}
        />
        <Menu
          align="start"
          trigger={
            <button className="btn btn-ghost btn-icon text-muted hover:text-text" aria-label="Track height" title="Track height">
              <Rows3 className="size-4" />
            </button>
          }
          items={[
            { label: `${trackScale === 0.75 ? '✓ ' : ''}Compact tracks`, onSelect: () => setTrackScale(0.75) },
            { label: `${trackScale === 1 ? '✓ ' : ''}Normal tracks`, onSelect: () => setTrackScale(1) },
            { label: `${trackScale === 1.5 ? '✓ ' : ''}Tall tracks`, onSelect: () => setTrackScale(1.5) },
          ]}
        />
        {selection.length > 0 && <span className="ml-2 text-xs text-dim">{selection.length} selected</span>}
        {range && (
          <div className="ml-2 flex items-center gap-0.5 rounded-lg border border-accent-2/40 bg-accent-2/10 py-0.5 pl-2 pr-0.5">
            <span className="font-mono text-[11px] text-accent-2-ink" title="In/out range (I / O, Alt+X to clear)">
              {formatClock(range[0])} – {formatClock(range[1])} · {(range[1] - range[0]).toFixed(2)}s
            </span>
            <Tip label="Loop the range">
              <button className={cn('rounded p-1 hover:bg-panel-3', loopRange ? 'text-accent-2-ink' : 'text-dim')} onClick={() => useStudio.setState({ loopRange: !loopRange })} aria-label="Loop range">
                <Repeat className="size-3.5" />
              </button>
            </Tip>
            <Tip label="Make a vertical Short from the range">
              <button className="rounded p-1 text-dim hover:bg-panel-3 hover:text-hue-pink" onClick={() => void makeShort([range])} aria-label="Make a Short">
                <Smartphone className="size-3.5" />
              </button>
            </Tip>
            <Tip label="Delete range and close the gap">
              <button className="rounded p-1 text-dim hover:bg-panel-3 hover:text-danger" onClick={rippleDeleteRange} aria-label="Delete range">
                <Trash2 className="size-3.5" />
              </button>
            </Tip>
            <Tip label="Lift: clear the range, keep the gap">
              <button className="rounded p-1 text-dim hover:bg-panel-3 hover:text-text" onClick={liftRangeMarks} aria-label="Lift range">
                <Eraser className="size-3.5" />
              </button>
            </Tip>
            <Tip label="Clear range" shortcut="Alt X">
              <button className="rounded p-1 text-dim hover:bg-panel-3 hover:text-text" onClick={clearRangeMarks} aria-label="Clear range">
                <X className="size-3.5" />
              </button>
            </Tip>
          </div>
        )}
        <div className="flex-1" />
        <IconBtn label="Zoom out" shortcut="-" onClick={() => zoomAround(zoom / 1.4)}>
          <ZoomOut className="size-4" />
        </IconBtn>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={sliderVal}
          onChange={(e) => zoomAround(MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** Number(e.target.value))}
          className="w-28 accent-[#ff5a1f]"
          aria-label="Timeline zoom"
        />
        <IconBtn label="Zoom in" shortcut="+" onClick={() => zoomAround(zoom * 1.4)}>
          <ZoomIn className="size-4" />
        </IconBtn>
        <IconBtn label="Fit to window" onClick={fit}>
          <Maximize2 className="size-4" />
        </IconBtn>
      </div>

      {/* ruler */}
      <div className="relative flex shrink-0 border-b border-line bg-black/20" style={{ height: RULER_H }}>
        <div className="shrink-0 border-r border-line" style={{ width: HEADER_W }}>
          <TimecodeCorner />
        </div>
        <Ruler zoom={zoom} scrollLeft={scrollLeft} width={Math.max(0, viewW)} project={project} onScrub={(t) => player.seek(t)} />
        <RulerHead zoom={zoom} scrollLeft={scrollLeft} />
      </div>

      {/* tracks */}
      <ContextMenu.Root
        onOpenChange={(open) => {
          if (!open) {
            setMenuClip(null);
            setMenuTrack(null);
          }
        }}
      >
        <ContextMenu.Trigger asChild>
          <div
            ref={scroller}
            className="relative min-h-0 flex-1 overflow-auto"
            onScroll={(e) => setScrollLeft((e.target as HTMLDivElement).scrollLeft)}
          >
            <div className="relative" style={{ width: HEADER_W + contentW, minHeight: '100%' }}>
              {tracks.map((track, i) => (
                <div key={track.id} className="flex" style={{ height: th(track) }}>
                  <div className="sticky left-0 z-[6]">
                    <TrackHeader track={track} height={th(track)} />
                  </div>
                  <div
                    data-track-name={track.name}
                    className={cn('relative border-b border-line/70', i % 2 === 0 ? 'bg-white/[0.018]' : 'bg-black/[0.14]', track.locked && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_8px,#ffffff06_8px,#ffffff06_16px)]')}
                    style={{ width: contentW, opacity: track.hidden ? 0.55 : 1 }}
                    onPointerDown={onLanePointerDown}
                    onDragOver={(e) => onDragOver(e, track)}
                    onDragLeave={() => setDropHint((h) => (h?.trackId === track.id ? null : h))}
                    onDrop={(e) => onDrop(e, track)}
                    onContextMenu={() => {
                      setMenuTrack(track.id);
                    }}
                  >
                    {track.clips.map((clip) => {
                      const dragging = drag?.ids.includes(clip.id) ?? false;
                      if (dragging && drag!.mode === 'move' && drag!.trackId !== track.id && drag!.ids.length === 1) return null;
                      let start = clip.start;
                      let end = clipEnd(clip);
                      if (dragging && drag!.mode === 'move') {
                        start += drag!.delta;
                        end += drag!.delta;
                      } else if (dragging) {
                        start = drag!.start;
                        end = drag!.end;
                      }
                      return (
                        <ClipBlock
                          key={clip.id}
                          clip={clip}
                          project={project}
                          left={start * zoom}
                          width={(end - start) * zoom}
                          height={th(track)}
                          selected={selection.includes(clip.id)}
                          dragging={dragging}
                          locked={track.locked}
                          dimmed={false}
                          onPointerDown={onClipPointerDown}
                          onContextMenu={(_, c) => setMenuClip(c.id)}
                        />
                      );
                    })}
                    {/* a clip being dragged in from another track */}
                    {drag?.mode === 'move' &&
                      drag.ids.length === 1 &&
                      drag.trackId === track.id &&
                      !track.clips.some((c) => c.id === drag.ids[0]) &&
                      (() => {
                        const r = getClipRef(project, drag.ids[0]!);
                        if (!r) return null;
                        return (
                          <ClipBlock
                            clip={r.clip}
                            project={project}
                            left={(r.clip.start + drag.delta) * zoom}
                            width={r.clip.duration * zoom}
                            height={th(track)}
                            selected
                            dragging
                            locked={false}
                            dimmed={false}
                            onPointerDown={() => undefined}
                            onContextMenu={() => undefined}
                          />
                        );
                      })()}
                    {dropHint?.trackId === track.id && <div className="pointer-events-none absolute inset-y-0 z-[4] w-0.5 bg-accent-2 shadow-[0_0_10px_#8b7bff]" style={{ left: dropHint.time * zoom }} />}
                  </div>
                </div>
              ))}
              {range && <div className="pointer-events-none absolute bottom-0 top-0 z-[3] border-x border-accent-2/60 bg-accent-2/[0.07]" style={{ left: HEADER_W + range[0] * zoom, width: (range[1] - range[0]) * zoom }} />}
              {project.markers.map((m) => (
                <div key={m.id} className="pointer-events-none absolute bottom-0 top-0 z-[3] w-px opacity-50" style={{ left: HEADER_W + m.time * zoom, background: m.color }} />
              ))}
              {marquee && <div className="pointer-events-none absolute z-[7] rounded-sm border border-accent bg-accent/10" style={{ left: HEADER_W + marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />}
              {drag?.snapAt != null && <div className="pointer-events-none absolute bottom-0 top-0 z-[4] w-px bg-warn" style={{ left: HEADER_W + drag.snapAt * zoom }} />}
              <Playhead zoom={zoom} scroller={scroller} />
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          {clipMenuItems.length > 0 && (
            <ContextMenu.Content className="glass-pop z-[90] min-w-52 rounded-xl p-1">
              {clipMenuItems.map((it, i) =>
                it === 'separator' ? (
                  <ContextMenu.Separator key={i} className="my-1 h-px bg-line" />
                ) : (
                  <ContextMenu.Item
                    key={i}
                    disabled={'disabled' in it ? it.disabled : false}
                    onSelect={it.onSelect}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-panel-3 [&_svg]:size-4 [&_svg]:text-accent-2-ink',
                      'danger' in it && it.danger && 'text-danger',
                    )}
                  >
                    {it.icon}
                    <span className="flex-1">{it.label}</span>
                    {'shortcut' in it && it.shortcut && <span className="text-[11px] text-dim">{it.shortcut}</span>}
                  </ContextMenu.Item>
                ),
              )}
            </ContextMenu.Content>
          )}
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {readout && (
        <div className="glass-pop pointer-events-none fixed z-[95] rounded-md px-1.5 py-0.5 font-mono text-[10px] text-text" style={{ left: readout.x + 14, top: readout.y - 28 }}>
          {readout.text}
        </div>
      )}
    </div>
  );
};

const stripRequested = new Set<string>();

const setTrackScale = (v: number) => {
  prefs.set('trackScale', v);
  useStudio.setState({ trackScale: v });
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import type { Clip, Project, Track } from '../../../shared/schema';
import { clipEnd } from '../../../shared/timeline';
import { animateClip, isAnimated, isChannelOf } from '../../../shared/keyframes';
import { clipLabel, getClipRef, useStudio } from '../../lib/store';
import { clamp, cn } from '../../lib/utils';

/**
 * Direct manipulation on the preview: the composition marks every visual element with
 * data-clip-box / data-clip-kind, so we can hit-test what is actually on screen, draw
 * selection boxes from real DOM rects, and turn pointer drags into clip edits.
 *
 *   text      drag = move (x/y anchor), corner handles = font size
 *   box       drag = move picture-in-picture box, handles = resize (corners keep aspect; Shift frees it)
 *   frame     full-frame video/image: drag = pan the crop (focus) when the media overflows the frame
 *   captions  drag up/down = caption position
 */

type Kind = 'text' | 'box' | 'frame' | 'captions';
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Guide {
  axis: 'x' | 'y';
  at: number; // fraction of the canvas
}
interface DragState {
  guides: Guide[];
  readout: string;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const BASE_GUIDES = [0, 0.05, 1 / 3, 0.5, 2 / 3, 0.95, 1];
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const activeClips = (p: Project, t: number): { clip: Clip; track: Track }[] =>
  p.tracks.flatMap((track) => (track.hidden ? [] : track.clips.filter((c) => c.type !== 'audio' && t >= c.start - 1e-6 && t < clipEnd(c)).map((clip) => ({ clip, track }))));

const isMovable = (clip: Clip, kind: Kind) => kind === 'text' || kind === 'box' || kind === 'captions' || (kind === 'frame' && (clip.type === 'video' || clip.type === 'image'));
const isResizable = (kind: Kind) => kind === 'text' || kind === 'box';

export const CanvasOverlay: React.FC<{ canvasWidth: number; canvasHeight: number; disabled?: boolean }> = ({ canvasWidth, canvasHeight, disabled }) => {
  const overlay = useRef<HTMLDivElement>(null);
  const selection = useStudio((s) => s.selection);
  const selectedId = selection.length === 1 ? selection[0]! : null;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [rects, setRects] = useState<{ sel: (Rect & { kind: Kind }) | null; hover: (Rect & { kind: Kind }) | null }>({ sel: null, hover: null });
  const [drag, setDrag] = useState<DragState | null>(null);
  const lastRects = useRef('');

  /** Elements of the clips visible right now, in paint order (later = on top). */
  const elements = useCallback((): HTMLElement[] => {
    const root = overlay.current?.parentElement;
    if (!root) return [];
    const { project, time } = useStudio.getState();
    if (!project) return [];
    const active = new Set(activeClips(project, time).map((x) => x.clip.id));
    return [...root.querySelectorAll<HTMLElement>('[data-clip-box]')].filter((el) => active.has(el.dataset.clipBox!));
  }, []);

  const relRect = useCallback((el: Element): Rect => {
    const o = overlay.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }, []);

  const findEl = useCallback((id: string) => elements().find((el) => el.dataset.clipBox === id) ?? null, [elements]);

  // keep the selection/hover boxes glued to the picture (animations, playback, edits)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const sel = selectedId ? findEl(selectedId) : null;
      const hov = hoverId && hoverId !== selectedId ? findEl(hoverId) : null;
      const next = {
        sel: sel ? { ...relRect(sel), kind: sel.dataset.clipKind as Kind } : null,
        hover: hov ? { ...relRect(hov), kind: hov.dataset.clipKind as Kind } : null,
      };
      const key = JSON.stringify([next.sel && [Math.round(next.sel.x), Math.round(next.sel.y), Math.round(next.sel.w), Math.round(next.sel.h)], next.hover && [Math.round(next.hover.x), Math.round(next.hover.y), Math.round(next.hover.w), Math.round(next.hover.h)]]);
      if (key !== lastRects.current) {
        lastRects.current = key;
        setRects(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedId, hoverId, findEl, relRect]);

  const hitTest = (clientX: number, clientY: number): HTMLElement | null => {
    const hits = elements().filter((el) => {
      const r = el.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    });
    const specific = hits.filter((el) => el.dataset.clipKind !== 'frame');
    return (specific.length ? specific : hits).at(-1) ?? null;
  };

  const overlaySize = () => {
    const o = overlay.current!.getBoundingClientRect();
    return { W: o.width, H: o.height, left: o.left, top: o.top };
  };

  /** Snap the moving edges to canvas guides and to the other visible elements. */
  const snap = (candidates: { axis: 'x' | 'y'; values: number[] }, exclude: string, W: number, H: number): { offset: number; guide: Guide | null } => {
    if (useStudio.getState().snapping === false) return { offset: 0, guide: null };
    const size = candidates.axis === 'x' ? W : H;
    const threshold = 6 / size;
    const lines = [...BASE_GUIDES];
    for (const el of elements()) {
      if (el.dataset.clipBox === exclude || el.dataset.clipKind === 'frame') continue;
      const r = relRect(el);
      if (candidates.axis === 'x') lines.push(r.x / W, (r.x + r.w / 2) / W, (r.x + r.w) / W);
      else lines.push(r.y / H, (r.y + r.h / 2) / H, (r.y + r.h) / H);
    }
    let best: { offset: number; guide: Guide } | null = null;
    for (const v of candidates.values) {
      for (const g of lines) {
        const d = g - v;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.offset))) best = { offset: d, guide: { axis: candidates.axis, at: g } };
      }
    }
    return best ?? { offset: 0, guide: null };
  };

  /**
   * Apply a canvas edit. Animated properties get a keyframe at the playhead (auto-key);
   * everything else changes its static value. One drag = one undo step either way.
   */
  const patchClip = (clipId: string, patch: Record<string, unknown>, label: string) => {
    const st = useStudio.getState();
    const c = getClipRef(st.project, clipId)?.clip;
    if (!c) return;
    const keyed: Record<string, number> = {};
    const rest: Record<string, unknown> = {};
    const animatedChannel = (ch: string) => isChannelOf(c.type, ch) && isAnimated(c, ch);
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === 'number' && animatedChannel(k)) keyed[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const sub: Record<string, unknown> = {};
        for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
          if (typeof sv === 'number' && animatedChannel(`${k}.${sk}`)) keyed[`${k}.${sk}`] = sv;
          else sub[sk] = sv;
        }
        if (Object.keys(sub).length) rest[k] = sub;
      } else rest[k] = v;
    }
    if (Object.keys(rest).length) st.editSoon(`canvas:${clipId}`, { op: 'updateClip', clipId, patch: rest }, label);
    if (Object.keys(keyed).length) {
      const t = Math.round((st.time - c.start) * 1000) / 1000;
      if (t >= -0.001 && t <= c.duration + 0.001) st.editSoon(`canvas-kf:${clipId}`, { op: 'setKeyframe', clipId, t: clamp(t, 0, c.duration), values: keyed }, `${label} (keyframe)`);
    }
  };

  /** The clip as it is drawn right now (animated values at the playhead). */
  const atPlayhead = <T extends Clip>(c: T): T => (c.keyframes ? animateClip(c, useStudio.getState().time - c.start) : c);

  const startDrag = (e: React.PointerEvent, el: HTMLElement, clip: Clip, track: Track, handle: Handle | null) => {
    const kind = el.dataset.clipKind as Kind;
    if (track.locked || !(handle ? isResizable(kind) : isMovable(clip, kind))) return;
    const { W, H } = overlaySize();
    const r0 = relRect(el);
    const startX = e.clientX;
    const startY = e.clientY;
    const shiftDuringDrag = { v: e.shiftKey };
    let moved = false;

    // per-kind starting values
    const textStart = clip.type === 'text' ? { x: clip.x, y: clip.y, size: clip.style.size, offX: (r0.x + r0.w / 2) / W - clip.x, offY: (r0.y + r0.h / 2) / H - clip.y } : null;
    const boxStart = (clip.type === 'video' || clip.type === 'image') && clip.box ? { ...clip.box } : null;
    const focusStart = (clip.type === 'video' || clip.type === 'image') && !clip.box ? { x: clip.focus?.x ?? 0.5, y: clip.focus?.y ?? 0.5 } : null;
    const capStart = clip.type === 'captions' ? clip.style.offsetY : 0;

    // how far the media overflows the frame (in overlay px): dragging that far pans the crop end to end
    let overflow = { x: 0, y: 0 };
    if (focusStart && (clip.type === 'video' || clip.type === 'image')) {
      const asset = useStudio.getState().project?.assets.find((a) => a.id === clip.assetId);
      const mw = asset?.meta.width ?? canvasWidth;
      const mh = asset?.meta.height ?? canvasHeight;
      const cover = clip.fit === 'cover' ? Math.max(canvasWidth / mw, canvasHeight / mh) : Math.min(canvasWidth / mw, canvasHeight / mh);
      const scale = cover * (clip.scale ?? 1);
      overflow = { x: Math.max(0, mw * scale - canvasWidth) * (W / canvasWidth), y: Math.max(0, mh * scale - canvasHeight) * (H / canvasHeight) };
      if (clip.fit === 'fill') overflow = { x: 0, y: 0 };
    }

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      shiftDuringDrag.v = ev.shiftKey;
      const dxf = dx / W;
      const dyf = dy / H;
      const guides: Guide[] = [];

      if (!handle && textStart) {
        let x = textStart.x + dxf;
        let y = textStart.y + dyf;
        const hw = r0.w / W / 2;
        const hh = r0.h / H / 2;
        const sx = snap({ axis: 'x', values: [x + textStart.offX - hw, x + textStart.offX, x + textStart.offX + hw] }, clip.id, W, H);
        const sy = snap({ axis: 'y', values: [y + textStart.offY - hh, y + textStart.offY, y + textStart.offY + hh] }, clip.id, W, H);
        x = clamp(x + sx.offset, 0, 1);
        y = clamp(y + sy.offset, 0, 1);
        if (sx.guide) guides.push(sx.guide);
        if (sy.guide) guides.push(sy.guide);
        patchClip(clip.id, { x: round4(x), y: round4(y) }, 'Move text');
        setDrag({ guides, readout: `X ${pct(x)} · Y ${pct(y)}` });
      } else if (handle && textStart) {
        const cx = r0.x + r0.w / 2;
        const cy = r0.y + r0.h / 2;
        const o = overlaySize();
        const d0 = Math.hypot(startX - o.left - cx, startY - o.top - cy) || 1;
        const d1 = Math.hypot(ev.clientX - o.left - cx, ev.clientY - o.top - cy);
        const size = clamp(Math.round(textStart.size * (d1 / d0)), 6, 600);
        patchClip(clip.id, { style: { size } }, 'Resize text');
        setDrag({ guides, readout: `${size} px` });
      } else if (!handle && boxStart) {
        let x = boxStart.x + dxf;
        let y = boxStart.y + dyf;
        const sx = snap({ axis: 'x', values: [x, x + boxStart.w / 2, x + boxStart.w] }, clip.id, W, H);
        const sy = snap({ axis: 'y', values: [y, y + boxStart.h / 2, y + boxStart.h] }, clip.id, W, H);
        x += sx.offset;
        y += sy.offset;
        if (sx.guide) guides.push(sx.guide);
        if (sy.guide) guides.push(sy.guide);
        patchClip(clip.id, { box: { ...boxStart, x: round4(x), y: round4(y) } }, 'Move picture-in-picture');
        setDrag({ guides, readout: `X ${pct(x)} · Y ${pct(y)}` });
      } else if (handle && boxStart) {
        let { x, y, w, h } = boxStart;
        if (handle.includes('e')) w = boxStart.w + dxf;
        if (handle.includes('w')) {
          x = boxStart.x + dxf;
          w = boxStart.w - dxf;
        }
        if (handle.includes('s')) h = boxStart.h + dyf;
        if (handle.includes('n')) {
          y = boxStart.y + dyf;
          h = boxStart.h - dyf;
        }
        // corners keep the aspect ratio unless Shift is held
        const corner = handle.length === 2;
        if (corner && !ev.shiftKey) {
          const aspect = (boxStart.w * canvasWidth) / (boxStart.h * canvasHeight);
          const hFromW = (w * canvasWidth) / aspect / canvasHeight;
          if (handle.includes('n')) y = boxStart.y + boxStart.h - hFromW;
          h = hFromW;
        }
        // snap the edges being dragged
        if (handle.includes('e')) {
          const s = snap({ axis: 'x', values: [x + w] }, clip.id, W, H);
          w += s.offset;
          if (s.guide) guides.push(s.guide);
        }
        if (handle.includes('w')) {
          const s = snap({ axis: 'x', values: [x] }, clip.id, W, H);
          x += s.offset;
          w -= s.offset;
          if (s.guide) guides.push(s.guide);
        }
        if (!corner && handle.includes('s')) {
          const s = snap({ axis: 'y', values: [y + h] }, clip.id, W, H);
          h += s.offset;
          if (s.guide) guides.push(s.guide);
        }
        if (!corner && handle.includes('n')) {
          const s = snap({ axis: 'y', values: [y] }, clip.id, W, H);
          y += s.offset;
          h -= s.offset;
          if (s.guide) guides.push(s.guide);
        }
        w = clamp(w, 0.03, 3);
        h = clamp(h, 0.03, 3);
        patchClip(clip.id, { box: { x: round4(x), y: round4(y), w: round4(w), h: round4(h) } }, 'Resize picture-in-picture');
        setDrag({ guides, readout: `${pct(w)} × ${pct(h)}` });
      } else if (!handle && focusStart) {
        if (overflow.x < 1 && overflow.y < 1) {
          setDrag({ guides, readout: 'Media fills the frame: zoom in (Inspector → Reframe) to pan' });
          return;
        }
        const fx = overflow.x >= 1 ? clamp(focusStart.x - dx / overflow.x, 0, 1) : focusStart.x;
        const fy = overflow.y >= 1 ? clamp(focusStart.y - dy / overflow.y, 0, 1) : focusStart.y;
        patchClip(clip.id, { focus: { x: round4(fx), y: round4(fy) } }, 'Reframe');
        setDrag({ guides, readout: `Focus ${pct(fx)} · ${pct(fy)}` });
      } else if (clip.type === 'captions') {
        const off = clamp(capStart + dyf, -0.5, 0.5);
        patchClip(clip.id, { style: { offsetY: round4(off) } }, 'Move captions');
        setDrag({ guides, readout: `Offset ${off >= 0 ? '+' : ''}${pct(off)}` });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (moved) useStudio.getState().flushEdits();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || disabled) return;
    overlay.current?.focus({ preventScroll: true });
    const st = useStudio.getState();
    const el = hitTest(e.clientX, e.clientY);
    if (!el) {
      st.select([]);
      return;
    }
    const id = el.dataset.clipBox!;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      st.select([id], 'toggle');
      return;
    }
    if (!st.selection.includes(id) || st.selection.length > 1) st.select([id]);
    const ref = getClipRef(st.project, id);
    if (ref) startDrag(e, el, atPlayhead(ref.clip), ref.track, null);
  };

  const onHandleDown = (e: React.PointerEvent, h: Handle) => {
    e.stopPropagation();
    if (e.button !== 0 || !selectedId) return;
    const st = useStudio.getState();
    const el = findEl(selectedId);
    const ref = getClipRef(st.project, selectedId);
    if (el && ref) startDrag(e, el, atPlayhead(ref.clip), ref.track, h);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const st = useStudio.getState();
    if (e.key === 'Escape') {
      st.select([]);
      e.stopPropagation();
      return;
    }
    if (e.key === 'Enter' && selectedId) {
      st.setRightTab('inspector');
      e.stopPropagation();
      return;
    }
    if (!selectedId || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const ref = getClipRef(st.project, selectedId);
    if (!ref || ref.track.locked) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 0.05 : e.altKey ? 0.001 : 0.005;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const c = atPlayhead(ref.clip);
    if (c.type === 'text') patchClip(c.id, { x: round4(clamp(c.x + dx, 0, 1)), y: round4(clamp(c.y + dy, 0, 1)) }, 'Nudge text');
    else if ((c.type === 'video' || c.type === 'image') && c.box) patchClip(c.id, { box: { ...c.box, x: round4(c.box.x + dx), y: round4(c.box.y + dy) } }, 'Nudge picture-in-picture');
    else if (c.type === 'video' || c.type === 'image') patchClip(c.id, { focus: { x: round4(clamp((c.focus?.x ?? 0.5) - dx * 2, 0, 1)), y: round4(clamp((c.focus?.y ?? 0.5) - dy * 2, 0, 1)) } }, 'Reframe');
    else if (c.type === 'captions') patchClip(c.id, { style: { offsetY: round4(clamp(c.style.offsetY + dy, -0.5, 0.5)) } }, 'Move captions');
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag) return;
    const el = hitTest(e.clientX, e.clientY);
    const id = el?.dataset.clipBox ?? null;
    if (id !== hoverId) setHoverId(id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const el = hitTest(e.clientX, e.clientY);
    if (!el) return;
    const st = useStudio.getState();
    st.select([el.dataset.clipBox!]);
    st.setRightTab('inspector');
    // after the Inspector has mounted its text field
    if (el.dataset.clipKind === 'text') setTimeout(() => window.dispatchEvent(new CustomEvent('cutroom:focus-text')), 80);
  };

  const sel = rects.sel;
  const selRef = selectedId ? getClipRef(useStudio.getState().project, selectedId) : null;
  const locked = selRef?.track.locked ?? false;
  const resizable = sel && !locked && isResizable(sel.kind);
  const movable = sel && selRef && !locked && isMovable(selRef.clip, sel.kind);

  return (
    <div
      ref={overlay}
      tabIndex={-1}
      aria-label="Canvas: click an element to select it, drag to move, arrow keys to nudge"
      className={cn('absolute inset-0 z-[2] outline-none', disabled && 'pointer-events-none')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => !drag && setHoverId(null)}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={{ cursor: hoverId && hoverId === selectedId && movable ? 'move' : hoverId ? 'pointer' : 'default' }}
    >
      {rects.hover && <div className="pointer-events-none absolute rounded-[2px] outline outline-1 outline-dashed outline-white/45" style={{ left: rects.hover.x, top: rects.hover.y, width: rects.hover.w, height: rects.hover.h }} />}
      {sel && (
        <div
          className={cn('pointer-events-none absolute rounded-[2px] outline outline-[1.5px]', locked ? 'outline-dim' : 'outline-accent')}
          style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, boxShadow: locked ? undefined : '0 0 0 1px rgb(0 0 0 / 0.35), 0 0 18px -2px rgb(255 90 31 / 0.45)' }}
        >
          {selRef && (
            <span className="absolute -top-[22px] left-0 flex max-w-[220px] items-center gap-1 truncate rounded-md bg-accent px-1.5 py-px text-[10px] font-semibold text-white shadow">
              {locked && <Lock className="size-2.5" />}
              {clipLabel(selRef.clip, useStudio.getState().project)}
            </span>
          )}
          {resizable &&
            (sel.kind === 'text' ? (['nw', 'ne', 'se', 'sw'] as Handle[]) : HANDLES).map((h) => (
              <span
                key={h}
                onPointerDown={(e) => onHandleDown(e, h)}
                className="pointer-events-auto absolute size-[9px] rounded-[2px] border-[1.5px] border-accent bg-white shadow"
                style={{
                  cursor: HANDLE_CURSOR[h],
                  left: h.includes('w') ? -5 : h.includes('e') ? 'calc(100% - 4px)' : 'calc(50% - 4.5px)',
                  top: h.includes('n') ? -5 : h.includes('s') ? 'calc(100% - 4px)' : 'calc(50% - 4.5px)',
                }}
              />
            ))}
        </div>
      )}
      {drag?.guides.map((g, i) =>
        g.axis === 'x' ? (
          <div key={i} className="pointer-events-none absolute inset-y-0 w-px bg-[#ff4fd8] shadow-[0_0_6px_#ff4fd8]" style={{ left: `${g.at * 100}%` }} />
        ) : (
          <div key={i} className="pointer-events-none absolute inset-x-0 h-px bg-[#ff4fd8] shadow-[0_0_6px_#ff4fd8]" style={{ top: `${g.at * 100}%` }} />
        ),
      )}
      {drag && sel && (
        <span className="glass-pop pointer-events-none absolute rounded-md px-1.5 py-0.5 font-mono text-[10px] text-text" style={{ left: sel.x, top: Math.min(sel.y + sel.h + 6, (overlay.current?.clientHeight ?? 0) - 20) }}>
          {drag.readout}
        </span>
      )}
    </div>
  );
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

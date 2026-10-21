import React, { useEffect, useMemo, useState } from 'react';
import type { Asset, Clip, Project } from '../../../shared/schema';
import { mediaUrl } from '../../lib/api';
import { clipLabel } from '../../lib/store';
import { cn, decodePeaks } from '../../lib/utils';
import { ClipIcon, clipColor } from '../icons';

// ---------------------------------------------------------------------------
// Waveforms (peaks files are small; cache them for the session)
// ---------------------------------------------------------------------------

interface Peaks {
  rate: number;
  data: Uint8Array;
}
const peaksCache = new Map<string, Promise<Peaks | null>>();
const loadPeaks = (url: string): Promise<Peaks | null> => {
  let p = peaksCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { rate: number; peaks: string } | null) => (j ? { rate: j.rate, data: decodePeaks(j.peaks) } : null))
      .catch(() => null);
    peaksCache.set(url, p);
  }
  return p;
};

const Waveform: React.FC<{ projectId: string; asset: Asset; from: number; to: number; loop: boolean; color: string }> = ({ projectId, asset, from, to, loop, color }) => {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const url = asset.waveform ? mediaUrl(projectId, asset.waveform) : null;
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void loadPeaks(url).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [url]);

  const path = useMemo(() => {
    if (!peaks || peaks.data.length === 0) return null;
    const total = peaks.data.length;
    const i0 = Math.floor(from * peaks.rate);
    const i1 = Math.max(i0 + 1, Math.ceil(to * peaks.rate));
    const n = i1 - i0;
    const buckets = Math.min(n, 1500);
    const per = n / buckets;
    const top: string[] = [];
    const vals: number[] = [];
    for (let b = 0; b < buckets; b++) {
      let m = 0;
      const s = Math.floor(i0 + b * per);
      const e = Math.max(s + 1, Math.floor(i0 + (b + 1) * per));
      for (let i = s; i < e; i++) {
        const idx = loop ? i % total : i;
        const v = idx < total ? peaks.data[idx]! : 0;
        if (v > m) m = v;
      }
      vals.push(m / 255);
    }
    vals.forEach((v, b) => top.push(`${b === 0 ? 'M' : 'L'}${b} ${(1 - v) * 50}`));
    const bottom = vals.map((v, b) => `L${buckets - 1 - b} ${50 + vals[buckets - 1 - b]! * 50}`).join(' ');
    return { d: `${top.join(' ')} ${bottom} Z`, w: Math.max(1, buckets - 1) };
  }, [peaks, from, to, loop]);

  if (!path) return null;
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] w-full" viewBox={`0 0 ${path.w} 100`} preserveAspectRatio="none">
      <path d={path.d} fill={color} opacity={0.55} />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Clip block
// ---------------------------------------------------------------------------

export type DragMode = 'move' | 'trim-start' | 'trim-end';

export interface ClipBlockProps {
  clip: Clip;
  project: Project;
  left: number;
  width: number;
  height: number;
  selected: boolean;
  dragging: boolean;
  locked: boolean;
  dimmed: boolean;
  onPointerDown: (e: React.PointerEvent, clip: Clip, mode: DragMode) => void;
  onContextMenu: (e: React.MouseEvent, clip: Clip) => void;
}

export const ClipBlock: React.FC<ClipBlockProps> = React.memo(({ clip, project, left, width, height, selected, dragging, locked, dimmed, onPointerDown, onContextMenu }) => {
  const color = clipColor(clip);
  const asset = 'assetId' in clip ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const thumb = asset?.thumb && (clip.type === 'video' || clip.type === 'image') ? mediaUrl(project.id, asset.thumb) : null;
  const hasAudio = clip.type === 'audio' || (clip.type === 'video' && asset?.meta.hasAudio && !clip.muted);
  const label = clipLabel(clip, project);
  const narrow = width < 46;
  const short = height < 40;
  const detail =
    clip.type === 'scene'
      ? String((clip.props as Record<string, unknown>).title ?? (clip.props as Record<string, unknown>).heading ?? (clip.props as Record<string, unknown>).text ?? '')
      : clip.type === 'captions'
        ? clip.mode === 'auto'
          ? clip.style.preset
          : clip.words.slice(0, 12).map((w) => w.text).join(' ')
        : '';

  return (
    <div
      className={cn(
        'group absolute bottom-[3px] top-[3px] overflow-hidden rounded-[5px] border text-[11px] leading-tight shadow-sm select-none',
        locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
        selected && 'z-[2] ring-2 ring-white/90',
        dragging && 'z-[3] opacity-85 shadow-xl',
        dimmed && 'opacity-40',
      )}
      style={{ left, width: Math.max(3, width), background: color.bg, borderColor: color.border, color: color.text }}
      onPointerDown={(e) => onPointerDown(e, clip, 'move')}
      onContextMenu={(e) => onContextMenu(e, clip)}
      title={`${label} · ${clip.start.toFixed(2)}s – ${(clip.start + clip.duration).toFixed(2)}s`}
    >
      {thumb && <div className="pointer-events-none absolute inset-0 opacity-45" style={{ backgroundImage: `url("${thumb}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />}
      {hasAudio && asset && (
        <Waveform
          projectId={project.id}
          asset={asset}
          from={'trimStart' in clip ? clip.trimStart : 0}
          to={('trimStart' in clip ? clip.trimStart : 0) + clip.duration * ('speed' in clip ? clip.speed : 1)}
          loop={clip.type === 'audio' && clip.loop}
          color={color.border}
        />
      )}
      {!narrow && (
        <div className="relative flex items-center gap-1 px-1.5 pt-1 font-semibold">
          <ClipIcon clip={clip} className="size-3 shrink-0 opacity-90" />
          <span className="truncate drop-shadow">{label}</span>
        </div>
      )}
      {!narrow && !short && detail && <div className="relative truncate px-1.5 pt-0.5 opacity-70">{detail.replace(/\*/g, '')}</div>}
      {clip.transitionIn && <div className="pointer-events-none absolute left-0 top-0 h-full bg-gradient-to-r from-white/25 to-transparent" style={{ width: Math.min(width / 2, clip.transitionIn.duration * (width / clip.duration)) }} />}
      {clip.transitionOut && <div className="pointer-events-none absolute right-0 top-0 h-full bg-gradient-to-l from-white/25 to-transparent" style={{ width: Math.min(width / 2, clip.transitionOut.duration * (width / clip.duration)) }} />}
      {!locked && (
        <>
          <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40 group-hover:bg-white/15" onPointerDown={(e) => onPointerDown(e, clip, 'trim-start')} />
          <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40 group-hover:bg-white/15" onPointerDown={(e) => onPointerDown(e, clip, 'trim-end')} />
        </>
      )}
    </div>
  );
});
ClipBlock.displayName = 'ClipBlock';

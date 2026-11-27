import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { Check, Clapperboard, Expand, Feather, Gauge, Grid3x3, Pause, Play, Repeat, SkipBack, SkipForward, StepBack, StepForward, Volume2, VolumeX, ZoomIn } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { CompositionInput } from '../../../shared/schema';
import { projectDuration } from '../../../shared/timeline';
import { Main } from '../../../remotion/Main';
import { mediaUrl } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { player } from '../../lib/player';
import { prefs } from '../../lib/prefs';
import { cn, formatTimecode } from '../../lib/utils';
import { IconBtn, Spinner, Tip } from '../ui';
import { CanvasOverlay } from './CanvasOverlay';

const TimeDisplay: React.FC<{ fps: number; duration: number }> = ({ fps, duration }) => {
  const time = useStudio((s) => s.time);
  return (
    <div className="font-mono text-xs tabular-nums">
      <span className="text-text">{formatTimecode(time, fps)}</span>
      <span className="text-dim"> / {formatTimecode(duration, fps)}</span>
    </div>
  );
};

/** Platform UI overlays: where YouTube's buttons and titles cover the picture. */
const SafeZones: React.FC<{ portrait: boolean }> = ({ portrait }) =>
  portrait ? (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-0 h-[8%] border-b border-dashed border-cyan-300/60 bg-cyan-300/10" />
      <div className="absolute inset-x-0 bottom-0 h-[22%] border-t border-dashed border-cyan-300/60 bg-cyan-300/10" />
      <div className="absolute bottom-[22%] right-0 top-[45%] w-[16%] border-l border-dashed border-cyan-300/60 bg-cyan-300/10" />
      <span className="absolute bottom-1 left-2 text-[10px] font-semibold text-cyan-200/80">Shorts UI (title, buttons)</span>
    </div>
  ) : (
    <div className="pointer-events-none absolute inset-[5%] border border-dashed border-cyan-300/50">
      <div className="absolute inset-[5.3%] border border-dashed border-cyan-300/30" />
      <span className="absolute -top-4 left-0 text-[10px] font-semibold text-cyan-200/80">action safe / title safe</span>
    </div>
  );

const ThirdsGrid: React.FC = () => (
  <div className="pointer-events-none absolute inset-0">
    {[1 / 3, 2 / 3].map((f) => (
      <React.Fragment key={f}>
        <div className="absolute inset-y-0 w-px bg-white/30" style={{ left: `${f * 100}%` }} />
        <div className="absolute inset-x-0 h-px bg-white/30" style={{ top: `${f * 100}%` }} />
      </React.Fragment>
    ))}
  </div>
);

const CenterLines: React.FC = () => (
  <div className="pointer-events-none absolute inset-0">
    <div className="absolute inset-y-0 left-1/2 w-px bg-accent/50" />
    <div className="absolute inset-x-0 top-1/2 h-px bg-accent/50" />
  </div>
);

type ZoomMode = 'fit' | 0.25 | 0.5 | 1;
type GuideSet = { safe: boolean; thirds: boolean; center: boolean };
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

/** A small menu of checkable / radio items in the preview toolbar. */
const PreviewMenu: React.FC<{ label: string; icon: React.ReactNode; active?: boolean; items: { label: string; checked: boolean; onSelect: () => void }[] }> = ({ label, icon, active, items }) => (
  <DropdownMenu.Root>
    <Tip label={label}>
      <DropdownMenu.Trigger asChild>
        <button aria-label={label} className={cn('btn btn-ghost btn-icon text-muted hover:text-text', active && 'bg-accent/15 text-accent-ink hover:text-accent-ink')}>
          {icon}
        </button>
      </DropdownMenu.Trigger>
    </Tip>
    <DropdownMenu.Portal>
      <DropdownMenu.Content side="top" align="end" sideOffset={6} className="glass-pop z-[90] min-w-40 rounded-xl p-1">
        <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-dim">{label}</DropdownMenu.Label>
        {items.map((it) => (
          <DropdownMenu.Item
            key={it.label}
            onSelect={(e) => {
              e.preventDefault();
              it.onSelect();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-panel-3"
          >
            <Check className={cn('size-3.5 text-accent', !it.checked && 'invisible')} />
            {it.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

export const Preview: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const transcripts = useStudio((s) => s.transcripts);
  const playing = useStudio((s) => s.playing);
  const setPlaying = useStudio((s) => s.setPlaying);
  const setTime = useStudio((s) => s.setTime);
  const ref = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [guides, setGuidesState] = useState<GuideSet>(() => {
    const g = prefs.get<GuideSet | boolean>('guides', { safe: false, thirds: false, center: false });
    return typeof g === 'boolean' ? { safe: g, thirds: false, center: false } : g;
  });
  const setGuides = (g: GuideSet) => {
    prefs.set('guides', g);
    setGuidesState(g);
  };
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit');
  // light proxies of heavy footage play smoothly; renders always use the originals
  const [useProxies, setUseProxiesState] = useState(() => prefs.get('useProxies', true));
  const setUseProxies = (v: boolean) => {
    prefs.set('useProxies', v);
    setUseProxiesState(v);
  };
  const hasProxies = project.assets.some((a) => a.proxy);
  const playbackRate = useStudio((s) => s.playbackRate);
  const range = useStudio((s) => s.range);
  const loopRange = useStudio((s) => s.loopRange);

  const { width, height, fps } = project.canvas;
  const duration = projectDuration(project);
  const durationInFrames = Math.max(1, Math.ceil(duration * fps));
  const portrait = height > width;

  const assetUrls = useMemo(() => Object.fromEntries(project.assets.map((a) => [a.id, mediaUrl(project.id, useProxies && a.proxy ? a.proxy.file : a.file)])), [project.assets, project.id, useProxies]);
  const inputProps = useMemo<CompositionInput>(() => ({ project, assetUrls, transcripts, mode: 'preview' }), [project, assetUrls, transcripts]);

  // fit the canvas inside the available area
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      if (zoomMode !== 'fit') return setSize({ w: Math.round(width * zoomMode), h: Math.round(height * zoomMode) });
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const ar = width / height;
      const w = Math.min(cw, ch * ar);
      setSize({ w: Math.floor(w), h: Math.floor(w / ar) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [width, height, zoomMode]);

  useEffect(() => {
    player.attach(ref.current, fps, durationInFrames);
  });

  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      const past = player.beyondEnd;
      setTime(past !== null && e.detail.frame >= durationInFrames - 1 ? past : e.detail.frame / fps);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWait = () => setBuffering(true);
    const onResume = () => setBuffering(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('seeked', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.addEventListener('ended', onPause);
    p.addEventListener('waiting', onWait);
    p.addEventListener('resume', onResume);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('seeked', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
      p.removeEventListener('ended', onPause);
      p.removeEventListener('waiting', onWait);
      p.removeEventListener('resume', onResume);
    };
  }, [fps, setTime, setPlaying, size.w > 0, durationInFrames]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => player.attach(null, fps, 1), []); // eslint-disable-line react-hooks/exhaustive-deps

  const empty = duration === 0;

  // loop the in/out range (I / O) when asked
  const rangeFrames = loopRange && range ? [Math.max(0, Math.round(range[0] * fps)), Math.min(durationInFrames - 1, Math.round(range[1] * fps) - 1)] : null;
  const inOut = rangeFrames && rangeFrames[1] > rangeFrames[0] ? rangeFrames : null;
  useEffect(() => {
    if (!inOut) return;
    const t = useStudio.getState().time;
    if (t * fps < inOut[0] || t * fps > inOut[1]) player.seek(inOut[0] / fps);
  }, [inOut?.[0], inOut?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stage-grid flex h-full flex-col">
      <div ref={box} className={cn('relative m-3 min-h-0 flex-1', zoomMode === 'fit' ? 'flex items-center justify-center' : 'overflow-auto')}>
        {size.w > 0 && (
          <div className={cn(zoomMode !== 'fit' && 'flex min-h-full min-w-full items-center justify-center p-2')}>
            <div className="relative shrink-0 overflow-hidden rounded-lg shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9),0_0_0_1px_rgb(255_255_255/0.08)]" style={{ width: size.w, height: size.h }}>
              <Player
                ref={ref}
                component={Main}
                inputProps={inputProps}
                durationInFrames={durationInFrames}
                fps={fps}
                compositionWidth={width}
                compositionHeight={height}
                style={{ width: size.w, height: size.h }}
                controls={false}
                clickToPlay={false}
                doubleClickToFullscreen={false}
                spaceKeyToPlayOrPause={false}
                moveToBeginningWhenEnded={false}
                playbackRate={playbackRate}
                inFrame={inOut ? inOut[0] : null}
                outFrame={inOut ? inOut[1] : null}
                loop={loop || Boolean(inOut)}
                acknowledgeRemotionLicense
                errorFallback={({ error }) => (
                  <div className="flex size-full items-center justify-center bg-black p-6 text-center text-sm text-danger">Preview error: {error.message}</div>
                )}
              />
              {guides.safe && <SafeZones portrait={portrait} />}
              {guides.thirds && <ThirdsGrid />}
              {guides.center && <CenterLines />}
              {!empty && <CanvasOverlay canvasWidth={width} canvasHeight={height} />}
              {empty && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_30%_20%,rgb(255_90_31/0.18),transparent_55%),radial-gradient(circle_at_75%_80%,rgb(139_123_255/0.2),transparent_55%),#07080c] p-6 text-center">
                  <span className="tile mb-1 size-14 rounded-2xl text-accent">
                    <Clapperboard className="size-7" />
                  </span>
                  <div className="text-base font-bold">Your video will appear here</div>
                  <div className="max-w-sm text-xs text-muted">Tell the Director what to make, or drag media, graphics and sounds from the left panel onto the timeline.</div>
                </div>
              )}
              {buffering && playing && (
                <div className="pointer-events-none absolute right-2 top-2 z-[3] rounded-full bg-black/60 p-1.5">
                  <Spinner className="size-4 text-white" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex h-11 shrink-0 items-center gap-1 border-t border-line bg-white/[0.025] px-3">
        <TimeDisplay fps={fps} duration={duration} />
        <div className="flex flex-1 items-center justify-center gap-0.5">
          <IconBtn label="Go to start" shortcut="Home" onClick={() => player.seek(0)}>
            <SkipBack className="size-4" />
          </IconBtn>
          <IconBtn label="Previous frame" shortcut="←" onClick={() => player.step(-1)}>
            <StepBack className="size-4" />
          </IconBtn>
          <button
            className="mx-1.5 flex size-9 items-center justify-center rounded-full bg-gradient-to-b from-[#ff7440] to-[#f04a10] text-white shadow-[0_6px_20px_-6px_rgb(255_90_31/0.9)] ring-1 ring-white/20 transition-transform hover:scale-105 disabled:opacity-40 disabled:shadow-none"
            onClick={() => player.toggle()}
            disabled={empty}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
          </button>
          <IconBtn label="Next frame" shortcut="→" onClick={() => player.step(1)}>
            <StepForward className="size-4" />
          </IconBtn>
          <IconBtn label="Go to end" shortcut="End" onClick={() => player.toEnd()}>
            <SkipForward className="size-4" />
          </IconBtn>
        </div>
        <IconBtn label="Loop" active={loop} onClick={() => setLoop((l) => !l)}>
          <Repeat className="size-4" />
        </IconBtn>
        <IconBtn
          label={muted ? 'Unmute' : 'Mute'}
          onClick={() => {
            if (muted) ref.current?.unmute();
            else ref.current?.mute();
            setMuted(!muted);
          }}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </IconBtn>
        <PreviewMenu
          label="Playback speed"
          icon={<Gauge className="size-4" />}
          active={playbackRate !== 1}
          items={SPEEDS.map((r) => ({ label: r === 1 ? 'Normal (1×)' : `${r}×`, checked: Math.abs(playbackRate) === r, onSelect: () => useStudio.setState({ playbackRate: r }) }))}
        />
        <PreviewMenu
          label="Preview zoom"
          icon={<ZoomIn className="size-4" />}
          active={zoomMode !== 'fit'}
          items={(['fit', 0.25, 0.5, 1] as ZoomMode[]).map((z) => ({ label: z === 'fit' ? 'Fit to panel' : `${z * 100}%${z === 1 ? ' (actual pixels)' : ''}`, checked: zoomMode === z, onSelect: () => setZoomMode(z) }))}
        />
        {hasProxies && (
          <PreviewMenu
            label="Playback quality"
            icon={<Feather className="size-4" />}
            active={useProxies}
            items={[
              { label: 'Proxies: smooth editing', checked: useProxies, onSelect: () => setUseProxies(true) },
              { label: 'Originals: full quality', checked: !useProxies, onSelect: () => setUseProxies(false) },
            ]}
          />
        )}
        <PreviewMenu
          label="Guides"
          icon={<Grid3x3 className="size-4" />}
          active={guides.safe || guides.thirds || guides.center}
          items={[
            { label: portrait ? 'Shorts safe zones' : 'Title & action safe', checked: guides.safe, onSelect: () => setGuides({ ...guides, safe: !guides.safe }) },
            { label: 'Rule of thirds', checked: guides.thirds, onSelect: () => setGuides({ ...guides, thirds: !guides.thirds }) },
            { label: 'Center lines', checked: guides.center, onSelect: () => setGuides({ ...guides, center: !guides.center }) },
          ]}
        />
        <IconBtn label="Fullscreen" onClick={() => ref.current?.requestFullscreen()}>
          <Expand className="size-4" />
        </IconBtn>
      </div>
    </div>
  );
};

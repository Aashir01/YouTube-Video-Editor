import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { Clapperboard, Expand, Grid3x3, Pause, Play, Repeat, SkipBack, SkipForward, StepBack, StepForward, Volume2, VolumeX } from 'lucide-react';
import type { CompositionInput } from '../../../shared/schema';
import { projectDuration } from '../../../shared/timeline';
import { Main } from '../../../remotion/Main';
import { mediaUrl } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { player } from '../../lib/player';
import { prefs } from '../../lib/prefs';
import { formatTimecode } from '../../lib/utils';
import { IconBtn, Spinner } from '../ui';

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
  const [guides, setGuides] = useState(() => prefs.get('guides', false));

  const { width, height, fps } = project.canvas;
  const duration = projectDuration(project);
  const durationInFrames = Math.max(1, Math.ceil(duration * fps));
  const portrait = height > width;

  const assetUrls = useMemo(() => Object.fromEntries(project.assets.map((a) => [a.id, mediaUrl(project.id, a.file)])), [project.assets, project.id]);
  const inputProps = useMemo<CompositionInput>(() => ({ project, assetUrls, transcripts, mode: 'preview' }), [project, assetUrls, transcripts]);

  // fit the canvas inside the available area
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const ar = width / height;
      const w = Math.min(cw, ch * ar);
      setSize({ w: Math.floor(w), h: Math.floor(w / ar) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  useEffect(() => {
    player.attach(ref.current, fps, durationInFrames);
  });

  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setTime(e.detail.frame / fps);
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
  }, [fps, setTime, setPlaying, size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => player.attach(null, fps, 1), []); // eslint-disable-line react-hooks/exhaustive-deps

  const empty = duration === 0;

  return (
    <div className="stage-grid flex h-full flex-col">
      <div ref={box} className="relative min-h-0 flex-1 m-3 flex items-center justify-center">
        {size.w > 0 && (
          <div className="relative overflow-hidden rounded-lg shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9),0_0_0_1px_rgb(255_255_255/0.08)]" style={{ width: size.w, height: size.h }}>
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
              clickToPlay={!empty}
              doubleClickToFullscreen
              spaceKeyToPlayOrPause={false}
              moveToBeginningWhenEnded={false}
              loop={loop}
              acknowledgeRemotionLicense
              errorFallback={({ error }) => (
                <div className="flex size-full items-center justify-center bg-black p-6 text-center text-sm text-danger">Preview error: {error.message}</div>
              )}
            />
            {guides && <SafeZones portrait={portrait} />}
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
              <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 p-1.5">
                <Spinner className="size-4 text-white" />
              </div>
            )}
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
        <IconBtn
          label="Safe-zone guides"
          active={guides}
          onClick={() => {
            prefs.set('guides', !guides);
            setGuides(!guides);
          }}
        >
          <Grid3x3 className="size-4" />
        </IconBtn>
        <IconBtn label="Fullscreen" onClick={() => ref.current?.requestFullscreen()}>
          <Expand className="size-4" />
        </IconBtn>
      </div>
    </div>
  );
};

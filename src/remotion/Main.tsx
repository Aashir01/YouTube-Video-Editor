import React, { useMemo } from 'react';
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Clip, CompositionInput, Project, Track } from '../shared/schema';
import { speechIntervals } from '../shared/timeline';
import { animateClip } from '../shared/keyframes';
import { StudioProvider, makeTheme, useStudio, useTheme } from './context';
import { AudioView, BlurView, CaptionsView, CodeView, ImageView, SceneView, TextView, VideoView, VisualFrame } from './clips';
import { useFontsReady } from './fonts';
import { clipFrames } from './effects';

export const usedFonts = (p: Project): string[] => {
  const ids = new Set<string>([p.brand.headingFont, p.brand.bodyFont, p.brand.monoFont, 'inter', 'montserrat']);
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (c.type === 'text') ids.add(c.style.font);
      if (c.type === 'captions' && c.style.font) ids.add(c.style.font);
      if (c.type === 'captions') ids.add(c.style.preset === 'karaoke' ? 'poppins' : c.style.preset === 'typewriter' ? 'space-grotesk' : 'montserrat');
      if (c.type === 'scene' && (c.template === 'quote' || c.template === 'definition' || c.template === 'social-card')) ids.add('playfair');
      if (c.type === 'scene' && c.template === 'callout') ids.add('permanent-marker');
      if (c.type === 'code') ['anton', 'bebas-neue', 'playfair', 'space-grotesk', 'poppins'].forEach((f) => ids.add(f));
    }
  }
  return [...ids];
};

/** Renders a clip as it looks at the current frame: keyframed properties are interpolated here. */
const Animated = <T extends Clip>({ clip, children }: { clip: T; children: (c: T) => React.ReactNode }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return <>{children(clip.keyframes ? animateClip(clip, frame / fps) : clip)}</>;
};

const ClipSequence: React.FC<{ clip: Clip; track: Track }> = ({ clip, track }) => {
  const { fps } = useVideoConfig();
  const { from, durationInFrames } = clipFrames(clip, fps);
  const name = clip.name ?? `${clip.type} ${clip.id}`;
  switch (clip.type) {
    case 'audio':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} layout="none" name={name}>
          <AudioView clip={clip} trackMuted={track.muted} />
        </Sequence>
      );
    case 'captions':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} name={name}>
          <CaptionsView clip={clip} />
        </Sequence>
      );
    case 'video':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} premountFor={fps} name={name}>
          <Animated clip={clip}>
            {(c) => (
              <VisualFrame clip={c}>
                <VideoView clip={c} trackMuted={track.muted} />
              </VisualFrame>
            )}
          </Animated>
        </Sequence>
      );
    case 'image':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} premountFor={Math.round(fps / 2)} name={name}>
          <Animated clip={clip}>
            {(c) => (
              <VisualFrame clip={c}>
                <ImageView clip={c} />
              </VisualFrame>
            )}
          </Animated>
        </Sequence>
      );
    case 'text':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} name={name}>
          <Animated clip={clip}>
            {(c) => (
              <VisualFrame clip={c}>
                <TextView clip={c} />
              </VisualFrame>
            )}
          </Animated>
        </Sequence>
      );
    case 'scene':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} premountFor={Math.round(fps / 2)} name={name}>
          <VisualFrame clip={clip}>
            <SceneView clip={clip} />
          </VisualFrame>
        </Sequence>
      );
    case 'blur':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} name={name}>
          <Animated clip={clip}>{(c) => <BlurView clip={c} />}</Animated>
        </Sequence>
      );
    case 'code':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} premountFor={Math.round(fps / 2)} name={name}>
          <VisualFrame clip={clip}>
            <CodeView clip={clip} />
          </VisualFrame>
        </Sequence>
      );
  }
};

const Watermark: React.FC = () => {
  const studio = useStudio();
  const { u, W, H } = useTheme();
  const brand = studio?.project.brand;
  const url = brand?.logoAssetId ? studio?.assetUrls[brand.logoAssetId] : undefined;
  if (!brand?.watermark || !url) return null;
  return (
    <Img
      src={url}
      style={{ position: 'absolute', right: W * 0.03, bottom: H * 0.04, height: 64 * u, objectFit: 'contain', opacity: 0.7, pointerEvents: 'none' }}
    />
  );
};

/** The free Cutroom AI plan: a small "Made with Cutroom" badge over the last seconds. */
const MadeWith: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const { u, W, H } = useTheme();
  const from = Math.max(0, durationInFrames - Math.round(fps * 3.5));
  if (frame < from) return null;
  const t = (frame - from) / fps;
  const opacity = Math.min(1, t / 0.4, (durationInFrames - frame) / (fps * 0.3));
  return (
    <div
      data-made-with
      style={{
        position: 'absolute',
        left: W * 0.03,
        bottom: H * 0.04,
        display: 'flex',
        alignItems: 'center',
        gap: 10 * u,
        padding: `${8 * u}px ${16 * u}px ${8 * u}px ${10 * u}px`,
        borderRadius: 999,
        background: 'rgba(8, 10, 18, 0.72)',
        border: '1px solid rgba(255, 255, 255, 0.18)',
        color: '#fff',
        fontFamily: 'Inter Variable, Inter, system-ui, sans-serif',
        fontSize: 22 * u,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        opacity,
        transform: `translateY(${(1 - Math.min(1, t / 0.4)) * 12 * u}px)`,
        pointerEvents: 'none',
      }}
    >
      <span style={{ display: 'inline-flex', width: 30 * u, height: 30 * u, borderRadius: 8 * u, background: '#ff5a1f', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 24 24" width={18 * u} height={18 * u} fill="#fff">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
      Made with Cutroom
    </div>
  );
};

export const Main: React.FC<CompositionInput> = ({ project, assetUrls, transcripts, mode, translations, madeWith }) => {
  const { width, height, fps } = useVideoConfig();
  const theme = useMemo(() => makeTheme(project.brand, width, height, fps), [project.brand, width, height, fps]);
  const fonts = useMemo(() => usedFonts(project), [project]);
  useFontsReady(fonts);
  const speech = useMemo(() => speechIntervals(project, transcripts ?? {}), [project, transcripts]);
  const value = useMemo(
    () => ({ project, assetUrls: assetUrls ?? {}, transcripts: transcripts ?? {}, mode: mode ?? 'preview', speech, translations: translations ?? {} }),
    [project, assetUrls, transcripts, mode, speech, translations],
  );
  return (
    <StudioProvider value={value} theme={theme}>
      <AbsoluteFill style={{ backgroundColor: project.canvas.background }}>
        {project.tracks.map((track) =>
          track.hidden ? null : (
            <React.Fragment key={track.id}>
              {track.clips.map((clip) => (
                <ClipSequence key={clip.id} clip={clip} track={track} />
              ))}
            </React.Fragment>
          ),
        )}
        <Watermark />
        {madeWith && <MadeWith />}
      </AbsoluteFill>
    </StudioProvider>
  );
};

import React, { useMemo } from 'react';
import { AbsoluteFill, Img, Sequence, useVideoConfig } from 'remotion';
import type { Clip, CompositionInput, Project, Track } from '../shared/schema';
import { speechIntervals } from '../shared/timeline';
import { StudioProvider, makeTheme, useStudio, useTheme } from './context';
import { AudioView, CaptionsView, CodeView, ImageView, SceneView, TextView, VideoView, VisualFrame } from './clips';
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
          <VisualFrame clip={clip}>
            <VideoView clip={clip} trackMuted={track.muted} />
          </VisualFrame>
        </Sequence>
      );
    case 'image':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} premountFor={Math.round(fps / 2)} name={name}>
          <VisualFrame clip={clip}>
            <ImageView clip={clip} />
          </VisualFrame>
        </Sequence>
      );
    case 'text':
      return (
        <Sequence from={from} durationInFrames={durationInFrames} name={name}>
          <VisualFrame clip={clip}>
            <TextView clip={clip} />
          </VisualFrame>
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

export const Main: React.FC<CompositionInput> = ({ project, assetUrls, transcripts, mode }) => {
  const { width, height, fps } = useVideoConfig();
  const theme = useMemo(() => makeTheme(project.brand, width, height, fps), [project.brand, width, height, fps]);
  const fonts = useMemo(() => usedFonts(project), [project]);
  useFontsReady(fonts);
  const speech = useMemo(() => speechIntervals(project, transcripts ?? {}), [project, transcripts]);
  const value = useMemo(
    () => ({ project, assetUrls: assetUrls ?? {}, transcripts: transcripts ?? {}, mode: mode ?? 'preview', speech }),
    [project, assetUrls, transcripts, mode, speech],
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
      </AbsoluteFill>
    </StudioProvider>
  );
};

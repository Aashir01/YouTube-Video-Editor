import React, { useMemo } from 'react';
import { AbsoluteFill, Img, OffthreadVideo, useVideoConfig } from 'remotion';
import type { ThumbnailInput } from '../shared/schema';
import { StudioProvider, makeTheme, useAssetUrl, useTheme } from './context';
import { useFontsReady } from './fonts';
import { CodeScene } from './code/runtime';
import { Icon, alpha, onColor, parseEmphasis } from './templates/kit';

/**
 * YouTube thumbnail templates (rendered as a PNG still). Props:
 *  text            big headline (2-5 words work best; *word* = highlighted)
 *  subtext         optional small line
 *  imageAssetId    main image (subject/face/product)
 *  image2AssetId   second image (split template)
 *  videoAssetId + time   use a frame of a video as the image
 *  emoji, badge, background ('gradient' | 'dark' | 'light' | 'brand' | 'image')
 */
export const THUMBNAIL_TEMPLATES = ['bold-text', 'split', 'face-reaction', 'minimal', 'news', 'number'] as const;

type P = Record<string, any>;

const Visual: React.FC<{ assetId?: string; videoAssetId?: string; time?: number; style?: React.CSSProperties }> = ({ assetId, videoAssetId, time = 0, style }) => {
  const img = useAssetUrl(assetId);
  const vid = useAssetUrl(videoAssetId);
  const { fps } = useVideoConfig();
  if (img) return <Img src={img} style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }} />;
  if (vid) return <OffthreadVideo src={vid} trimBefore={Math.round(time * fps)} muted style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }} />;
  return null;
};

const Headline: React.FC<{ text: string; size: number; color?: string; highlight?: string; stroke?: number; align?: 'left' | 'center' }> = ({ text, size, color = '#FFFFFF', highlight, stroke = 0, align = 'left' }) => {
  const theme = useTheme();
  return (
    <div
      style={{
        fontFamily: '"Anton", "Montserrat Variable", sans-serif',
        fontSize: size,
        lineHeight: 0.98,
        textTransform: 'uppercase',
        color,
        textAlign: align,
        WebkitTextStroke: stroke ? `${stroke}px #000` : undefined,
        paintOrder: 'stroke fill',
        textShadow: `0 ${size * 0.06}px ${size * 0.14}px rgba(0,0,0,0.55)`,
        letterSpacing: '0.01em',
      }}
    >
      {parseEmphasis(text).map((s, i) => (
        <span key={i} style={s.em ? { color: highlight ?? theme.colors.accent } : undefined}>
          {s.text}
        </span>
      ))}
    </div>
  );
};

const ThumbBackground: React.FC<{ kind?: string }> = ({ kind = 'gradient' }) => {
  const { colors } = useTheme();
  if (kind === 'light') return <AbsoluteFill style={{ background: 'linear-gradient(135deg, #FFFFFF, #E8ECF5)' }} />;
  if (kind === 'dark') return <AbsoluteFill style={{ background: `radial-gradient(circle at 70% 40%, #2A2F45, #07080D 70%)` }} />;
  if (kind === 'brand') return <AbsoluteFill style={{ background: colors.primary }} />;
  return <AbsoluteFill style={{ background: `linear-gradient(120deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }} />;
};

const ThumbnailInner: React.FC<{ template: string; props: P }> = ({ template, props }) => {
  const theme = useTheme();
  const { W, H, colors } = theme;
  const s = W / 1280;
  const text: string = props.text ?? '';
  const hasImage = Boolean(props.imageAssetId || props.videoAssetId);
  switch (template) {
    case 'split':
      return (
        <AbsoluteFill style={{ background: '#000' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', overflow: 'hidden' }}>
            <Visual assetId={props.imageAssetId} videoAssetId={props.videoAssetId} time={props.time} />
          </div>
          <div style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%', overflow: 'hidden' }}>
            <Visual assetId={props.image2AssetId} />
          </div>
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 10 * s, background: colors.accent, transform: 'translateX(-50%) skewX(-8deg)' }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 170 * s, height: 170 * s, borderRadius: 999, background: colors.accent, color: onColor(colors.accent), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Anton", sans-serif', fontSize: 90 * s, boxShadow: `0 0 0 ${10 * s}px #000` }}>VS</div>
          {text ? (
            <div style={{ position: 'absolute', left: 30 * s, right: 30 * s, bottom: 30 * s, display: 'flex', justifyContent: 'center' }}>
              <Headline text={text} size={86 * s} stroke={6 * s} align="center" />
            </div>
          ) : null}
        </AbsoluteFill>
      );
    case 'face-reaction':
      return (
        <AbsoluteFill>
          <ThumbBackground kind={props.background ?? 'gradient'} />
          <div style={{ position: 'absolute', right: 0, bottom: 0, width: '52%', height: '100%', overflow: 'hidden', filter: `drop-shadow(${-12 * s}px 0 0 #FFF) drop-shadow(0 0 ${30 * s}px rgba(0,0,0,0.5))` }}>
            <Visual assetId={props.imageAssetId} videoAssetId={props.videoAssetId} time={props.time} style={{ objectPosition: 'center top' }} />
          </div>
          <div style={{ position: 'absolute', left: 48 * s, top: 70 * s, width: '52%' }}>
            <Headline text={text} size={(text.length > 18 ? 104 : 128) * s} stroke={8 * s} highlight={props.highlight} />
          </div>
          {props.emoji ? <div style={{ position: 'absolute', left: 50 * s, bottom: 40 * s, fontSize: 130 * s }}>{props.emoji}</div> : null}
        </AbsoluteFill>
      );
    case 'minimal':
      return (
        <AbsoluteFill>
          <ThumbBackground kind={props.background ?? 'dark'} />
          {hasImage ? (
            <AbsoluteFill style={{ opacity: 0.35 }}>
              <Visual assetId={props.imageAssetId} videoAssetId={props.videoAssetId} time={props.time} />
            </AbsoluteFill>
          ) : null}
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 70 * s, flexDirection: 'column', gap: 20 * s }}>
            <Headline text={text} size={(text.length > 20 ? 110 : 140) * s} align="center" />
            {props.subtext ? <div style={{ fontFamily: '"Inter Variable", sans-serif', fontWeight: 700, fontSize: 40 * s, color: alpha('#FFFFFF', 0.85) }}>{props.subtext}</div> : null}
          </AbsoluteFill>
        </AbsoluteFill>
      );
    case 'news':
      return (
        <AbsoluteFill style={{ background: '#000' }}>
          <AbsoluteFill>
            <Visual assetId={props.imageAssetId} videoAssetId={props.videoAssetId} time={props.time} />
          </AbsoluteFill>
          <AbsoluteFill style={{ background: 'linear-gradient(180deg, transparent 35%, rgba(0,0,0,0.85))' }} />
          <div style={{ position: 'absolute', left: 40 * s, top: 36 * s, background: '#E11D2E', color: '#FFF', fontFamily: '"Anton", sans-serif', fontSize: 54 * s, padding: `${6 * s}px ${22 * s}px`, transform: 'rotate(-2deg)' }}>{props.badge ?? 'BREAKING'}</div>
          <div style={{ position: 'absolute', left: 40 * s, right: 40 * s, bottom: 40 * s }}>
            <Headline text={text} size={(text.length > 24 ? 88 : 110) * s} stroke={4 * s} />
          </div>
        </AbsoluteFill>
      );
    case 'number':
      return (
        <AbsoluteFill>
          <ThumbBackground kind={props.background ?? 'dark'} />
          {hasImage ? (
            <div style={{ position: 'absolute', right: 0, top: 0, width: '45%', height: '100%', overflow: 'hidden' }}>
              <Visual assetId={props.imageAssetId} videoAssetId={props.videoAssetId} time={props.time} />
            </div>
          ) : null}
          <div style={{ position: 'absolute', left: 50 * s, top: 60 * s, width: hasImage ? '58%' : '90%' }}>
            <div style={{ fontFamily: '"Anton", sans-serif', fontSize: 230 * s, lineHeight: 0.9, color: colors.accent, WebkitTextStroke: `${8 * s}px #000`, paintOrder: 'stroke fill', marginBottom: 24 * s }}>{props.number ?? '#1'}</div>
            <Headline text={text} size={80 * s} stroke={6 * s} />
          </div>
        </AbsoluteFill>
      );
    default: {
      // bold-text
      return (
        <AbsoluteFill>
          <ThumbBackground kind={hasImage && props.background === 'image' ? 'dark' : props.background ?? 'gradient'} />
          {hasImage ? (
            <div style={{ position: 'absolute', right: 0, top: 0, width: props.background === 'image' ? '100%' : '55%', height: '100%', overflow: 'hidden' }}>
              <Visual assetId={props.imageAssetId} videoAssetId={props.videoAssetId} time={props.time} />
              <div style={{ position: 'absolute', inset: 0, background: props.background === 'image' ? 'linear-gradient(90deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 55%, transparent)' : `linear-gradient(90deg, ${colors.primary} 0%, transparent 35%)` }} />
            </div>
          ) : null}
          <div style={{ position: 'absolute', left: 50 * s, top: 0, bottom: 0, width: hasImage ? '56%' : '88%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 * s }}>
            {props.badge ? <div style={{ alignSelf: 'flex-start', background: colors.accent, color: onColor(colors.accent), fontFamily: '"Montserrat Variable", sans-serif', fontWeight: 900, fontSize: 38 * s, padding: `${6 * s}px ${18 * s}px`, borderRadius: 10 * s, textTransform: 'uppercase' }}>{props.badge}</div> : null}
            <Headline text={text} size={(text.length > 22 ? 104 : 132) * s} stroke={7 * s} highlight={props.highlight} />
            {props.subtext ? <div style={{ fontFamily: '"Montserrat Variable", sans-serif', fontWeight: 800, fontSize: 40 * s, color: '#FFFFFF', textShadow: '0 4px 12px rgba(0,0,0,0.6)' }}>{props.subtext}</div> : null}
          </div>
          {props.emoji ? <div style={{ position: 'absolute', right: 40 * s, top: 30 * s, fontSize: 120 * s, transform: 'rotate(12deg)' }}>{props.emoji}</div> : null}
          {props.arrow ? (
            <div style={{ position: 'absolute', left: '50%', bottom: 60 * s, transform: 'rotate(-20deg)' }}>
              <Icon name="arrow" size={180 * s} color={colors.accent} strokeWidth={3.5} />
            </div>
          ) : null}
        </AbsoluteFill>
      );
    }
  }
};

export const ThumbnailComposition: React.FC<ThumbnailInput> = ({ project, assetUrls, thumbnail }) => {
  const { width, height, fps } = useVideoConfig();
  const theme = useMemo(() => makeTheme(project.brand, width, height, fps), [project.brand, width, height, fps]);
  useFontsReady(['anton', 'montserrat', 'inter', project.brand.headingFont]);
  const value = useMemo(() => ({ project, assetUrls, transcripts: {}, mode: 'still' as const, speech: [] }), [project, assetUrls]);
  return (
    <StudioProvider value={value} theme={theme}>
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        {thumbnail.code ? <CodeScene code={thumbnail.code} props={thumbnail.props} label="thumbnail" /> : <ThumbnailInner template={thumbnail.template} props={thumbnail.props} />}
      </AbsoluteFill>
    </StudioProvider>
  );
};


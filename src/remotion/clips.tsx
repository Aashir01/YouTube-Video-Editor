import React, { useMemo } from 'react';
import { AbsoluteFill, Html5Audio, Img, OffthreadVideo, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AudioClip, CaptionsClip, CodeClip, ImageClip, SceneClip, TextClip, VideoClip, VisualClip, Word } from '../shared/schema';
import { captionWords, duckGain, paginateWords } from '../shared/timeline';
import { safeTemplateProps } from '../shared/templates';
import { fontFamily } from '../shared/fonts';
import { useStudio, useTheme } from './context';
import { GradeOverlays, clamp01, clipFrames, gradeFilter, kenBurnsAt, transitionStyle, zoomAt } from './effects';
import { TEMPLATE_COMPONENTS } from './templates';
import { SceneTimingProvider, WordsReveal, alpha, parseEmphasis } from './templates/kit';
import { CodeScene, SceneError } from './code/runtime';

// ---------------------------------------------------------------------------
// Visual frame: placement, transitions, grading
// ---------------------------------------------------------------------------

const hasGrade = (c: VisualClip): c is VideoClip | ImageClip => c.type === 'video' || c.type === 'image';

export const VisualFrame: React.FC<{ clip: VisualClip; children: React.ReactNode }> = ({ clip, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { W, H, u } = theme;
  const { durationInFrames } = clipFrames(clip, fps);
  const tr = transitionStyle(clip.transitionIn, clip.transitionOut, frame, durationInFrames, fps, u);
  const grade = hasGrade(clip) ? gradeFilter(clip.grade) : { vignette: 0 };
  const box = 'box' in clip ? clip.box : undefined;
  const opacity = 'opacity' in clip && clip.type !== 'text' ? clip.opacity : 1;
  const rotation = 'rotation' in clip ? clip.rotation : 0;
  const flip = 'flipX' in clip && clip.flipX;
  const radius = 'radius' in clip ? clip.radius : 0;
  const shadow = 'shadow' in clip && clip.shadow;

  const transforms = [tr.style.transform, rotation ? `rotate(${rotation}deg)` : '', flip ? 'scaleX(-1)' : ''].filter(Boolean).join(' ');
  const filters = [grade.filter, tr.style.filter].filter(Boolean).join(' ');
  const boxStyle: React.CSSProperties = box
    ? { position: 'absolute', left: box.x * W, top: box.y * H, width: box.w * W, height: box.h * H }
    : { position: 'absolute', inset: 0 };

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          ...boxStyle,
          overflow: 'hidden',
          borderRadius: radius * u,
          boxShadow: shadow ? `0 ${24 * u}px ${70 * u}px rgba(0,0,0,0.55)` : undefined,
          opacity: opacity * (tr.style.opacity === undefined ? 1 : Number(tr.style.opacity)),
          transform: transforms || undefined,
          filter: filters || undefined,
          clipPath: tr.style.clipPath,
        }}
      >
        {children}
        <GradeOverlays vignette={grade.vignette} tint={'tint' in grade ? grade.tint : undefined} blend={'blend' in grade ? grade.blend : undefined} />
      </div>
      {tr.flash > 0 ? <AbsoluteFill style={{ backgroundColor: '#FFFFFF', opacity: tr.flash }} /> : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Media clips
// ---------------------------------------------------------------------------

const fadeGain = (f: number, total: number, fadeIn: number, fadeOut: number, fps: number): number => {
  let g = 1;
  if (fadeIn > 0) g *= clamp01(f / (fadeIn * fps));
  if (fadeOut > 0) g *= clamp01((total - f) / (fadeOut * fps));
  return g;
};

export const VideoView: React.FC<{ clip: VideoClip; trackMuted: boolean }> = ({ clip, trackMuted }) => {
  const studio = useStudio();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const src = studio?.assetUrls[clip.assetId];
  if (!src) return <MissingMedia label={clip.assetId} />;
  const z = zoomAt(clip, frame / fps);
  const total = clipFrames(clip, fps).durationInFrames;
  return (
    <OffthreadVideo
      src={src}
      trimBefore={Math.round(clip.trimStart * fps)}
      playbackRate={clip.speed}
      muted={trackMuted || clip.muted || clip.volume === 0}
      volume={(f) => clip.volume * fadeGain(f, total, clip.audioFadeIn, clip.audioFadeOut, fps)}
      pauseWhenBuffering
      style={{
        width: '100%',
        height: '100%',
        objectFit: clip.fit,
        transform: z.scale !== 1 ? `scale(${z.scale})` : undefined,
        transformOrigin: `${z.ox * 100}% ${z.oy * 100}%`,
      }}
    />
  );
};

export const ImageView: React.FC<{ clip: ImageClip }> = ({ clip }) => {
  const studio = useStudio();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const src = studio?.assetUrls[clip.assetId];
  if (!src) return <MissingMedia label={clip.assetId} />;
  const z = kenBurnsAt(clip.kenBurns, frame / fps, clip.duration);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {clip.blurredBackdrop ? (
        <Img src={src} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(40px) brightness(0.6)', transform: 'scale(1.2)' }} />
      ) : null}
      <Img
        src={src}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: clip.fit,
          transform: z.scale !== 1 ? `scale(${z.scale})` : undefined,
          transformOrigin: `${z.ox * 100}% ${z.oy * 100}%`,
        }}
      />
    </AbsoluteFill>
  );
};

export const AudioView: React.FC<{ clip: AudioClip; trackMuted: boolean }> = ({ clip, trackMuted }) => {
  const studio = useStudio();
  const { fps } = useVideoConfig();
  const src = studio?.assetUrls[clip.assetId];
  if (!src || trackMuted) return null;
  const total = clipFrames(clip, fps).durationInFrames;
  const duckLevel = studio?.project.audio.duckLevel ?? 0.22;
  const speech = studio?.speech ?? [];
  return (
    <Html5Audio
      src={src}
      trimBefore={Math.round(clip.trimStart * fps)}
      playbackRate={clip.speed}
      loop={clip.loop}
      loopVolumeCurveBehavior="extend"
      pauseWhenBuffering
      volume={(f) => {
        let v = clip.volume * fadeGain(f, total, clip.fadeIn, clip.fadeOut, fps);
        if (clip.duck) v *= duckGain(clip.start + f / fps, speech, duckLevel);
        return v;
      }}
    />
  );
};

const MissingMedia: React.FC<{ label: string }> = ({ label }) => (
  <AbsoluteFill style={{ background: '#1b1d29', color: '#8a90a8', justifyContent: 'center', alignItems: 'center', fontFamily: 'sans-serif', fontSize: 28 }}>
    Missing media: {label}
  </AbsoluteFill>
);

// ---------------------------------------------------------------------------
// Text clip
// ---------------------------------------------------------------------------

export const TextView: React.FC<{ clip: TextClip }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { W, H, u } = theme;
  const s = clip.style;
  const total = clipFrames(clip, fps).durationInFrames;
  const inP = spring({ frame, fps, config: { damping: clip.animationIn === 'pop' ? 11 : 200 }, durationInFrames: Math.round(fps * 0.6) });
  const outN = Math.round(fps * 0.35);
  const outP = clip.animationOut === 'none' ? 1 : clamp01((total - frame) / outN);
  const highlight = s.highlightColor ?? theme.colors.accent;
  const textStyle: React.CSSProperties = {
    fontFamily: fontFamily(s.font),
    fontSize: s.size * u,
    fontWeight: s.weight,
    color: s.color,
    textAlign: s.align,
    textTransform: s.uppercase ? 'uppercase' : undefined,
    fontStyle: s.italic ? 'italic' : undefined,
    letterSpacing: `${s.letterSpacing}em`,
    lineHeight: s.lineHeight,
    textShadow: s.shadow ? `0 ${4 * u}px ${18 * u}px rgba(0,0,0,0.55)` : undefined,
    WebkitTextStroke: s.strokeWidth > 0 && s.strokeColor ? `${s.strokeWidth * u}px ${s.strokeColor}` : undefined,
    paintOrder: 'stroke fill',
  };
  let content: React.ReactNode;
  let enterStyle: React.CSSProperties = {};
  switch (clip.animationIn) {
    case 'typewriter': {
      const plain = clip.text.replace(/\*([^*]+)\*/g, '$1');
      const n = Math.floor(clamp01(frame / Math.max(1, plain.length * fps * 0.04)) * plain.length);
      content = plain.slice(0, n);
      break;
    }
    case 'words':
      content = <WordsReveal text={clip.text} highlight={highlight} stagger={0.08} />;
      break;
    case 'letters': {
      const plain = clip.text.replace(/\*([^*]+)\*/g, '$1');
      content = plain.split('').map((ch, i) => {
        const p = spring({ frame: frame - i * 1.2, fps, config: { damping: 200 } });
        return (
          <span key={i} style={{ display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 0.4}em)`, whiteSpace: 'pre' }}>
            {ch}
          </span>
        );
      });
      break;
    }
    default:
      content = parseEmphasis(clip.text).map((seg, i) => (
        <span key={i} style={seg.em ? { color: highlight } : undefined}>
          {seg.text}
        </span>
      ));
  }
  switch (clip.animationIn) {
    case 'fade':
      enterStyle = { opacity: inP };
      break;
    case 'rise':
      enterStyle = { opacity: clamp01(inP * 1.4), transform: `translateY(${(1 - inP) * 40 * u}px)` };
      break;
    case 'pop':
      enterStyle = { transform: `scale(${0.5 + 0.5 * inP})`, opacity: clamp01(inP * 2) };
      break;
    case 'slide-left':
      enterStyle = { transform: `translateX(${(1 - inP) * 160 * u}px)`, opacity: inP };
      break;
    case 'slide-right':
      enterStyle = { transform: `translateX(${-(1 - inP) * 160 * u}px)`, opacity: inP };
      break;
    case 'blur-in':
      enterStyle = { filter: `blur(${(1 - inP) * 24 * u}px)`, opacity: inP };
      break;
    case 'scale-down':
      enterStyle = { transform: `scale(${1.4 - 0.4 * inP})`, opacity: inP };
      break;
    default:
      break;
  }
  const exitStyle: React.CSSProperties =
    clip.animationOut === 'none'
      ? {}
      : clip.animationOut === 'pop' || clip.animationOut === 'scale-down'
        ? { transform: `scale(${0.8 + 0.2 * outP})`, opacity: outP }
        : clip.animationOut === 'slide-left'
          ? { transform: `translateX(${-(1 - outP) * 160 * u}px)`, opacity: outP }
          : clip.animationOut === 'rise'
            ? { transform: `translateY(${-(1 - outP) * 30 * u}px)`, opacity: outP }
            : { opacity: outP };
  const box: React.CSSProperties | undefined = s.background
    ? { background: s.background, padding: `${s.padding * u * 0.6}px ${s.padding * u}px`, borderRadius: s.radius * u }
    : undefined;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: clip.x * W,
          top: clip.y * H,
          transform: `translate(-50%, -50%) rotate(${clip.rotation}deg)`,
          width: s.maxWidth * W,
          display: 'flex',
          justifyContent: s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center',
          opacity: clip.opacity,
        }}
      >
        <div style={{ ...exitStyle }}>
          <div style={{ ...enterStyle, ...box, ...textStyle }}>{content}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Scenes (templates) and code scenes
// ---------------------------------------------------------------------------

export const SceneView: React.FC<{ clip: SceneClip }> = ({ clip }) => {
  const { fps } = useVideoConfig();
  const Comp = TEMPLATE_COMPONENTS[clip.template];
  const props = useMemo(() => safeTemplateProps(clip.template, clip.props), [clip.template, clip.props]);
  if (!Comp) return <SceneError label={clip.id} message={`Unknown template "${clip.template}"`} />;
  return (
    <SceneTimingProvider value={{ durationInFrames: clipFrames(clip, fps).durationInFrames, startSec: clip.start }}>
      <Comp {...props} />
    </SceneTimingProvider>
  );
};

export const CodeView: React.FC<{ clip: CodeClip }> = ({ clip }) => {
  const { fps } = useVideoConfig();
  return (
    <SceneTimingProvider value={{ durationInFrames: clipFrames(clip, fps).durationInFrames, startSec: clip.start }}>
      <CodeScene code={clip.code} props={clip.props} label={clip.description ?? clip.id} />
    </SceneTimingProvider>
  );
};

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

const PRESET_DEFAULTS: Record<string, { words: number; chars: number; size: number; font: string; upper: boolean; stroke: number }> = {
  'bold-pop': { words: 3, chars: 20, size: 86, font: 'montserrat', upper: true, stroke: 7 },
  karaoke: { words: 7, chars: 38, size: 62, font: 'poppins', upper: false, stroke: 5 },
  clean: { words: 9, chars: 44, size: 54, font: 'inter', upper: false, stroke: 0 },
  boxed: { words: 8, chars: 42, size: 52, font: 'inter', upper: false, stroke: 0 },
  neon: { words: 4, chars: 24, size: 76, font: 'montserrat', upper: true, stroke: 0 },
  typewriter: { words: 6, chars: 34, size: 62, font: 'space-grotesk', upper: false, stroke: 5 },
  minimal: { words: 7, chars: 40, size: 44, font: 'inter', upper: false, stroke: 0 },
  'highlight-box': { words: 4, chars: 24, size: 78, font: 'montserrat', upper: true, stroke: 6 },
};

export const CaptionsView: React.FC<{ clip: CaptionsClip }> = ({ clip }) => {
  const studio = useStudio();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u, H, W, portrait } = theme;
  const st = clip.style;
  const d = PRESET_DEFAULTS[st.preset] ?? PRESET_DEFAULTS['bold-pop']!;
  const words = useMemo(
    () => (studio ? captionWords(studio.project, clip, studio.transcripts) : clip.words),
    [studio, clip],
  );
  const pages = useMemo(
    () => paginateWords(words, { maxWords: st.maxWordsPerPage ?? d.words, maxChars: (st.maxWordsPerPage ?? d.words) > d.words ? d.chars * 2 : d.chars }),
    [words, st.maxWordsPerPage, d.words, d.chars],
  );
  const t = clip.start + frame / fps;
  const page = pages.find((p) => t >= p.start && t < p.end);
  if (!page) return null;
  const highlight = st.highlightColor ?? theme.colors.accent;
  const size = (st.fontSize ?? d.size) * u * (portrait && (st.fontSize === undefined) ? 1.05 : 1);
  const upper = st.uppercase ?? d.upper;
  const stroke = (st.strokeWidth ?? d.stroke) * u;
  const family = fontFamily(st.font ?? d.font);
  const pageFrame = Math.round((t - page.start) * fps);
  const pageIn = spring({ frame: pageFrame, fps, config: { damping: st.preset === 'bold-pop' || st.preset === 'highlight-box' ? 13 : 200 }, durationInFrames: Math.round(fps * 0.25) });
  const baseY = st.position === 'top' ? H * (portrait ? 0.14 : 0.1) : st.position === 'center' ? H * 0.5 : H * (portrait ? 0.7 : 0.84);
  const y = baseY + st.offsetY * H;
  const activeIdx = page.words.findIndex((w, i) => t >= w.start && (t < (page.words[i + 1]?.start ?? page.end)));

  const strokeStyle: React.CSSProperties = stroke > 0 ? { WebkitTextStroke: `${stroke}px #000`, paintOrder: 'stroke fill' } : {};
  const base: React.CSSProperties = {
    fontFamily: family,
    fontSize: size,
    fontWeight: st.preset === 'minimal' ? 500 : st.preset === 'clean' || st.preset === 'boxed' ? 700 : 900,
    color: st.color,
    textTransform: upper ? 'uppercase' : undefined,
    lineHeight: 1.15,
    textAlign: 'center',
  };

  const renderWord = (w: Word, i: number) => {
    const active = i === activeIdx;
    const spoken = t >= w.start;
    const wordStyle: React.CSSProperties = { display: 'inline-block', margin: `0 ${size * 0.17}px`, whiteSpace: 'pre', transformOrigin: 'center 60%' };
    switch (st.preset) {
      case 'bold-pop': {
        const pop = active ? spring({ frame: Math.round((t - w.start) * fps), fps, config: { damping: 10, stiffness: 180 }, durationInFrames: Math.round(fps * 0.3) }) : 1;
        return (
          <span key={i} style={{ ...wordStyle, ...strokeStyle, color: active ? highlight : st.color, transform: active ? `scale(${1 + 0.1 * pop})` : undefined, textShadow: `0 ${6 * u}px ${18 * u}px rgba(0,0,0,0.6)` }}>
            {w.text}
          </span>
        );
      }
      case 'karaoke': {
        const p = clamp01((t - w.start) / Math.max(0.05, w.end - w.start));
        return (
          <span key={i} style={{ ...wordStyle, ...strokeStyle, backgroundImage: `linear-gradient(90deg, ${highlight} ${p * 100}%, ${st.color} ${p * 100}%)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            {w.text}
          </span>
        );
      }
      case 'typewriter':
        return spoken ? (
          <span key={i} style={{ ...wordStyle, ...strokeStyle, color: active ? highlight : st.color }}>
            {w.text}
          </span>
        ) : null;
      case 'neon':
        return (
          <span key={i} style={{ ...wordStyle, color: active ? '#FFFFFF' : alpha(highlight.startsWith('#') ? highlight : '#22D3EE', 0.9), textShadow: `0 0 ${10 * u}px ${highlight}, 0 0 ${28 * u}px ${highlight}, 0 0 ${56 * u}px ${highlight}` }}>
            {w.text}
          </span>
        );
      case 'highlight-box':
        return (
          <span key={i} style={{ ...wordStyle, ...(active ? {} : strokeStyle), color: active ? '#0B0D17' : st.color, background: active ? highlight : 'transparent', borderRadius: 12 * u, padding: `0 ${10 * u}px`, transform: active ? 'rotate(-2deg) scale(1.06)' : undefined }}>
            {w.text}
          </span>
        );
      case 'boxed':
        return (
          <span key={i} style={{ ...wordStyle, margin: `0 ${size * 0.1}px`, color: active ? highlight : st.color }}>
            {w.text}
          </span>
        );
      default:
        return (
          <span key={i} style={{ ...wordStyle, margin: `0 ${size * 0.1}px` }}>
            {w.text}
          </span>
        );
    }
  };

  const container: React.CSSProperties = {
    position: 'absolute',
    left: W * 0.06,
    right: W * 0.06,
    top: y,
    transform: `translateY(-50%) scale(${st.preset === 'clean' || st.preset === 'minimal' ? 1 : 0.85 + 0.15 * pageIn})`,
    opacity: st.preset === 'clean' || st.preset === 'minimal' ? clamp01(pageIn * 1.5) : 1,
    display: 'flex',
    justifyContent: 'center',
  };
  const inner: React.CSSProperties =
    st.preset === 'boxed'
      ? { ...base, background: st.backgroundColor ?? 'rgba(0,0,0,0.72)', padding: `${10 * u}px ${24 * u}px`, borderRadius: 14 * u, maxWidth: W * 0.84 }
      : st.preset === 'clean' || st.preset === 'minimal'
        ? { ...base, textShadow: `0 ${3 * u}px ${12 * u}px rgba(0,0,0,0.85), 0 0 ${3 * u}px rgba(0,0,0,0.6)`, maxWidth: W * 0.8, background: st.backgroundColor, padding: st.backgroundColor ? `${8 * u}px ${20 * u}px` : undefined, borderRadius: 10 * u }
        : { ...base, maxWidth: W * 0.86, background: st.backgroundColor, padding: st.backgroundColor ? `${8 * u}px ${20 * u}px` : undefined, borderRadius: 16 * u };
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={container}>
        <div style={inner}>
          {page.words.map(renderWord)}
          {st.preset === 'typewriter' && Math.floor(frame / 8) % 2 === 0 ? <span style={{ color: highlight }}>▍</span> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

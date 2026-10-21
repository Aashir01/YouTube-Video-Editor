import React, { createContext, useContext, useMemo } from 'react';
import { AbsoluteFill, Img, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { useAssetUrl, useTheme } from '../context';
import { clamp01 } from '../effects';

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(m)) return null;
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const alpha = (color: string, a: number): string => {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
};

export const luminance = (color: string): number => {
  const rgb = hexToRgb(color);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Black or white, whichever reads better on the given background. */
export const onColor = (bg: string): string => (luminance(bg) > 0.45 ? '#0B0D17' : '#FFFFFF');

export const mix = (a: string, b: string, t: number): string => {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return a;
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

interface SceneTiming {
  durationInFrames: number;
  /** Where the clip starts on the project timeline (seconds). */
  startSec?: number;
}

const SceneTimingContext = createContext<SceneTiming | null>(null);
export const SceneTimingProvider = SceneTimingContext.Provider;

/** Clip-relative timing helpers: entrance springs and an exit fade at the end of the clip. */
export const useScene = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: compDuration } = useVideoConfig();
  const timing = useContext(SceneTimingContext);
  const duration = timing?.durationInFrames ?? compDuration;
  const exitFrames = Math.min(Math.round(fps * 0.4), Math.floor(duration / 4));
  const exit = exitFrames > 0 ? clamp01((duration - frame) / exitFrames) : 1;
  const enter = (delaySec = 0, damping = 200, durationSec?: number) =>
    spring({
      frame: frame - Math.round(delaySec * fps),
      fps,
      config: { damping, mass: 0.9, stiffness: 120 },
      durationInFrames: durationSec ? Math.round(durationSec * fps) : undefined,
    });
  /** progress 0..1 over [startSec, startSec + lengthSec] */
  const progress = (startSec: number, lengthSec: number) =>
    clamp01((frame - startSec * fps) / Math.max(1, lengthSec * fps));
  return { frame, fps, duration, durationSec: duration / fps, exit, enter, progress, t: frame / fps, clipStart: timing?.startSec ?? 0 };
};

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

export type BackgroundType = 'gradient' | 'mesh' | 'grid' | 'dots' | 'solid' | 'spotlight' | 'noise' | 'image' | 'transparent';

const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.08 }) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 10;
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <filter id={`grain${seed}`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#grain${seed})`} />
    </svg>
  );
};

export const Background: React.FC<{ type?: BackgroundType | string; imageAssetId?: string; dim?: number }> = ({
  type = 'mesh',
  imageAssetId,
  dim = 0.55,
}) => {
  const theme = useTheme();
  const { colors, u } = theme;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const imageUrl = useAssetUrl(imageAssetId);

  if (type === 'transparent') return null;
  if (type === 'image' && imageUrl) {
    const s = 1.06 + t * 0.012;
    return (
      <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: 'hidden' }}>
        <Img src={imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${s})` }} />
        <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim * 0.6}) 0%, rgba(0,0,0,${dim}) 70%, rgba(0,0,0,${Math.min(1, dim + 0.2)}) 100%)` }} />
      </AbsoluteFill>
    );
  }
  if (type === 'solid') return <AbsoluteFill style={{ backgroundColor: colors.bg }} />;
  if (type === 'gradient') {
    const angle = 135 + Math.sin(t * 0.4) * 20;
    return (
      <AbsoluteFill style={{ background: `linear-gradient(${angle}deg, ${mix(colors.bg, colors.primary, 0.55)} 0%, ${colors.bg} 55%, ${mix(colors.bg, colors.secondary, 0.45)} 100%)` }}>
        <Grain opacity={0.06} />
      </AbsoluteFill>
    );
  }
  if (type === 'grid') {
    const offset = (t * 40 * u) % (80 * u);
    return (
      <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: 'hidden' }}>
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${alpha(colors.primary, 0.18)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(colors.primary, 0.18)} 1px, transparent 1px)`,
            backgroundSize: `${80 * u}px ${80 * u}px`,
            backgroundPosition: `0px ${offset}px`,
            maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          }}
        />
        <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, ${alpha(colors.primary, 0.25)}, transparent 60%)` }} />
      </AbsoluteFill>
    );
  }
  if (type === 'dots') {
    const offset = (t * 20 * u) % (36 * u);
    return (
      <AbsoluteFill style={{ backgroundColor: colors.bg }}>
        <AbsoluteFill
          style={{
            backgroundImage: `radial-gradient(${alpha(colors.text, 0.16)} ${2 * u}px, transparent ${2.5 * u}px)`,
            backgroundSize: `${36 * u}px ${36 * u}px`,
            backgroundPosition: `${offset}px ${offset}px`,
          }}
        />
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 30%, ${colors.bg} 85%)` }} />
      </AbsoluteFill>
    );
  }
  if (type === 'spotlight') {
    const x = 50 + Math.sin(t * 0.5) * 8;
    return (
      <AbsoluteFill style={{ backgroundColor: colors.bg }}>
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 70% at ${x}% 0%, ${alpha(colors.primary, 0.45)}, transparent 70%)` }} />
        <Grain opacity={0.07} />
      </AbsoluteFill>
    );
  }
  if (type === 'noise') {
    return (
      <AbsoluteFill style={{ background: `radial-gradient(circle at 30% 20%, ${mix(colors.bg, colors.primary, 0.25)}, ${colors.bg} 70%)` }}>
        <Grain opacity={0.16} />
      </AbsoluteFill>
    );
  }
  // mesh (default): soft moving color blobs
  const blob = (color: string, cx: number, cy: number, r: number, phase: number) => {
    const x = cx + Math.sin(t * 0.35 + phase) * 6;
    const y = cy + Math.cos(t * 0.3 + phase) * 6;
    return `radial-gradient(circle at ${x}% ${y}%, ${alpha(color, 0.55)} 0%, transparent ${r}%)`;
  };
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <AbsoluteFill
        style={{
          background: [blob(colors.primary, 18, 22, 48, 0), blob(colors.secondary, 85, 30, 42, 2), blob(colors.accent, 60, 95, 38, 4)].join(','),
          filter: `blur(${30 * u}px)`,
          opacity: 0.9,
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 40%, ${alpha('#000000', 0.45)} 100%)` }} />
      <Grain opacity={0.07} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Splits "*emphasis*" markup into segments. */
export const parseEmphasis = (text: string): { text: string; em: boolean }[] => {
  const out: { text: string; em: boolean }[] = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), em: false });
    out.push({ text: m[1]!, em: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), em: false });
  return out;
};

export const stripEmphasis = (text: string): string => text.replace(/\*([^*]+)\*/g, '$1');

export const RichText: React.FC<{ text: string; highlight?: string; style?: React.CSSProperties; emStyle?: React.CSSProperties }> = ({
  text,
  highlight,
  style,
  emStyle,
}) => {
  const theme = useTheme();
  return (
    <span style={style}>
      {parseEmphasis(text).map((seg, i) =>
        seg.em ? (
          <span key={i} style={{ color: highlight ?? theme.colors.accent, ...emStyle }}>
            {seg.text}
          </span>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </span>
  );
};

/** Word-by-word reveal (rise + fade + blur). Words wrapped in *asterisks* or listed in `emphasis` are highlighted. */
export const WordsReveal: React.FC<{
  text: string;
  delay?: number;
  stagger?: number;
  emphasis?: string[];
  highlight?: string;
  style?: React.CSSProperties;
  wordStyle?: React.CSSProperties;
  mode?: 'rise' | 'pop' | 'blur' | 'drop';
}> = ({ text, delay = 0, stagger = 0.06, emphasis = [], highlight, style, wordStyle, mode = 'rise' }) => {
  const { enter } = useScene();
  const theme = useTheme();
  const emph = new Set(emphasis.map((e) => e.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
  const words: { w: string; em: boolean }[] = [];
  for (const seg of parseEmphasis(text)) {
    for (const w of seg.text.split(/(\s+)/)) {
      if (!w.trim()) continue;
      words.push({ w, em: seg.em || emph.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')) });
    }
  }
  return (
    <span style={{ display: 'inline', ...style }}>
      {words.map(({ w, em }, i) => {
        const p = enter(delay + i * stagger, mode === 'pop' ? 11 : 200);
        const ty = mode === 'drop' ? -(1 - p) * 0.6 : (1 - p) * 0.45;
        const transform =
          mode === 'pop' ? `scale(${0.4 + 0.6 * p})` : `translateY(${ty}em)`;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              marginRight: '0.25em',
              opacity: clamp01(p * 1.3),
              transform,
              filter: mode === 'blur' ? `blur(${(1 - p) * 12 * theme.u}px)` : undefined,
              color: em ? highlight ?? theme.colors.accent : undefined,
              ...wordStyle,
            }}
          >
            {w}
          </span>
        );
      })}
    </span>
  );
};

export const formatNumber = (n: number, decimals = 0): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const CountUp: React.FC<{
  value: number;
  from?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  delay?: number;
  duration?: number;
  style?: React.CSSProperties;
}> = ({ value, from = 0, decimals = 0, prefix = '', suffix = '', delay = 0, duration = 1.6, style }) => {
  const { progress } = useScene();
  const p = progress(delay, duration);
  const eased = 1 - Math.pow(1 - p, 4);
  const v = from + (value - from) * eased;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {prefix}
      {formatNumber(v, decimals)}
      {suffix}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Icons (inline SVG, no external deps)
// ---------------------------------------------------------------------------

export type IconName = 'check' | 'cross' | 'arrow' | 'star' | 'dot' | 'bell' | 'like' | 'quote' | 'play' | 'sparkle' | 'number';

export const Icon: React.FC<{ name: IconName | string; size: number; color: string; strokeWidth?: number }> = ({ name, size, color, strokeWidth = 2.6 }) => {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'check':
      return <svg {...common}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
    case 'cross':
      return <svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case 'arrow':
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'star':
      return <svg {...common} fill={color} stroke="none"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z" /></svg>;
    case 'bell':
      return <svg {...common}><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 004 0" /></svg>;
    case 'like':
      return <svg {...common}><path d="M7 11v9H4v-9zM7 11l4-7a2 2 0 012.6 2.4L12.8 10H19a2 2 0 012 2.3l-1.2 6A2 2 0 0117.8 20H7" /></svg>;
    case 'quote':
      return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M4 17.5c0-4 1.6-7.6 5.4-10.5l1.4 1.6C8.6 10.5 7.7 12.3 7.6 14H10v6H4zm9.5 0c0-4 1.6-7.6 5.4-10.5l1.4 1.6c-2.2 1.9-3.1 3.7-3.2 5.4H19.5v6h-6z" /></svg>;
    case 'play':
      return <svg {...common} fill={color} stroke="none"><path d="M8 5.5v13l11-6.5z" /></svg>;
    case 'sparkle':
      return <svg {...common} fill={color} stroke="none"><path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z" /></svg>;
    default:
      return <svg {...common} fill={color} stroke="none"><circle cx="12" cy="12" r="5" /></svg>;
  }
};

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; accent?: string }> = ({ children, style, accent }) => {
  const { colors, u } = useTheme();
  return (
    <div
      style={{
        background: `linear-gradient(160deg, ${alpha(colors.surface, 0.92)}, ${alpha(colors.surface, 0.78)})`,
        border: `${Math.max(1, 1.5 * u)}px solid ${alpha(accent ?? colors.text, accent ? 0.5 : 0.1)}`,
        borderRadius: 28 * u,
        boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.35)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Pill: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({ children, color, style }) => {
  const { colors, u, fonts } = useTheme();
  const bg = color ?? colors.primary;
  return (
    <span
      style={{
        display: 'inline-block',
        background: bg,
        color: onColor(bg),
        fontFamily: fonts.heading,
        fontWeight: 800,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontSize: 26 * u,
        padding: `${10 * u}px ${22 * u}px`,
        borderRadius: 999,
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/** Centered content column with safe margins. */
export const SafeArea: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; align?: 'center' | 'left' }> = ({ children, style, align = 'center' }) => {
  const { W, H, portrait } = useTheme();
  const padX = portrait ? W * 0.08 : W * 0.08;
  const padY = portrait ? H * 0.12 : H * 0.1;
  return (
    <AbsoluteFill
      style={{
        padding: `${padY}px ${padX}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        textAlign: align,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const SourceNote: React.FC<{ text?: string }> = ({ text }) => {
  const { colors, u, fonts, W, H, portrait } = useTheme();
  const { enter } = useScene();
  if (!text) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: W * 0.08,
        bottom: portrait ? H * 0.08 : H * 0.06,
        fontFamily: fonts.body,
        fontSize: 22 * u,
        color: colors.muted,
        opacity: enter(0.8) * 0.9,
      }}
    >
      Source: {text}
    </div>
  );
};

/** Deterministic pseudo-random helper for code scenes. */
export const rand = (seed: string | number) => random(seed);

export const useStagger = (count: number, startSec: number, gapSec: number, damping = 200) => {
  const { enter } = useScene();
  return useMemo(() => Array.from({ length: count }, (_, i) => i), [count]).map((i) => enter(startSec + i * gapSec, damping));
};

export const interpolateClamp = (v: number, input: number[], output: number[]) =>
  interpolate(v, input, output, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

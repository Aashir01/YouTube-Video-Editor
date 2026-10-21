import React from 'react';
import { AbsoluteFill, Img, interpolate, random } from 'remotion';
import { useAssetUrl, useTheme } from '../context';
import { clamp01 } from '../effects';
import { Background, Pill, RichText, SafeArea, WordsReveal, alpha, stripEmphasis, useScene } from './kit';

type P = Record<string, any>;

export const TitleCard: React.FC<P> = ({ title = '', subtitle = '', kicker = '', align = 'center', animation = 'rise', background = 'mesh', imageAssetId }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit, progress, frame } = useScene();
  const size = (portrait ? 118 : 132) * u * (stripEmphasis(title).length > 28 ? 0.78 : 1);
  const titleStyle: React.CSSProperties = {
    fontFamily: fonts.heading,
    fontWeight: 900,
    fontSize: size,
    lineHeight: 1.02,
    color: colors.text,
    letterSpacing: '-0.02em',
    textShadow: `0 ${6 * u}px ${30 * u}px rgba(0,0,0,0.35)`,
  };
  const underline = enter(0.55);
  let titleNode: React.ReactNode;
  if (animation === 'typewriter') {
    const plain = stripEmphasis(title);
    const n = Math.floor(progress(0.2, Math.max(0.6, plain.length * 0.045)) * plain.length);
    const caretOn = Math.floor(frame / 8) % 2 === 0;
    titleNode = (
      <span style={titleStyle}>
        {plain.slice(0, n)}
        <span style={{ color: colors.accent, opacity: caretOn ? 1 : 0 }}>|</span>
      </span>
    );
  } else if (animation === 'split') {
    const p = enter(0.1);
    titleNode = (
      <span style={{ ...titleStyle, display: 'inline-block', clipPath: `inset(${(1 - p) * 50}% 0 ${(1 - p) * 50}% 0)`, transform: `scaleY(${0.8 + 0.2 * p})` }}>
        <RichText text={title} />
      </span>
    );
  } else if (animation === 'glitch') {
    const p = enter(0.05);
    const jitter = p < 0.98 ? (random(`t${frame}`) - 0.5) * 40 * u * (1 - p) : 0;
    titleNode = (
      <span style={{ ...titleStyle, position: 'relative', display: 'inline-block', transform: `translateX(${jitter}px)`, opacity: clamp01(p * 2) }}>
        <span style={{ position: 'absolute', left: 3 * u, top: 0, color: colors.secondary, opacity: 0.6 * (1 - p) + 0.15, mixBlendMode: 'screen' }}>{stripEmphasis(title)}</span>
        <span style={{ position: 'absolute', left: -3 * u, top: 0, color: colors.primary, opacity: 0.6 * (1 - p) + 0.15, mixBlendMode: 'screen' }}>{stripEmphasis(title)}</span>
        <RichText text={title} />
      </span>
    );
  } else if (animation === 'zoom') {
    const p = enter(0.05, 18);
    titleNode = (
      <span style={{ ...titleStyle, display: 'inline-block', transform: `scale(${1.6 - 0.6 * p})`, opacity: clamp01(p * 1.5), filter: `blur(${(1 - p) * 20 * u}px)` }}>
        <RichText text={title} />
      </span>
    );
  } else {
    titleNode = <WordsReveal text={title} delay={0.15} stagger={0.07} style={titleStyle} />;
  }
  return (
    <AbsoluteFill>
      <Background type={background} imageAssetId={imageAssetId} />
      <SafeArea align={align} style={{ opacity: exit, transform: `scale(${0.96 + 0.04 * exit})` }}>
        {kicker ? (
          <div style={{ marginBottom: 34 * u, opacity: enter(0), transform: `translateY(${(1 - enter(0)) * 20 * u}px)` }}>
            <Pill>{kicker}</Pill>
          </div>
        ) : null}
        <div style={{ maxWidth: W * (portrait ? 0.86 : 0.8) }}>{titleNode}</div>
        <div
          style={{
            height: 10 * u,
            width: 160 * u * underline,
            background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`,
            borderRadius: 99,
            marginTop: 36 * u,
          }}
        />
        {subtitle ? (
          <div
            style={{
              marginTop: 30 * u,
              fontFamily: fonts.body,
              fontWeight: 500,
              fontSize: (portrait ? 46 : 44) * u,
              color: colors.muted,
              maxWidth: W * 0.7,
              opacity: enter(0.6),
              transform: `translateY(${(1 - enter(0.6)) * 24 * u}px)`,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </SafeArea>
    </AbsoluteFill>
  );
};

export const KineticText: React.FC<P> = ({ text = '', emphasis = [], style = 'stack', background = 'mesh' }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit, fps, frame } = useScene();
  const words = stripEmphasis(text).split(/\s+/).filter(Boolean);
  const emph = new Set([...(emphasis as string[]), ...[...text.matchAll(/\*([^*]+)\*/g)].flatMap((m) => m[1]!.split(/\s+/))].map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
  const isEm = (w: string) => emph.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  if (style === 'impact') {
    // one word at a time, huge
    const per = Math.max(0.22, Math.min(0.5, 2.6 / words.length));
    const idx = Math.min(words.length - 1, Math.floor(frame / (per * fps)));
    const local = frame - idx * per * fps;
    const pop = enter(idx * per, 10);
    const w = words[idx] ?? '';
    return (
      <AbsoluteFill>
        <Background type={background} />
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: exit }}>
          <div
            style={{
              fontFamily: fonts.heading,
              fontWeight: 900,
              fontSize: (w.length > 9 ? 150 : 210) * u * (portrait ? 0.85 : 1),
              color: isEm(w) ? colors.accent : colors.text,
              textTransform: 'uppercase',
              transform: `scale(${0.6 + 0.4 * pop}) rotate(${(1 - pop) * -4}deg)`,
              textShadow: `0 ${10 * u}px ${40 * u}px rgba(0,0,0,0.4)`,
              opacity: local < 0 ? 0 : 1,
            }}
          >
            {w}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  if (style === 'flow') {
    return (
      <AbsoluteFill>
        <Background type={background} />
        <SafeArea style={{ opacity: exit }}>
          <div style={{ maxWidth: W * 0.82 }}>
            <WordsReveal
              text={text}
              emphasis={emphasis}
              stagger={0.09}
              mode="blur"
              style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: (portrait ? 92 : 100) * u, lineHeight: 1.12, color: colors.text }}
            />
          </div>
        </SafeArea>
      </AbsoluteFill>
    );
  }
  // stack: one word per line, alternating sizes
  const lines: string[][] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (!last || last.join(' ').length + w.length > (portrait ? 10 : 14) || isEm(w)) lines.push([w]);
    else last.push(w);
  }
  return (
    <AbsoluteFill>
      <Background type={background} />
      <SafeArea style={{ opacity: exit }}>
        {lines.map((line, i) => {
          const p = enter(0.1 + i * 0.16, 14);
          const em = line.some(isEm);
          const fs = (em ? 170 : 104) * u * (portrait ? 0.8 : 1);
          return (
            <div
              key={i}
              style={{
                fontFamily: fonts.heading,
                fontWeight: 900,
                fontSize: fs,
                lineHeight: 1.0,
                textTransform: 'uppercase',
                color: em ? colors.accent : colors.text,
                transform: `translateX(${(1 - p) * (i % 2 ? 1 : -1) * 120 * u}px) skewX(${(1 - p) * -10}deg)`,
                opacity: clamp01(p * 1.5),
                margin: `${6 * u}px 0`,
              }}
            >
              {line.join(' ')}
            </div>
          );
        })}
      </SafeArea>
    </AbsoluteFill>
  );
};

export const ChapterCard: React.FC<P> = ({ number = 1, title = '', subtitle = '', background = 'grid' }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit } = useScene();
  const n = enter(0, 16);
  const t = enter(0.25);
  return (
    <AbsoluteFill>
      <Background type={background} />
      <SafeArea align={portrait ? 'center' : 'left'} style={{ opacity: exit }}>
        <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: portrait ? 'center' : 'center', gap: 50 * u }}>
          <div
            style={{
              fontFamily: fonts.heading,
              fontWeight: 900,
              fontSize: 300 * u,
              lineHeight: 0.85,
              color: 'transparent',
              WebkitTextStroke: `${4 * u}px ${colors.primary}`,
              transform: `scale(${0.7 + 0.3 * n})`,
              opacity: n,
            }}
          >
            {typeof number === 'number' ? String(number).padStart(2, '0') : number}
          </div>
          <div style={{ transform: `translateX(${(1 - t) * 60 * u}px)`, opacity: t, maxWidth: W * 0.6 }}>
            <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 30 * u, letterSpacing: '0.3em', color: colors.accent, textTransform: 'uppercase', marginBottom: 14 * u }}>
              Chapter {number}
            </div>
            <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 96 * u, lineHeight: 1.02, color: colors.text }}>
              <RichText text={title} />
            </div>
            {subtitle ? (
              <div style={{ fontFamily: fonts.body, fontSize: 40 * u, color: colors.muted, marginTop: 20 * u, opacity: enter(0.5) }}>{subtitle}</div>
            ) : null}
          </div>
        </div>
      </SafeArea>
    </AbsoluteFill>
  );
};

export const Question: React.FC<P> = ({ question = '', background = 'spotlight' }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit, t } = useScene();
  const q = enter(0.1, 9);
  const wobble = Math.sin(t * 6) * 4 * (1 - clamp01(t / 2));
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: exit }}>
        <div
          style={{
            position: 'absolute',
            fontFamily: fonts.heading,
            fontWeight: 900,
            fontSize: 900 * u,
            color: alpha(colors.primary, 0.18),
            transform: `scale(${0.6 + 0.4 * q}) rotate(${wobble + 8}deg)`,
          }}
        >
          ?
        </div>
        <div style={{ maxWidth: W * (portrait ? 0.86 : 0.78), textAlign: 'center' }}>
          <WordsReveal text={question} delay={0.2} stagger={0.08} mode="pop" style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: (portrait ? 96 : 110) * u, lineHeight: 1.08, color: colors.text }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const LogoReveal: React.FC<P> = ({ text = '', tagline = '', logoAssetId, background = 'spotlight' }) => {
  const theme = useTheme();
  const { colors, fonts, u } = theme;
  const { enter, exit, progress } = useScene();
  const logoUrl = useAssetUrl(logoAssetId ?? theme.brand.logoAssetId);
  const name = text || theme.brand.channelName || 'Your Channel';
  const p = enter(0.05, 12);
  const sweep = progress(0.4, 0.8);
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: exit, flexDirection: 'column', gap: 30 * u }}>
        {logoUrl ? (
          <Img src={logoUrl} style={{ height: 220 * u, objectFit: 'contain', transform: `scale(${0.5 + 0.5 * p}) rotate(${(1 - p) * -20}deg)`, opacity: clamp01(p * 2) }} />
        ) : null}
        <div style={{ position: 'relative', overflow: 'hidden', padding: `0 ${10 * u}px` }}>
          <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 110 * u, color: colors.text, letterSpacing: '-0.01em', opacity: clamp01(p * 1.5), transform: `translateY(${(1 - p) * 40 * u}px)` }}>
            {name}
          </div>
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: '30%',
              left: `${-40 + sweep * 140}%`,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
              transform: 'skewX(-20deg)',
            }}
          />
        </div>
        {tagline ? (
          <div style={{ fontFamily: fonts.body, fontSize: 40 * u, color: colors.muted, letterSpacing: '0.15em', textTransform: 'uppercase', opacity: enter(0.6) }}>{tagline}</div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Countdown: React.FC<P> = ({ from = 3, label = '', background = 'mesh' }) => {
  const { colors, fonts, u } = useTheme();
  const { frame, fps, durationSec, exit } = useScene();
  const per = durationSec / Math.max(1, from);
  const idx = Math.min(from - 1, Math.floor(frame / (per * fps)));
  const local = (frame - idx * per * fps) / (per * fps);
  const value = from - idx;
  const s = interpolate(local, [0, 0.15, 1], [1.6, 1, 0.92], { extrapolateRight: 'clamp' });
  const ring = clamp01(local);
  const R = 300 * u;
  const C = 2 * Math.PI * R;
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: exit }}>
        <svg width={R * 2 + 40 * u} height={R * 2 + 40 * u} style={{ position: 'absolute' }}>
          <circle cx={R + 20 * u} cy={R + 20 * u} r={R} stroke={alpha(colors.text, 0.12)} strokeWidth={14 * u} fill="none" />
          <circle
            cx={R + 20 * u}
            cy={R + 20 * u}
            r={R}
            stroke={colors.accent}
            strokeWidth={14 * u}
            fill="none"
            strokeDasharray={C}
            strokeDashoffset={C * ring}
            strokeLinecap="round"
            transform={`rotate(-90 ${R + 20 * u} ${R + 20 * u})`}
          />
        </svg>
        <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 360 * u, color: colors.text, transform: `scale(${s})` }}>{value}</div>
        {label ? (
          <div style={{ position: 'absolute', bottom: '12%', fontFamily: fonts.body, fontWeight: 700, fontSize: 44 * u, color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
            {label}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};


import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { useAssetUrl, useTheme } from '../context';
import { clamp01 } from '../effects';
import { Background, Card, Icon, SafeArea, WordsReveal, alpha, onColor, useScene } from './kit';

type P = Record<string, any>;

export const Quote: React.FC<P> = ({ quote = '', author = '', role = '', imageAssetId, background = 'mesh' }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit } = useScene();
  const img = useAssetUrl(imageAssetId);
  const mark = enter(0, 12);
  const words = quote.split(/\s+/).length;
  const fs = (words > 30 ? 52 : words > 18 ? 62 : 76) * u * (portrait ? 0.92 : 1);
  const by = enter(Math.min(2.5, 0.4 + words * 0.05));
  return (
    <AbsoluteFill>
      <Background type={background} />
      <SafeArea style={{ opacity: exit }}>
        <div style={{ transform: `scale(${mark}) rotate(${(1 - mark) * -20}deg)`, marginBottom: 20 * u }}>
          <Icon name="quote" size={130 * u} color={colors.accent} />
        </div>
        <div style={{ maxWidth: W * (portrait ? 0.86 : 0.74) }}>
          <WordsReveal
            text={quote}
            delay={0.25}
            stagger={Math.min(0.06, 1.6 / Math.max(1, words))}
            mode="blur"
            style={{ fontFamily: '"Playfair Display Variable", "DM Serif Display", serif', fontWeight: 600, fontStyle: 'italic', fontSize: fs, lineHeight: 1.3, color: colors.text }}
          />
        </div>
        {author ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 * u, marginTop: 50 * u, opacity: by, transform: `translateY(${(1 - by) * 20 * u}px)` }}>
            {img ? <Img src={img} style={{ width: 96 * u, height: 96 * u, borderRadius: 999, objectFit: 'cover', border: `${4 * u}px solid ${colors.accent}` }} /> : <div style={{ width: 60 * u, height: 4 * u, background: colors.accent }} />}
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: 40 * u, color: colors.text }}>{author}</div>
              {role ? <div style={{ fontFamily: fonts.body, fontSize: 30 * u, color: colors.muted }}>{role}</div> : null}
            </div>
          </div>
        ) : null}
      </SafeArea>
    </AbsoluteFill>
  );
};

export const SocialCard: React.FC<P> = ({ kind = 'post', author = '', handle = '', text = '', source = '', date = '', rating, avatarAssetId, background = 'dots' }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit } = useScene();
  const avatar = useAssetUrl(avatarAssetId);
  const p = enter(0.05, 14);
  const width = portrait ? W * 0.88 : W * 0.62;
  const cardStyle: React.CSSProperties = {
    width,
    transform: `translateY(${(1 - p) * 120 * u}px) rotate(${(1 - p) * 3}deg) scale(${0.9 + 0.1 * p})`,
    opacity: clamp01(p * 1.6),
  };
  let body: React.ReactNode;
  if (kind === 'headline') {
    body = (
      <div style={{ ...cardStyle, background: '#FFFFFF', borderRadius: 18 * u, padding: `${44 * u}px ${48 * u}px`, boxShadow: `0 ${40 * u}px ${90 * u}px rgba(0,0,0,0.5)` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `${3 * u}px solid #111`, paddingBottom: 18 * u, marginBottom: 26 * u }}>
          <div style={{ fontFamily: '"Playfair Display Variable", serif', fontWeight: 900, fontSize: 40 * u, color: '#111' }}>{source || 'The Daily News'}</div>
          <div style={{ fontFamily: fonts.body, fontSize: 24 * u, color: '#555' }}>{date}</div>
        </div>
        <div style={{ fontFamily: '"Playfair Display Variable", serif', fontWeight: 800, fontSize: (text.length > 90 ? 48 : 62) * u, color: '#111', lineHeight: 1.15 }}>{text}</div>
      </div>
    );
  } else {
    const isReview = kind === 'review';
    body = (
      <Card style={{ ...cardStyle, padding: `${40 * u}px ${44 * u}px`, background: kind === 'comment' ? alpha(colors.surface, 0.95) : '#FFFFFF' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 * u, marginBottom: 24 * u }}>
          {avatar ? (
            <Img src={avatar} style={{ width: 84 * u, height: 84 * u, borderRadius: 999, objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 84 * u, height: 84 * u, borderRadius: 999, background: colors.primary, color: onColor(colors.primary), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.heading, fontWeight: 900, fontSize: 40 * u }}>
              {(author || handle || '?').replace('@', '').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <div style={{ fontFamily: fonts.body, fontWeight: 800, fontSize: 34 * u, color: kind === 'comment' ? colors.text : '#0F1419' }}>{author || handle}</div>
            <div style={{ fontFamily: fonts.body, fontSize: 28 * u, color: kind === 'comment' ? colors.muted : '#536471' }}>
              {handle}
              {date ? ` · ${date}` : ''}
            </div>
          </div>
        </div>
        {isReview && rating !== undefined ? (
          <div style={{ display: 'flex', gap: 6 * u, marginBottom: 18 * u }}>
            {Array.from({ length: 5 }, (_, i) => (
              <Icon key={i} name="star" size={40 * u} color={i < Math.round(rating) ? '#FBBF24' : '#D1D5DB'} />
            ))}
          </div>
        ) : null}
        <div style={{ fontFamily: fonts.body, fontWeight: 500, fontSize: (text.length > 160 ? 36 : 44) * u, lineHeight: 1.35, color: kind === 'comment' ? colors.text : '#0F1419' }}>{text}</div>
        {source ? <div style={{ fontFamily: fonts.body, fontSize: 26 * u, color: kind === 'comment' ? colors.muted : '#536471', marginTop: 22 * u }}>{source}</div> : null}
      </Card>
    );
  }
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: exit }}>{body}</AbsoluteFill>
    </AbsoluteFill>
  );
};

export const HighlightText: React.FC<P> = ({ text = '', highlights = [], source = '', background = 'solid' }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit, progress, durationSec } = useScene();
  const intro = enter(0);
  const hls = (highlights as string[]).filter(Boolean);
  // build segments marking highlight ranges in order
  type Seg = { text: string; hl: number };
  const segs: Seg[] = [];
  let rest = text;
  let order = 0;
  while (rest.length) {
    let best: { idx: number; phrase: string } | null = null;
    for (const h of hls) {
      const idx = rest.toLowerCase().indexOf(h.toLowerCase());
      if (idx >= 0 && (!best || idx < best.idx)) best = { idx, phrase: rest.slice(idx, idx + h.length) };
    }
    if (!best) {
      segs.push({ text: rest, hl: -1 });
      break;
    }
    if (best.idx > 0) segs.push({ text: rest.slice(0, best.idx), hl: -1 });
    segs.push({ text: best.phrase, hl: order++ });
    rest = rest.slice(best.idx + best.phrase.length);
  }
  const per = Math.max(0.4, (durationSec * 0.6) / Math.max(1, order));
  return (
    <AbsoluteFill>
      <Background type={background} />
      <SafeArea align="left" style={{ opacity: exit }}>
        <div style={{ maxWidth: W * (portrait ? 0.86 : 0.76), background: alpha(colors.surface, 0.6), borderLeft: `${8 * u}px solid ${colors.accent}`, padding: `${40 * u}px ${48 * u}px`, borderRadius: 12 * u, opacity: intro, transform: `translateY(${(1 - intro) * 30 * u}px)` }}>
          <div style={{ fontFamily: fonts.body, fontWeight: 500, fontSize: (text.length > 220 ? 42 : 52) * u, lineHeight: 1.55, color: colors.text }}>
            {segs.map((s, i) => {
              if (s.hl < 0) return <span key={i}>{s.text}</span>;
              const p = progress(0.6 + s.hl * per, 0.5);
              return (
                <span
                  key={i}
                  style={{
                    backgroundImage: `linear-gradient(${alpha(colors.accent, 0.85)}, ${alpha(colors.accent, 0.85)})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: `${p * 100}% 100%`,
                    color: p > 0.5 ? onColor(colors.accent) : colors.text,
                    borderRadius: 6 * u,
                    padding: `0 ${4 * u}px`,
                    fontWeight: 700,
                  }}
                >
                  {s.text}
                </span>
              );
            })}
          </div>
          {source ? <div style={{ fontFamily: fonts.body, fontSize: 28 * u, color: colors.muted, marginTop: 24 * u }}>— {source}</div> : null}
        </div>
      </SafeArea>
    </AbsoluteFill>
  );
};

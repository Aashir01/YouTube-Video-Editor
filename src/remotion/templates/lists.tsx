import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { useAssetUrl, useTheme } from '../context';
import { clamp01 } from '../effects';
import { Background, Card, Icon, RichText, SafeArea, alpha, onColor, useScene } from './kit';

type P = Record<string, any>;

export const BulletList: React.FC<P> = ({ heading = '', items = [], icon = 'check', background = 'mesh' }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit, durationSec } = useScene();
  const list = (items as string[]).slice(0, 8);
  // spread item reveals over the first ~60% of the clip so narration can follow along
  const gap = Math.min(0.9, Math.max(0.25, (durationSec * 0.6) / Math.max(1, list.length)));
  const h = enter(0);
  const fs = (list.length > 5 ? 48 : 60) * u * (portrait ? 0.92 : 1);
  const iconSize = (list.length > 5 ? 70 : 86) * u;
  return (
    <AbsoluteFill>
      <Background type={background} />
      <SafeArea style={{ opacity: exit }}>
        <div style={{ width: portrait ? W * 0.84 : W * 0.74, textAlign: 'left' }}>
          <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: (portrait ? 80 : 96) * u, color: colors.text, lineHeight: 1.05, marginBottom: 54 * u, opacity: h, transform: `translateY(${(1 - h) * 30 * u}px)` }}>
            <RichText text={heading} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: (list.length > 5 ? 22 : 30) * u }}>
            {list.map((item, i) => {
              const p = enter(0.35 + i * gap);
              const iconBg = i % 3 === 0 ? colors.primary : i % 3 === 1 ? colors.secondary : colors.accent;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 32 * u, opacity: clamp01(p * 1.4), transform: `translateX(${(1 - p) * -80 * u}px)` }}>
                  <div style={{ flex: 'none', width: iconSize, height: iconSize, borderRadius: 24 * u, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 ${10 * u}px ${30 * u}px ${alpha(iconBg, 0.4)}`, transform: `scale(${0.6 + 0.4 * p})` }}>
                    {icon === 'number' ? (
                      <span style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: iconSize * 0.52, color: onColor(iconBg) }}>{i + 1}</span>
                    ) : (
                      <Icon name={icon} size={iconSize * 0.58} color={onColor(iconBg)} />
                    )}
                  </div>
                  <div style={{ fontFamily: fonts.body, fontWeight: 650, fontSize: fs, color: colors.text, lineHeight: 1.2 }}>
                    <RichText text={item} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SafeArea>
    </AbsoluteFill>
  );
};

export const Steps: React.FC<P> = ({ title = '', steps = [], background = 'grid' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit, durationSec, progress } = useScene();
  const list = (steps as { title: string; description?: string }[]).slice(0, 6);
  const gap = Math.min(1.1, Math.max(0.35, (durationSec * 0.65) / Math.max(1, list.length)));
  const line = progress(0.4, gap * list.length);
  const head = enter(0);
  if (portrait) {
    return (
      <AbsoluteFill>
        <Background type={background} />
        <SafeArea style={{ opacity: exit, alignItems: 'stretch' }}>
          {title ? <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 76 * u, color: colors.text, textAlign: 'center', marginBottom: 50 * u, opacity: head }}>{title}</div> : null}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 40 * u, paddingLeft: 20 * u }}>
            <div style={{ position: 'absolute', left: 20 * u + 44 * u, top: 44 * u, width: 6 * u, height: `calc(${line * 100}% - ${88 * u}px)`, background: `linear-gradient(${colors.primary}, ${colors.secondary})`, borderRadius: 99 }} />
            {list.map((s, i) => {
              const p = enter(0.4 + i * gap, 14);
              return (
                <div key={i} style={{ display: 'flex', gap: 30 * u, alignItems: 'center', opacity: clamp01(p * 1.5) }}>
                  <div style={{ flex: 'none', width: 94 * u, height: 94 * u, borderRadius: 999, background: colors.primary, color: onColor(colors.primary), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.heading, fontWeight: 900, fontSize: 44 * u, transform: `scale(${p})`, zIndex: 1 }}>{i + 1}</div>
                  <div style={{ transform: `translateX(${(1 - p) * 40 * u}px)` }}>
                    <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: 52 * u, color: colors.text }}>{s.title}</div>
                    {s.description ? <div style={{ fontFamily: fonts.body, fontSize: 36 * u, color: colors.muted, marginTop: 6 * u }}>{s.description}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </SafeArea>
      </AbsoluteFill>
    );
  }
  const colW = (W * 0.84) / list.length;
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ opacity: exit }}>
        {title ? (
          <div style={{ position: 'absolute', top: H * 0.13, width: '100%', textAlign: 'center', fontFamily: fonts.heading, fontWeight: 900, fontSize: 80 * u, color: colors.text, opacity: head, transform: `translateY(${(1 - head) * 30 * u}px)` }}>{title}</div>
        ) : null}
        <div style={{ position: 'absolute', left: W * 0.08 + colW / 2, top: H * 0.48, width: (W * 0.84 - colW) * line, height: 6 * u, background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`, borderRadius: 99 }} />
        {list.map((s, i) => {
          const p = enter(0.4 + i * gap, 13);
          return (
            <div key={i} style={{ position: 'absolute', left: W * 0.08 + i * colW, width: colW, top: H * 0.48 - 55 * u, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <div style={{ width: 110 * u, height: 110 * u, borderRadius: 999, background: colors.surface, border: `${6 * u}px solid ${p > 0.5 ? colors.primary : alpha(colors.text, 0.2)}`, color: colors.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.heading, fontWeight: 900, fontSize: 48 * u, transform: `scale(${0.5 + 0.5 * p})`, opacity: clamp01(p * 2) }}>{i + 1}</div>
              <div style={{ marginTop: 34 * u, opacity: clamp01(p * 1.3), transform: `translateY(${(1 - p) * 30 * u}px)`, padding: `0 ${12 * u}px` }}>
                <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: (list.length > 4 ? 40 : 48) * u, color: colors.text, lineHeight: 1.1 }}>{s.title}</div>
                {s.description ? <div style={{ fontFamily: fonts.body, fontSize: (list.length > 4 ? 28 : 32) * u, color: colors.muted, marginTop: 12 * u, lineHeight: 1.3 }}>{s.description}</div> : null}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Ranking: React.FC<P> = ({ rank = 1, title = '', description = '', imageAssetId, background = 'mesh' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit } = useScene();
  const img = useAssetUrl(imageAssetId);
  const r = enter(0, 10);
  const t = enter(0.3);
  const i = enter(0.15);
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ opacity: exit, display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: 60 * u, padding: portrait ? `${H * 0.1}px ${W * 0.08}px` : `0 ${W * 0.07}px` }}>
        {img ? (
          <Card style={{ flex: 'none', width: portrait ? W * 0.84 : W * 0.42, height: portrait ? H * 0.34 : H * 0.6, overflow: 'hidden', transform: `scale(${0.85 + 0.15 * i}) rotate(${(1 - i) * -4}deg)`, opacity: i, padding: 0 }}>
            <Img src={img} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </Card>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: portrait || !img ? 'center' : 'flex-start', textAlign: portrait || !img ? 'center' : 'left', maxWidth: img && !portrait ? W * 0.42 : W * 0.8 }}>
          <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 220 * u, lineHeight: 0.9, background: `linear-gradient(135deg, ${colors.accent}, ${colors.primary})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', transform: `scale(${0.4 + 0.6 * r})`, opacity: clamp01(r * 2) }}>
            #{rank}
          </div>
          <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 88 * u, lineHeight: 1.05, color: colors.text, marginTop: 16 * u, opacity: t, transform: `translateY(${(1 - t) * 30 * u}px)` }}>
            <RichText text={title} />
          </div>
          {description ? <div style={{ fontFamily: fonts.body, fontSize: 42 * u, color: colors.muted, marginTop: 18 * u, opacity: enter(0.5) }}>{description}</div> : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

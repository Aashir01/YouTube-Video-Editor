import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo } from 'remotion';
import { useAssetUrl, useStudio, useTheme } from '../context';
import { clamp01 } from '../effects';
import { Background, Icon, RichText, alpha, useScene } from './kit';

type P = Record<string, any>;

const MediaFill: React.FC<{ assetId?: string; style?: React.CSSProperties }> = ({ assetId, style }) => {
  const studio = useStudio();
  const url = useAssetUrl(assetId);
  const asset = studio?.project.assets.find((a) => a.id === assetId);
  const { colors, u, fonts } = useTheme();
  if (!url) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(colors.text, 0.06), color: colors.muted, fontFamily: fonts.body, fontSize: 30 * u, ...style }}>
        {assetId ? 'Missing media' : 'Pick an image'}
      </div>
    );
  }
  if (asset?.kind === 'video') return <OffthreadVideo src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }} />;
  return <Img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }} />;
};

export const ImageShowcase: React.FC<P> = ({ assetId, frame = 'clean', caption = '', url = '', background = 'mesh' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit, t } = useScene();
  const p = enter(0.05, 16);
  const drift = 1 + t * 0.01;
  const capP = enter(0.6);
  let node: React.ReactNode;
  if (frame === 'browser') {
    const w = portrait ? W * 0.9 : W * 0.74;
    node = (
      <div style={{ width: w, borderRadius: 18 * u, overflow: 'hidden', boxShadow: `0 ${40 * u}px ${100 * u}px rgba(0,0,0,0.55)`, background: '#1B1E2B', border: `${1.5 * u}px solid ${alpha('#FFFFFF', 0.08)}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 * u, padding: `${16 * u}px ${20 * u}px`, background: '#14161F' }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <div key={c} style={{ width: 18 * u, height: 18 * u, borderRadius: 99, background: c }} />
          ))}
          <div style={{ flex: 1, marginLeft: 20 * u, background: '#232736', borderRadius: 10 * u, padding: `${8 * u}px ${18 * u}px`, fontFamily: fonts.body, fontSize: 24 * u, color: '#9AA3B8' }}>{url || 'https://'}</div>
        </div>
        <div style={{ width: '100%', aspectRatio: '16 / 9', overflow: 'hidden' }}>
          <MediaFill assetId={assetId} style={{ transform: `scale(${drift})` }} />
        </div>
      </div>
    );
  } else if (frame === 'phone') {
    const h = portrait ? H * 0.7 : H * 0.8;
    node = (
      <div style={{ height: h, aspectRatio: '9 / 19.5', borderRadius: 60 * u, padding: 14 * u, background: '#0E0F14', boxShadow: `0 ${40 * u}px ${100 * u}px rgba(0,0,0,0.6), inset 0 0 0 ${3 * u}px #2A2C36` }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 48 * u, overflow: 'hidden', position: 'relative' }}>
          <MediaFill assetId={assetId} />
          <div style={{ position: 'absolute', top: 14 * u, left: '50%', transform: 'translateX(-50%)', width: 110 * u, height: 32 * u, borderRadius: 99, background: '#000' }} />
        </div>
      </div>
    );
  } else if (frame === 'polaroid') {
    const w = portrait ? W * 0.78 : W * 0.4;
    node = (
      <div style={{ width: w, background: '#FAFAF7', padding: `${22 * u}px ${22 * u}px ${90 * u}px`, boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,0.5)`, transform: `rotate(${-3 + (1 - p) * -6}deg)` }}>
        <div style={{ width: '100%', aspectRatio: '1 / 1', overflow: 'hidden' }}>
          <MediaFill assetId={assetId} style={{ transform: `scale(${drift})` }} />
        </div>
        {caption ? <div style={{ fontFamily: '"Permanent Marker", cursive', fontSize: 40 * u, color: '#222', textAlign: 'center', marginTop: 24 * u }}>{caption}</div> : null}
      </div>
    );
  } else if (frame === 'tilted') {
    const w = portrait ? W * 0.86 : W * 0.66;
    node = (
      <div style={{ width: w, aspectRatio: '16 / 9', borderRadius: 26 * u, overflow: 'hidden', transform: `perspective(${1800 * u}px) rotateY(${-16 + (1 - p) * -20}deg) rotateX(6deg)`, boxShadow: `${40 * u}px ${50 * u}px ${100 * u}px rgba(0,0,0,0.55)` }}>
        <MediaFill assetId={assetId} />
      </div>
    );
  } else {
    const w = portrait ? W * 0.88 : W * 0.72;
    node = (
      <div style={{ width: w, aspectRatio: portrait ? '4 / 5' : '16 / 9', borderRadius: 30 * u, overflow: 'hidden', boxShadow: `0 ${40 * u}px ${100 * u}px rgba(0,0,0,0.5)`, border: `${3 * u}px solid ${alpha(colors.text, 0.12)}` }}>
        <MediaFill assetId={assetId} style={{ transform: `scale(${drift})` }} />
      </div>
    );
  }
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 40 * u, opacity: exit }}>
        <div style={{ transform: `translateY(${(1 - p) * 100 * u}px) scale(${0.9 + 0.1 * p})`, opacity: clamp01(p * 1.5) }}>{node}</div>
        {caption && frame !== 'polaroid' ? (
          <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: 52 * u, color: colors.text, opacity: capP, transform: `translateY(${(1 - capP) * 20 * u}px)`, textAlign: 'center', maxWidth: W * 0.8 }}>
            <RichText text={caption} />
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const EndScreen: React.FC<P> = ({ title = 'Watch next', subtitle = '', showSubscribe = true, background = 'mesh' }) => {
  const theme = useTheme();
  const { colors, fonts, u, portrait, W, H } = theme;
  const { enter, exit } = useScene();
  const a = enter(0);
  const b = enter(0.3, 14);
  const handle = theme.brand.handle;
  // YouTube end-screen elements are added in YouTube Studio; we leave clean, labelled slots for them.
  const slotW = portrait ? W * 0.8 : W * 0.36;
  const slotH = slotW * 0.5625;
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ opacity: exit }}>
        <div style={{ position: 'absolute', top: H * 0.1, width: '100%', textAlign: 'center', fontFamily: fonts.heading, fontWeight: 900, fontSize: 84 * u, color: colors.text, opacity: a, transform: `translateY(${(1 - a) * 30 * u}px)` }}>
          {title}
        </div>
        {subtitle ? <div style={{ position: 'absolute', top: H * 0.1 + 110 * u, width: '100%', textAlign: 'center', fontFamily: fonts.body, fontSize: 40 * u, color: colors.muted, opacity: a }}>{subtitle}</div> : null}
        <div style={{ position: 'absolute', left: portrait ? (W - slotW) / 2 : W * 0.1, top: portrait ? H * 0.32 : H * 0.36, width: slotW, height: slotH, borderRadius: 20 * u, border: `${4 * u}px dashed ${alpha(colors.text, 0.35)}`, background: alpha(colors.surface, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${b})` }}>
          <Icon name="play" size={90 * u} color={alpha(colors.text, 0.6)} />
        </div>
        {showSubscribe ? (
          <div style={{ position: 'absolute', left: portrait ? (W - 300 * u) / 2 : W * 0.62, top: portrait ? H * 0.32 + slotH + 80 * u : H * 0.36 + slotH / 2 - 150 * u, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 * u, transform: `scale(${b})` }}>
            <div style={{ width: 300 * u, height: 300 * u, borderRadius: 999, border: `${4 * u}px dashed ${alpha(colors.text, 0.35)}`, background: alpha(colors.surface, 0.5) }} />
            <div style={{ background: '#FF0033', color: '#FFFFFF', fontFamily: fonts.heading, fontWeight: 800, fontSize: 40 * u, padding: `${16 * u}px ${40 * u}px`, borderRadius: 999 }}>Subscribe</div>
            {handle ? <div style={{ fontFamily: fonts.body, fontSize: 32 * u, color: colors.muted }}>{handle}</div> : null}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};


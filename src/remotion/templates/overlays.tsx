import React from 'react';
import { AbsoluteFill, random } from 'remotion';
import { useStudio, useTheme } from '../context';
import { clamp01 } from '../effects';
import { Icon, alpha, onColor, useScene } from './kit';

type P = Record<string, any>;

export const LowerThird: React.FC<P> = ({ name = '', title = '', position = 'left', style = 'bar' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit } = useScene();
  const a = enter(0, 18);
  const b = enter(0.18);
  const c = enter(0.32);
  const bottom = portrait ? H * 0.24 : H * 0.12;
  const side = W * (portrait ? 0.06 : 0.06);
  const align: React.CSSProperties =
    position === 'center' ? { left: '50%', transform: 'translateX(-50%)', alignItems: 'center' } : position === 'right' ? { right: side, alignItems: 'flex-end' } : { left: side, alignItems: 'flex-start' };
  const dir = position === 'right' ? 1 : -1;
  const nameSize = (portrait ? 54 : 58) * u;
  const titleSize = (portrait ? 34 : 34) * u;
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div style={{ position: 'absolute', bottom, display: 'flex', flexDirection: 'column', ...align }}>
        {style === 'glass' ? (
          <div style={{ background: alpha('#0B0D17', 0.55), border: `${1.5 * u}px solid ${alpha('#FFFFFF', 0.18)}`, borderRadius: 22 * u, padding: `${20 * u}px ${34 * u}px`, transform: `translateY(${(1 - a) * 40 * u}px)`, opacity: clamp01(a * 1.5), boxShadow: `0 ${20 * u}px ${50 * u}px rgba(0,0,0,0.35)` }}>
            <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: nameSize, color: '#FFFFFF' }}>{name}</div>
            {title ? <div style={{ fontFamily: fonts.body, fontWeight: 500, fontSize: titleSize, color: colors.accent, marginTop: 4 * u }}>{title}</div> : null}
          </div>
        ) : style === 'minimal' ? (
          <div style={{ display: 'flex', gap: 22 * u, alignItems: 'stretch' }}>
            <div style={{ width: 8 * u, background: colors.accent, borderRadius: 99, transform: `scaleY(${a})`, transformOrigin: 'top' }} />
            <div>
              <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: nameSize, color: '#FFFFFF', textShadow: `0 ${3 * u}px ${12 * u}px rgba(0,0,0,0.7)`, opacity: b, transform: `translateX(${(1 - b) * 30 * u}px)` }}>{name}</div>
              {title ? <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: titleSize, color: '#FFFFFF', opacity: c * 0.9, textShadow: `0 ${3 * u}px ${12 * u}px rgba(0,0,0,0.7)` }}>{title}</div> : null}
            </div>
          </div>
        ) : style === 'bold' ? (
          <div style={{ transform: `rotate(-2deg)` }}>
            <div style={{ display: 'inline-block', background: colors.accent, color: onColor(colors.accent), fontFamily: fonts.heading, fontWeight: 900, fontSize: nameSize * 1.1, padding: `${10 * u}px ${26 * u}px`, textTransform: 'uppercase', clipPath: `inset(0 ${(1 - a) * 100}% 0 0)` }}>{name}</div>
            {title ? (
              <div>
                <div style={{ display: 'inline-block', background: '#0B0D17', color: '#FFFFFF', fontFamily: fonts.body, fontWeight: 700, fontSize: titleSize, padding: `${8 * u}px ${22 * u}px`, clipPath: `inset(0 ${(1 - b) * 100}% 0 0)` }}>{title}</div>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: align.alignItems }}>
            <div style={{ overflow: 'hidden', display: 'flex', alignItems: 'stretch' }}>
              <div style={{ width: 12 * u, background: colors.accent, transform: `scaleY(${a})` }} />
              <div style={{ background: colors.primary, padding: `${12 * u}px ${30 * u}px`, transform: `translateX(${dir * (1 - b) * 105}%)` }}>
                <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: nameSize, color: onColor(colors.primary), whiteSpace: 'nowrap' }}>{name}</div>
              </div>
            </div>
            {title ? (
              <div style={{ overflow: 'hidden' }}>
                <div style={{ background: alpha('#0B0D17', 0.85), padding: `${8 * u}px ${30 * u}px`, marginLeft: position === 'right' ? 0 : 12 * u, transform: `translateX(${dir * (1 - c) * 105}%)` }}>
                  <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: titleSize, color: '#FFFFFF', whiteSpace: 'nowrap' }}>{title}</div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

export const Callout: React.FC<P> = ({ label = '', x = 0.5, y = 0.5, shape = 'circle', width = 0.16, height = 0.12, color }) => {
  const { colors, fonts, u, W, H } = useTheme();
  const { progress, enter, exit } = useScene();
  const c = color ?? colors.accent;
  const draw = progress(0.05, 0.6);
  const cx = x * W;
  const cy = y * H;
  const w = width * W;
  const h = height * H;
  const lab = enter(0.45);
  const labelOnLeft = x > 0.6;
  const labelNode = label ? (
    <div
      style={{
        position: 'absolute',
        left: labelOnLeft ? undefined : cx + w / 2 + 30 * u,
        right: labelOnLeft ? W - (cx - w / 2 - 30 * u) : undefined,
        top: cy - 40 * u,
        background: c,
        color: onColor(c),
        fontFamily: fonts.heading,
        fontWeight: 800,
        fontSize: 40 * u,
        padding: `${12 * u}px ${24 * u}px`,
        borderRadius: 14 * u,
        opacity: lab,
        transform: `scale(${0.7 + 0.3 * lab})`,
        boxShadow: `0 ${12 * u}px ${30 * u}px rgba(0,0,0,0.4)`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </div>
  ) : null;
  let shapeNode: React.ReactNode = null;
  const sw = 8 * u;
  if (shape === 'circle') {
    const rx = w / 2;
    const ry = h / 2;
    const C = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    shapeNode = (
      <svg style={{ position: 'absolute', left: 0, top: 0 }} width={W} height={H}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - draw)} transform={`rotate(-8 ${cx} ${cy})`} style={{ filter: `drop-shadow(0 0 ${8 * u}px ${alpha(c, 0.7)})` }} />
      </svg>
    );
  } else if (shape === 'box') {
    const per = 2 * (w + h);
    shapeNode = (
      <svg style={{ position: 'absolute', left: 0, top: 0 }} width={W} height={H}>
        <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={14 * u} fill={alpha(c, 0.08 * draw)} stroke={c} strokeWidth={sw} strokeDasharray={per} strokeDashoffset={per * (1 - draw)} />
      </svg>
    );
  } else if (shape === 'underline') {
    shapeNode = (
      <svg style={{ position: 'absolute', left: 0, top: 0 }} width={W} height={H}>
        <path d={`M ${cx - w / 2} ${cy} Q ${cx} ${cy + 18 * u} ${cx + w / 2} ${cy - 6 * u}`} fill="none" stroke={c} strokeWidth={sw * 1.3} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
      </svg>
    );
  } else {
    // arrow pointing at (x, y) from the label side
    const fromX = labelOnLeft ? cx - 240 * u : cx + 240 * u;
    const fromY = cy - 160 * u;
    const ex = cx + (fromX > cx ? 20 * u : -20 * u);
    const ey = cy - 20 * u;
    const ctrlX = (fromX + ex) / 2;
    const ctrlY = fromY;
    const ang = Math.atan2(ey - ctrlY, ex - ctrlX);
    const head = 34 * u;
    shapeNode = (
      <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width={W} height={H}>
        <path d={`M ${fromX} ${fromY} Q ${ctrlX} ${ctrlY} ${ex} ${ey}`} fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
        {draw > 0.95 ? (
          <path d={`M ${ex} ${ey} L ${ex - head * Math.cos(ang - 0.5)} ${ey - head * Math.sin(ang - 0.5)} M ${ex} ${ey} L ${ex - head * Math.cos(ang + 0.5)} ${ey - head * Math.sin(ang + 0.5)}`} stroke={c} strokeWidth={sw} strokeLinecap="round" />
        ) : null}
      </svg>
    );
    return (
      <AbsoluteFill style={{ opacity: exit }}>
        {shapeNode}
        {label ? (
          <div style={{ position: 'absolute', left: fromX - (labelOnLeft ? 300 * u : -10 * u), top: fromY - 90 * u, width: 300 * u, textAlign: labelOnLeft ? 'right' : 'left', fontFamily: '"Permanent Marker", cursive', fontSize: 52 * u, color: c, opacity: lab, textShadow: `0 ${3 * u}px ${10 * u}px rgba(0,0,0,0.6)` }}>{label}</div>
        ) : null}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {shapeNode}
      {labelNode}
    </AbsoluteFill>
  );
};

export const SubscribeCta: React.FC<P> = ({ text = 'Subscribe', handle = '', position = 'bottom-center', showLike = true, showBell = true }) => {
  const theme = useTheme();
  const { fonts, u, W, H, colors } = theme;
  const { enter, exit, frame, fps, durationSec } = useScene();
  const pop = enter(0.05, 11);
  const clickAt = Math.min(1.4, durationSec * 0.4);
  const clicked = frame / fps > clickAt;
  const press = enter(clickAt, 10);
  const pos: React.CSSProperties =
    position === 'center'
      ? { left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${pop})` }
      : position === 'bottom-left'
        ? { left: W * 0.05, bottom: H * 0.08, transform: `scale(${pop})`, transformOrigin: 'left bottom' }
        : position === 'bottom-right'
          ? { right: W * 0.05, bottom: H * 0.08, transform: `scale(${pop})`, transformOrigin: 'right bottom' }
          : position === 'top-right'
            ? { right: W * 0.05, top: H * 0.06, transform: `scale(${pop})`, transformOrigin: 'right top' }
            : { left: '50%', bottom: H * 0.1, transform: `translateX(-50%) scale(${pop})`, transformOrigin: 'center bottom' };
  const bell = showBell && clicked ? Math.sin((frame / fps - clickAt) * 30) * 18 * Math.max(0, 1 - (frame / fps - clickAt) * 1.5) : 0;
  const cursorP = enter(clickAt - 0.5);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', gap: 18 * u, background: alpha('#0B0D17', 0.72), border: `${1.5 * u}px solid ${alpha('#FFFFFF', 0.16)}`, borderRadius: 999, padding: `${12 * u}px ${14 * u}px ${12 * u}px ${28 * u}px`, boxShadow: `0 ${16 * u}px ${40 * u}px rgba(0,0,0,0.4)`, ...pos }}>
        {handle || theme.brand.channelName ? (
          <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: 34 * u, color: '#FFFFFF', whiteSpace: 'nowrap' }}>{handle || theme.brand.channelName}</div>
        ) : null}
        {showLike ? (
          <div style={{ width: 70 * u, height: 70 * u, borderRadius: 999, background: clicked ? colors.secondary : alpha('#FFFFFF', 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${clicked ? 1 + 0.15 * (1 - press) : 1})` }}>
            <Icon name="like" size={40 * u} color="#FFFFFF" />
          </div>
        ) : null}
        <div style={{ position: 'relative', background: clicked ? alpha('#FFFFFF', 0.18) : '#FF0033', color: '#FFFFFF', fontFamily: fonts.heading, fontWeight: 800, fontSize: 36 * u, padding: `${16 * u}px ${36 * u}px`, borderRadius: 999, transform: `scale(${clicked ? 0.94 + 0.06 * press : 1})`, whiteSpace: 'nowrap' }}>
          {clicked ? 'Subscribed' : text}
        </div>
        {showBell ? (
          <div style={{ transform: `rotate(${bell}deg)`, transformOrigin: 'top center' }}>
            <Icon name="bell" size={52 * u} color="#FFFFFF" />
          </div>
        ) : null}
        {cursorP > 0 && !clicked ? (
          <svg width={60 * u} height={60 * u} viewBox="0 0 24 24" style={{ position: 'absolute', right: (showBell ? 90 : 20) * u + (1 - cursorP) * 120 * u, bottom: -30 * u + (1 - cursorP) * -60 * u }}>
            <path d="M5 3l14 8-6 2-3 6z" fill="#FFFFFF" stroke="#000" strokeWidth={1.2} />
          </svg>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const ProgressBar: React.FC<P> = ({ position = 'bottom', chapters = [], showLabel = true }) => {
  const studio = useStudio();
  const { colors, fonts, u, W } = useTheme();
  const { frame, fps, clipStart } = useScene();
  // Use absolute project time so the bar reflects the whole video even if the clip starts later.
  const offset = clipStart;
  const projectEnd = studio ? Math.max(1, ...studio.project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration))) : 1;
  const chs = (chapters as { time: number; title: string }[]).length ? (chapters as { time: number; title: string }[]) : studio?.project.youtube.chapters ?? [];
  const tNow = offset + frame / fps;
  const p = clamp01(tNow / projectEnd);
  const current = [...chs].reverse().find((c) => c.time <= tNow);
  const barH = 10 * u;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, [position === 'top' ? 'top' : 'bottom']: 0, height: barH, background: alpha('#000000', 0.35) }}>
        <div style={{ height: '100%', width: `${p * 100}%`, background: `linear-gradient(90deg, ${colors.primary}, ${colors.accent})` }} />
        {chs.map((c, i) => (i === 0 ? null : <div key={i} style={{ position: 'absolute', left: `${(c.time / projectEnd) * 100}%`, top: 0, bottom: 0, width: 4 * u, background: alpha('#000000', 0.6) }} />))}
      </div>
      {showLabel && current ? (
        <div style={{ position: 'absolute', [position === 'top' ? 'top' : 'bottom']: barH + 14 * u, left: Math.min(W - 400 * u, Math.max(20 * u, p * W - 100 * u)), fontFamily: fonts.body, fontWeight: 700, fontSize: 26 * u, color: '#FFFFFF', background: alpha('#0B0D17', 0.6), padding: `${6 * u}px ${16 * u}px`, borderRadius: 10 * u }}>
          {current.title}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const EmojiBurst: React.FC<P> = ({ emoji = '🔥', count = 14, x = 0.5, y = 0.6 }) => {
  const { u, W, H } = useTheme();
  const { frame, fps, exit } = useScene();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {Array.from({ length: count }, (_, i) => {
        const ang = random(`a${i}`) * Math.PI * 2;
        const speed = (220 + random(`s${i}`) * 420) * u;
        const delay = random(`d${i}`) * 0.25;
        const tt = Math.max(0, t - delay);
        const px = x * W + Math.cos(ang) * speed * tt;
        const py = y * H + Math.sin(ang) * speed * tt * 0.7 + 520 * u * tt * tt;
        const size = (60 + random(`z${i}`) * 70) * u;
        const rot = (random(`r${i}`) - 0.5) * 360 * tt;
        const o = tt === 0 ? 0 : clamp01(2.2 - tt * 1.1);
        return (
          <div key={i} style={{ position: 'absolute', left: px - size / 2, top: py - size / 2, fontSize: size, transform: `rotate(${rot}deg) scale(${Math.min(1, tt * 6)})`, opacity: o }}>
            {emoji}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

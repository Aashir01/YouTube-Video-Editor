import React from 'react';
import { AbsoluteFill } from 'remotion';
import { evolvePath } from '@remotion/paths';
import { useTheme } from '../context';
import { clamp01 } from '../effects';
import { Background, Card, CountUp, RichText, SafeArea, SourceNote, alpha, formatNumber, useScene } from './kit';

type P = Record<string, any>;

const palette = (colors: { primary: string; secondary: string; accent: string }) => [
  colors.primary,
  colors.secondary,
  colors.accent,
  '#F472B6',
  '#34D399',
  '#FB923C',
  '#60A5FA',
];

export const BigNumber: React.FC<P> = ({ value = 0, prefix = '', suffix = '', decimals = 0, label = '', sublabel = '', countFrom = 0, background = 'spotlight' }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit } = useScene();
  const p = enter(0, 14);
  const l = enter(0.5);
  const digits = formatNumber(value, decimals).length + prefix.length + suffix.length;
  const fs = Math.min(320, 1500 / Math.max(3, digits)) * u * (portrait ? 0.9 : 1);
  return (
    <AbsoluteFill>
      <Background type={background} />
      <SafeArea style={{ opacity: exit }}>
        <div
          style={{
            fontFamily: fonts.heading,
            fontWeight: 900,
            fontSize: fs,
            lineHeight: 1,
            letterSpacing: '-0.03em',
            background: `linear-gradient(180deg, ${colors.text} 30%, ${alpha(colors.text, 0.7)})`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            transform: `scale(${0.7 + 0.3 * p})`,
            opacity: clamp01(p * 2),
            filter: `drop-shadow(0 ${12 * u}px ${40 * u}px ${alpha(colors.primary, 0.45)})`,
          }}
        >
          <CountUp value={value} from={countFrom} decimals={decimals} prefix={prefix} suffix={suffix} delay={0.1} duration={1.5} />
        </div>
        <div style={{ height: 8 * u, width: 220 * u * l, background: colors.accent, borderRadius: 99, margin: `${30 * u}px 0` }} />
        <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: 60 * u, color: colors.text, maxWidth: W * 0.75, opacity: l, transform: `translateY(${(1 - l) * 20 * u}px)` }}>
          <RichText text={label} />
        </div>
        {sublabel ? <div style={{ fontFamily: fonts.body, fontSize: 32 * u, color: colors.muted, marginTop: 18 * u, opacity: enter(0.8) }}>{sublabel}</div> : null}
      </SafeArea>
    </AbsoluteFill>
  );
};

export const StatGrid: React.FC<P> = ({ title = '', stats = [], background = 'mesh' }) => {
  const { colors, fonts, u, portrait, W } = useTheme();
  const { enter, exit } = useScene();
  const list = (stats as { value: number; prefix?: string; suffix?: string; decimals?: number; label: string }[]).slice(0, 4);
  const cols = portrait ? 1 : list.length === 4 ? 2 : list.length;
  const accents = palette(colors);
  return (
    <AbsoluteFill>
      <Background type={background} />
      <SafeArea style={{ opacity: exit }}>
        {title ? <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 76 * u, color: colors.text, marginBottom: 50 * u, opacity: enter(0) }}>{title}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 34 * u, width: portrait ? W * 0.84 : W * (cols === 2 ? 0.66 : 0.84) }}>
          {list.map((s, i) => {
            const p = enter(0.25 + i * 0.18, 16);
            return (
              <Card key={i} accent={accents[i]} style={{ padding: `${40 * u}px ${30 * u}px`, textAlign: 'center', transform: `translateY(${(1 - p) * 60 * u}px) scale(${0.9 + 0.1 * p})`, opacity: clamp01(p * 1.4) }}>
                <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: (portrait ? 110 : list.length > 3 ? 100 : 120) * u, color: accents[i], lineHeight: 1 }}>
                  <CountUp value={s.value} decimals={s.decimals ?? 0} prefix={s.prefix ?? ''} suffix={s.suffix ?? ''} delay={0.3 + i * 0.18} />
                </div>
                <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 34 * u, color: colors.text, marginTop: 16 * u, lineHeight: 1.25 }}>{s.label}</div>
              </Card>
            );
          })}
        </div>
      </SafeArea>
    </AbsoluteFill>
  );
};

export const BarChart: React.FC<P> = ({ title = '', data = [], unit = '', highlightIndex, orientation = 'vertical', source = '', background = 'grid' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit, progress } = useScene();
  const rows = (data as { label: string; value: number; color?: string }[]).slice(0, 12);
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  const horizontal = orientation === 'horizontal' || portrait;
  const chartW = W * 0.84;
  const chartH = portrait ? H * 0.58 : H * 0.56;
  const head = enter(0);
  const decimals = rows.some((r) => !Number.isInteger(r.value)) ? 1 : 0;
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ opacity: exit, padding: `${H * 0.1}px ${W * 0.08}px`, display: 'flex', flexDirection: 'column', justifyContent: portrait ? 'center' : 'flex-start' }}>
        <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: (portrait ? 64 : 70) * u, color: colors.text, opacity: head, transform: `translateY(${(1 - head) * 24 * u}px)`, marginBottom: 40 * u }}>
          <RichText text={title} />
        </div>
        {horizontal ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: (rows.length > 7 ? 14 : 24) * u, width: chartW }}>
            {rows.map((r, i) => {
              const p = 1 - Math.pow(1 - progress(0.3 + i * 0.1, 1.1), 3);
              const hl = highlightIndex === i;
              const barColor = r.color ?? (hl ? colors.accent : highlightIndex === undefined ? palette(colors)[i % 7]! : alpha(colors.primary, 0.75));
              const barH = Math.min(portrait ? 84 : 70, chartH / u / rows.length - 20) * u;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 24 * u }}>
                  <div style={{ width: chartW * 0.24, fontFamily: fonts.body, fontWeight: 600, fontSize: 32 * u, color: colors.text, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
                  <div style={{ flex: 1, height: barH, position: 'relative' }}>
                    <div style={{ height: '100%', width: `${(r.value / max) * 100 * p}%`, background: barColor, borderRadius: 12 * u, boxShadow: hl ? `0 0 ${30 * u}px ${alpha(barColor, 0.6)}` : undefined }} />
                  </div>
                  <div style={{ width: chartW * 0.14, fontFamily: fonts.heading, fontWeight: 800, fontSize: 34 * u, color: hl ? colors.accent : colors.text, opacity: p }}>
                    {formatNumber(r.value * p, decimals)}
                    {unit}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 * u, height: chartH, width: chartW, borderBottom: `${3 * u}px solid ${alpha(colors.text, 0.25)}` }}>
            {rows.map((r, i) => {
              const p = 1 - Math.pow(1 - progress(0.3 + i * 0.09, 1.1), 3);
              const hl = highlightIndex === i;
              const barColor = r.color ?? (hl ? colors.accent : highlightIndex === undefined ? palette(colors)[i % 7]! : alpha(colors.primary, 0.75));
              return (
                <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: (rows.length > 8 ? 26 : 34) * u, color: hl ? colors.accent : colors.text, marginBottom: 10 * u, opacity: p }}>
                    {formatNumber(r.value * p, decimals)}
                    {unit}
                  </div>
                  <div style={{ width: '100%', height: `${(r.value / max) * 82 * p}%`, background: `linear-gradient(180deg, ${barColor}, ${alpha(barColor, 0.65)})`, borderRadius: `${12 * u}px ${12 * u}px 0 0`, boxShadow: hl ? `0 0 ${40 * u}px ${alpha(barColor, 0.55)}` : undefined }} />
                </div>
              );
            })}
          </div>
        )}
        {!horizontal ? (
          <div style={{ display: 'flex', gap: 24 * u, width: chartW, marginTop: 14 * u }}>
            {rows.map((r, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontFamily: fonts.body, fontWeight: 600, fontSize: (rows.length > 8 ? 22 : 28) * u, color: colors.muted }}>
                {r.label}
              </div>
            ))}
          </div>
        ) : null}
      </AbsoluteFill>
      <SourceNote text={source} />
    </AbsoluteFill>
  );
};

export const LineChart: React.FC<P> = ({ title = '', labels = [], series = [], unit = '', source = '', background = 'grid' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit, progress } = useScene();
  const ser = (series as { name: string; values: number[]; color?: string }[]).slice(0, 4);
  const labs = labels as string[];
  const all = ser.flatMap((s) => s.values);
  const minV = Math.min(0, ...all);
  const maxV = Math.max(1e-9, ...all);
  const cw = W * 0.8;
  const ch = portrait ? H * 0.42 : H * 0.5;
  const n = Math.max(2, labs.length, ...ser.map((s) => s.values.length));
  const x = (i: number) => (i / (n - 1)) * cw;
  const y = (v: number) => ch - ((v - minV) / (maxV - minV)) * ch * 0.9;
  const draw = progress(0.4, 1.8);
  const head = enter(0);
  const cols = palette(colors);
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ opacity: exit, padding: `${H * 0.1}px ${W * 0.1}px`, display: 'flex', flexDirection: 'column', justifyContent: portrait ? 'center' : 'flex-start' }}>
        <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 68 * u, color: colors.text, opacity: head, marginBottom: 50 * u }}>
          <RichText text={title} />
        </div>
        <svg width={cw + 40 * u} height={ch + 60 * u} style={{ overflow: 'visible' }}>
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <line key={g} x1={0} x2={cw} y1={ch - g * ch * 0.9} y2={ch - g * ch * 0.9} stroke={alpha(colors.text, 0.1)} strokeWidth={2 * u} />
          ))}
          {ser.map((s, si) => {
            const pts = s.values.map((v, i) => [x(i), y(v)] as const);
            const d = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
            const color = s.color ?? cols[si % cols.length]!;
            const ev = evolvePath(draw, d);
            const area = `${d} L ${x(s.values.length - 1)} ${ch} L 0 ${ch} Z`;
            return (
              <g key={si}>
                {si === 0 ? <path d={area} fill={alpha(color, 0.12 * draw)} /> : null}
                <path d={d} fill="none" stroke={color} strokeWidth={8 * u} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} style={{ filter: `drop-shadow(0 0 ${10 * u}px ${alpha(color, 0.6)})` }} />
                {pts.map(([px, py], i) => {
                  const visible = draw >= i / Math.max(1, pts.length - 1);
                  const last = i === pts.length - 1;
                  return visible ? (
                    <g key={i}>
                      <circle cx={px} cy={py} r={(last ? 14 : 9) * u} fill={colors.bg} stroke={color} strokeWidth={5 * u} />
                      {last ? (
                        <text x={px} y={py - 34 * u} textAnchor="middle" fill={color} fontFamily={fonts.heading} fontWeight={900} fontSize={44 * u}>
                          {formatNumber(s.values[i]!, Number.isInteger(s.values[i]) ? 0 : 2)}
                          {unit}
                        </text>
                      ) : null}
                    </g>
                  ) : null;
                })}
              </g>
            );
          })}
          {labs.map((l, i) => (
            <text key={i} x={x(i)} y={ch + 50 * u} textAnchor="middle" fill={colors.muted} fontFamily={fonts.body} fontWeight={600} fontSize={28 * u}>
              {l}
            </text>
          ))}
        </svg>
        {ser.length > 1 ? (
          <div style={{ display: 'flex', gap: 34 * u, marginTop: 30 * u }}>
            {ser.map((s, si) => (
              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 12 * u, fontFamily: fonts.body, fontSize: 30 * u, color: colors.text }}>
                <div style={{ width: 24 * u, height: 24 * u, borderRadius: 6 * u, background: s.color ?? cols[si % cols.length] }} />
                {s.name}
              </div>
            ))}
          </div>
        ) : null}
      </AbsoluteFill>
      <SourceNote text={source} />
    </AbsoluteFill>
  );
};

export const DonutChart: React.FC<P> = ({ title = '', data = [], centerLabel = '', source = '', background = 'mesh' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit, progress } = useScene();
  const rows = (data as { label: string; value: number; color?: string }[]).slice(0, 7);
  const total = rows.reduce((n, r) => n + r.value, 0) || 1;
  const R = (portrait ? 260 : 250) * u;
  const stroke = 90 * u;
  const C = 2 * Math.PI * R;
  const sweep = 1 - Math.pow(1 - progress(0.3, 1.5), 3);
  const cols = palette(colors);
  let acc = 0;
  const head = enter(0);
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ opacity: exit, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: `${H * 0.09}px ${W * 0.08}px` }}>
        <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 68 * u, color: colors.text, opacity: head, textAlign: 'center' }}>
          <RichText text={title} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: 80 * u }}>
          <div style={{ position: 'relative', width: R * 2 + stroke, height: R * 2 + stroke }}>
            <svg width={R * 2 + stroke} height={R * 2 + stroke} style={{ transform: 'rotate(-90deg)' }}>
              {rows.map((r, i) => {
                const frac = r.value / total;
                const seg = (
                  <circle
                    key={i}
                    cx={R + stroke / 2}
                    cy={R + stroke / 2}
                    r={R}
                    fill="none"
                    stroke={r.color ?? cols[i % cols.length]}
                    strokeWidth={stroke}
                    strokeDasharray={`${Math.max(0, frac * C * sweep - 4 * u)} ${C}`}
                    strokeDashoffset={-acc * C * sweep}
                  />
                );
                acc += frac;
                return seg;
              })}
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: fonts.heading, fontWeight: 800, fontSize: 40 * u, color: colors.text, padding: stroke }}>
              {centerLabel}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 * u }}>
            {rows.map((r, i) => {
              const p = enter(0.5 + i * 0.12);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20 * u, opacity: p, transform: `translateX(${(1 - p) * 30 * u}px)` }}>
                  <div style={{ width: 30 * u, height: 30 * u, borderRadius: 8 * u, background: r.color ?? cols[i % cols.length] }} />
                  <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 46 * u, color: colors.text, minWidth: 130 * u }}>{Math.round((r.value / total) * 100)}%</div>
                  <div style={{ fontFamily: fonts.body, fontSize: 36 * u, color: colors.muted }}>{r.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
      <SourceNote text={source} />
    </AbsoluteFill>
  );
};

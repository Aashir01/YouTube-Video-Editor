import React from 'react';
import { AbsoluteFill } from 'remotion';
import { useTheme } from '../context';
import { clamp01 } from '../effects';
import { Background, Card, Icon, RichText, SafeArea, alpha, onColor, useScene } from './kit';

type P = Record<string, any>;

export const Comparison: React.FC<P> = ({ leftTitle = 'A', rightTitle = 'B', leftItems = [], rightItems = [], mode = 'vs', verdict = '', background = 'mesh' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit, durationSec } = useScene();
  const leftColor = mode === 'pros-cons' ? '#34D399' : mode === 'before-after' ? colors.muted : colors.primary;
  const rightColor = mode === 'pros-cons' ? '#F87171' : mode === 'before-after' ? colors.accent : colors.secondary;
  const center = mode === 'vs' ? 'VS' : mode === 'before-after' ? '→' : '';
  const n = Math.max(leftItems.length, rightItems.length);
  const gap = Math.min(0.6, Math.max(0.2, (durationSec * 0.5) / Math.max(1, n * 2)));
  const col = (title: string, items: string[], color: string, side: 0 | 1) => {
    const p = enter(0.1 + side * 0.15, 16);
    return (
      <Card accent={color} style={{ flex: 1, padding: `${36 * u}px ${36 * u}px`, transform: portrait ? `translateY(${(1 - p) * (side ? 1 : -1) * 60 * u}px)` : `translateX(${(1 - p) * (side ? 1 : -1) * 80 * u}px)`, opacity: clamp01(p * 1.5), minHeight: portrait ? undefined : H * 0.55 }}>
        <div style={{ display: 'inline-block', fontFamily: fonts.heading, fontWeight: 900, fontSize: 56 * u, color: onColor(color), background: color, padding: `${8 * u}px ${24 * u}px`, borderRadius: 16 * u, marginBottom: 28 * u }}>{title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 * u }}>
          {items.map((it, i) => {
            const q = enter(0.6 + (i * 2 + side) * gap);
            const iconName = mode === 'pros-cons' ? (side ? 'cross' : 'check') : 'dot';
            return (
              <div key={i} style={{ display: 'flex', gap: 18 * u, alignItems: 'center', opacity: q, transform: `translateY(${(1 - q) * 20 * u}px)` }}>
                <Icon name={iconName} size={40 * u} color={color} />
                <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 38 * u, color: colors.text, lineHeight: 1.2 }}>
                  <RichText text={it} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  };
  const v = enter(0.3, 9);
  const verdictP = enter(Math.max(1, durationSec * 0.7));
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ opacity: exit, padding: portrait ? `${H * 0.08}px ${W * 0.06}px` : `${H * 0.1}px ${W * 0.07}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', gap: (center ? 170 : 40) * u, alignItems: 'stretch', position: 'relative' }}>
          {col(leftTitle, leftItems, leftColor, 0)}
          {center ? (
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${v})`, width: 130 * u, height: 130 * u, borderRadius: 999, background: colors.accent, color: onColor(colors.accent), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.heading, fontWeight: 900, fontSize: 52 * u, boxShadow: `0 0 0 ${10 * u}px ${alpha(colors.bg, 0.8)}`, zIndex: 2 }}>
              {center}
            </div>
          ) : null}
          {col(rightTitle, rightItems, rightColor, 1)}
        </div>
        {verdict ? (
          <div style={{ marginTop: 40 * u, alignSelf: 'center', fontFamily: fonts.heading, fontWeight: 800, fontSize: 48 * u, color: colors.text, background: alpha(colors.surface, 0.9), border: `${2 * u}px solid ${colors.accent}`, padding: `${18 * u}px ${36 * u}px`, borderRadius: 20 * u, opacity: verdictP, transform: `scale(${0.85 + 0.15 * verdictP})` }}>
            <RichText text={verdict} />
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Timeline: React.FC<P> = ({ title = '', events = [], background = 'grid' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit, durationSec, progress } = useScene();
  const list = (events as { date: string; label: string; description?: string }[]).slice(0, 7);
  const gap = Math.min(1, Math.max(0.3, (durationSec * 0.65) / Math.max(1, list.length)));
  const line = progress(0.3, gap * list.length);
  const head = enter(0);
  if (portrait) {
    return (
      <AbsoluteFill>
        <Background type={background} />
        <SafeArea style={{ opacity: exit, alignItems: 'stretch' }}>
          {title ? <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 72 * u, color: colors.text, textAlign: 'center', marginBottom: 46 * u, opacity: head }}>{title}</div> : null}
          <div style={{ position: 'relative', paddingLeft: 70 * u, display: 'flex', flexDirection: 'column', gap: 38 * u, textAlign: 'left' }}>
            <div style={{ position: 'absolute', left: 24 * u, top: 0, width: 6 * u, height: `${line * 100}%`, background: `linear-gradient(${colors.primary}, ${colors.secondary})`, borderRadius: 99 }} />
            {list.map((e, i) => {
              const p = enter(0.3 + i * gap, 14);
              return (
                <div key={i} style={{ position: 'relative', opacity: clamp01(p * 1.4), transform: `translateX(${(1 - p) * 40 * u}px)` }}>
                  <div style={{ position: 'absolute', left: -58 * u, top: 10 * u, width: 30 * u, height: 30 * u, borderRadius: 999, background: colors.accent, boxShadow: `0 0 0 ${8 * u}px ${alpha(colors.accent, 0.25)}` }} />
                  <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 44 * u, color: colors.accent }}>{e.date}</div>
                  <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: 46 * u, color: colors.text }}>{e.label}</div>
                  {e.description ? <div style={{ fontFamily: fonts.body, fontSize: 32 * u, color: colors.muted }}>{e.description}</div> : null}
                </div>
              );
            })}
          </div>
        </SafeArea>
      </AbsoluteFill>
    );
  }
  const x0 = W * 0.08;
  const span = W * 0.84;
  const step = span / Math.max(1, list.length - 1 || 1);
  const y = H * 0.55;
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ opacity: exit }}>
        {title ? <div style={{ position: 'absolute', top: H * 0.13, width: '100%', textAlign: 'center', fontFamily: fonts.heading, fontWeight: 900, fontSize: 78 * u, color: colors.text, opacity: head }}>{title}</div> : null}
        <div style={{ position: 'absolute', left: x0, top: y - 3 * u, width: span * line, height: 6 * u, background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`, borderRadius: 99 }} />
        {list.map((e, i) => {
          const p = enter(0.3 + i * gap, 13);
          const cx = list.length === 1 ? W / 2 : x0 + i * step;
          const above = i % 2 === 0;
          return (
            <div key={i}>
              <div style={{ position: 'absolute', left: cx - 18 * u, top: y - 18 * u, width: 36 * u, height: 36 * u, borderRadius: 999, background: colors.accent, transform: `scale(${p})`, boxShadow: `0 0 0 ${10 * u}px ${alpha(colors.accent, 0.25)}` }} />
              <div style={{ position: 'absolute', left: cx - step / 2, width: step, top: above ? undefined : y + 50 * u, bottom: above ? H - y + 50 * u : undefined, textAlign: 'center', opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * (above ? -30 : 30) * u}px)` }}>
                <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 48 * u, color: colors.accent }}>{e.date}</div>
                <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: (list.length > 5 ? 32 : 38) * u, color: colors.text, lineHeight: 1.15, padding: `0 ${10 * u}px` }}>{e.label}</div>
                {e.description ? <div style={{ fontFamily: fonts.body, fontSize: 26 * u, color: colors.muted, marginTop: 6 * u, padding: `0 ${10 * u}px` }}>{e.description}</div> : null}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Definition: React.FC<P> = ({ term = '', phonetic = '', partOfSpeech = 'noun', definition = '', example = '', background = 'dots' }) => {
  const { colors, fonts, u, W } = useTheme();
  const { enter, exit } = useScene();
  const a = enter(0);
  const b = enter(0.35);
  const c = enter(0.9);
  return (
    <AbsoluteFill>
      <Background type={background} />
      <SafeArea align="left" style={{ opacity: exit }}>
        <div style={{ maxWidth: W * 0.8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 26 * u, flexWrap: 'wrap', opacity: a, transform: `translateY(${(1 - a) * 30 * u}px)` }}>
            <span style={{ fontFamily: '"Playfair Display Variable", "DM Serif Display", serif', fontWeight: 800, fontSize: 140 * u, color: colors.text, lineHeight: 1 }}>{term}</span>
            {phonetic ? <span style={{ fontFamily: fonts.body, fontSize: 40 * u, color: colors.muted }}>{phonetic}</span> : null}
          </div>
          <div style={{ fontFamily: fonts.body, fontStyle: 'italic', fontSize: 38 * u, color: colors.accent, margin: `${16 * u}px 0 ${26 * u}px`, opacity: b }}>{partOfSpeech}</div>
          <div style={{ height: 4 * u, width: `${b * 100}%`, maxWidth: 700 * u, background: alpha(colors.text, 0.2), marginBottom: 30 * u }} />
          <div style={{ fontFamily: fonts.body, fontWeight: 500, fontSize: 52 * u, color: colors.text, lineHeight: 1.35, opacity: b, transform: `translateY(${(1 - b) * 20 * u}px)` }}>
            <RichText text={definition} />
          </div>
          {example ? <div style={{ fontFamily: fonts.body, fontStyle: 'italic', fontSize: 38 * u, color: colors.muted, marginTop: 30 * u, opacity: c }}>“{example}”</div> : null}
        </div>
      </SafeArea>
    </AbsoluteFill>
  );
};

// --- tiny syntax highlighter ------------------------------------------------

const KEYWORDS = new Set(
  'const let var function return await async if else for while do switch case break continue import from export default class extends new this typeof instanceof in of try catch finally throw def print lambda yield with as pass elif None True False self and or not is fn pub mut impl struct enum match use mod interface type public private static void int string bool float double null undefined true false package func go defer select chan map range SELECT FROM WHERE JOIN ON GROUP BY ORDER INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE'.split(' '),
);

type Tok = { text: string; kind: 'kw' | 'str' | 'num' | 'com' | 'fn' | 'punc' | 'plain' };

const tokenizeLine = (line: string): Tok[] => {
  const out: Tok[] = [];
  const re = /(\/\/.*$|#.*$|--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ text: m[1], kind: 'com' });
    else if (m[2]) out.push({ text: m[2], kind: 'str' });
    else if (m[3]) out.push({ text: m[3], kind: 'num' });
    else if (m[4]) {
      const next = line.slice(re.lastIndex).trimStart()[0];
      out.push({ text: m[4], kind: KEYWORDS.has(m[4]) ? 'kw' : next === '(' ? 'fn' : 'plain' });
    } else if (m[5]) out.push({ text: m[5], kind: 'plain' });
    else out.push({ text: m[6]!, kind: 'punc' });
  }
  return out;
};

const TOKEN_COLORS: Record<Tok['kind'], string> = {
  kw: '#C678DD',
  str: '#98C379',
  num: '#D19A66',
  com: '#7F848E',
  fn: '#61AFEF',
  punc: '#ABB2BF',
  plain: '#E6E6E6',
};

export const CodeBlock: React.FC<P> = ({ title = '', code = '', language = 'typescript', highlightLines = [], typing = true, background = 'dots' }) => {
  const { colors, fonts, u, portrait, W, H } = useTheme();
  const { enter, exit, progress, frame } = useScene();
  const lines = String(code).replace(/\t/g, '  ').split('\n');
  const totalChars = lines.reduce((n, l) => n + l.length + 1, 0);
  const typed = typing ? Math.floor(progress(0.5, Math.min(5, Math.max(1, totalChars * 0.025))) * totalChars) : totalChars;
  const win = enter(0, 16);
  const longest = Math.max(20, ...lines.map((l) => l.length));
  const fs = Math.min(portrait ? 44 : 46, ((portrait ? W * 0.84 : W * 0.72) / (longest * 0.62)) / u) * u;
  let remaining = typed;
  const hl = new Set(highlightLines as number[]);
  return (
    <AbsoluteFill>
      <Background type={background} />
      <AbsoluteFill style={{ opacity: exit, justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ width: portrait ? W * 0.9 : W * 0.78, maxHeight: H * 0.84, background: '#1E2230', borderRadius: 24 * u, boxShadow: `0 ${40 * u}px ${100 * u}px rgba(0,0,0,0.55)`, border: `${1.5 * u}px solid ${alpha('#FFFFFF', 0.08)}`, overflow: 'hidden', transform: `translateY(${(1 - win) * 80 * u}px) scale(${0.94 + 0.06 * win})`, opacity: clamp01(win * 1.5) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 * u, padding: `${18 * u}px ${24 * u}px`, background: '#161925' }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
              <div key={c} style={{ width: 20 * u, height: 20 * u, borderRadius: 99, background: c }} />
            ))}
            <div style={{ marginLeft: 20 * u, fontFamily: fonts.mono, fontSize: 26 * u, color: '#8B93A7' }}>{title || `main.${language === 'python' ? 'py' : language === 'javascript' ? 'js' : language === 'typescript' ? 'ts' : language}`}</div>
          </div>
          <div style={{ padding: `${28 * u}px ${10 * u}px ${34 * u}px` }}>
            {lines.map((line, i) => {
              const visibleChars = Math.max(0, Math.min(line.length, remaining));
              const isCursorLine = remaining >= 0 && remaining <= line.length && typed < totalChars;
              remaining -= line.length + 1;
              const toks = tokenizeLine(line);
              let shown = visibleChars;
              const isHl = hl.has(i + 1) && typed >= totalChars;
              return (
                <div key={i} style={{ display: 'flex', fontFamily: fonts.mono, fontSize: fs, lineHeight: 1.55, background: isHl ? alpha(colors.accent, 0.14) : undefined, borderLeft: `${5 * u}px solid ${isHl ? colors.accent : 'transparent'}`, whiteSpace: 'pre' }}>
                  <span style={{ width: 70 * u, textAlign: 'right', paddingRight: 24 * u, color: '#4B5263', flex: 'none' }}>{i + 1}</span>
                  <span>
                    {toks.map((t, k) => {
                      if (shown <= 0) return null;
                      const txt = t.text.slice(0, shown);
                      shown -= t.text.length;
                      return (
                        <span key={k} style={{ color: TOKEN_COLORS[t.kind], fontStyle: t.kind === 'com' ? 'italic' : undefined }}>
                          {txt}
                        </span>
                      );
                    })}
                    {isCursorLine && Math.floor(frame / 10) % 2 === 0 ? <span style={{ background: colors.accent, color: colors.accent }}>▍</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

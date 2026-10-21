---
name: code-scenes
description: Exact API and examples for writing custom animated scenes in TSX (React + Remotion) with write_code_scene.
---
# Writing custom code scenes

A code scene is a React component written in TSX. It is compiled in the browser preview and in the renderer, so it must be **self-contained and deterministic**.

## Rules
- `export default function Scene(props) { ... }` — props come from the clip's `props` field.
- Animate ONLY with the current frame: `useCurrentFrame()`, `interpolate()`, `spring()`. No CSS transitions/animations, no `setTimeout`, no `Math.random()` (use `random('seed')`), no `Date.now()`.
- No network requests or external images except project assets via `useAssetUrl(assetId)`.
- Size everything with the design unit `u` from `useTheme()` (1u = 1px at 1080p short side) so it works in 16:9, 9:16 and 4K. Canvas size is `W` × `H`.
- Fill the frame: wrap in `<AbsoluteFill>`. For overlays (`transparent: true`) do not paint a background.
- Keep everything inside safe margins (8% horizontally, 10% vertically; 9:16: avoid top 12% and bottom 25%).

## Available imports
```tsx
import React from 'react';
import { AbsoluteFill, Sequence, Series, Img, interpolate, interpolateColors, spring, Easing, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { Circle, Rect, Triangle, Star, Pie, Polygon, Ellipse } from '@remotion/shapes';
import { evolvePath, getLength, getPointAtLength, interpolatePath } from '@remotion/paths';
import { noise2D, noise3D } from '@remotion/noise';
import { fitText, measureText } from '@remotion/layout-utils';
import {
  useTheme,      // { W, H, u, portrait, fps, colors: {primary, secondary, accent, bg, surface, text, muted}, fonts: {heading, body, mono} }
  useScene,      // { frame, fps, duration, durationSec, t, exit (1→0 in the last 0.4s), enter(delaySec, damping?), progress(startSec, lengthSec) }
  useAssetUrl,   // (assetId) => url
  Background,    // <Background type="mesh|gradient|grid|dots|spotlight|noise|solid|image|transparent" imageAssetId? />
  WordsReveal,   // <WordsReveal text="..." emphasis={['word']} stagger={0.06} mode="rise|pop|blur|drop" style={{...}} />
  RichText,      // <RichText text="Make *this* pop" />
  CountUp,       // <CountUp value={42} decimals={0} prefix="$" suffix="%" delay={0.2} duration={1.5} />
  Icon,          // <Icon name="check|cross|arrow|star|dot|bell|like|quote|play|sparkle" size={40*u} color="#fff" />
  Card, Pill, SafeArea,
  alpha,         // alpha('#ff0000', 0.5) -> rgba
  onColor,       // readable text color on a background
  mix, ease, lerp, clamp01, interpolateClamp,
} from 'director';
```

## Example 1 — animated process diagram
```tsx
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { evolvePath } from '@remotion/paths';
import { useTheme, useScene, Background, Icon, alpha } from 'director';

export default function Scene({ steps = ['Idea', 'Build', 'Launch'] }: { steps?: string[] }) {
  const { W, H, u, colors, fonts } = useTheme();
  const { enter, progress, exit } = useScene();
  const y = H / 2;
  const x0 = W * 0.15, x1 = W * 0.85;
  const path = `M ${x0} ${y} L ${x1} ${y}`;
  const line = evolvePath(progress(0.3, 1.6), path);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Background type="grid" />
      <svg width={W} height={H} style={{ position: 'absolute' }}>
        <path d={path} stroke={colors.primary} strokeWidth={8 * u} fill="none" strokeLinecap="round" strokeDasharray={line.strokeDasharray} strokeDashoffset={line.strokeDashoffset} />
      </svg>
      {steps.map((s, i) => {
        const p = enter(0.3 + i * 0.5, 12);
        const x = x0 + ((x1 - x0) * i) / Math.max(1, steps.length - 1);
        return (
          <div key={i} style={{ position: 'absolute', left: x - 90 * u, top: y - 90 * u, width: 180 * u, height: 180 * u, borderRadius: 999, background: colors.surface, border: `${6 * u}px solid ${colors.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${p})`, boxShadow: `0 0 ${40 * u}px ${alpha(colors.accent, 0.4)}` }}>
            <div style={{ fontFamily: fonts.heading, fontWeight: 800, fontSize: 36 * u, color: colors.text }}>{s}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
```

## Example 2 — transparent overlay (counter badge over footage)
```tsx
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { useTheme, useScene, CountUp } from 'director';

export default function Scene({ value = 1000000, label = 'views' }) {
  const { u, colors, fonts, W, H } = useTheme();
  const { enter, exit } = useScene();
  const p = enter(0, 12);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div style={{ position: 'absolute', right: W * 0.06, top: H * 0.08, background: colors.primary, borderRadius: 24 * u, padding: `${20 * u}px ${32 * u}px`, transform: `scale(${p})`, transformOrigin: 'top right' }}>
        <div style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: 72 * u, color: '#fff' }}><CountUp value={value} /></div>
        <div style={{ fontFamily: fonts.body, fontSize: 30 * u, color: '#fff', opacity: 0.85 }}>{label}</div>
      </div>
    </AbsoluteFill>
  );
}
```

## Workflow
1. Describe the idea in one sentence; sketch the layout in safe areas.
2. Write the scene with `write_code_scene` (start/duration on the timeline, `props` for text/data).
3. Look at the returned preview frame. Fix overflow, contrast and timing issues; re-submit with `clipId` to update.
4. Keep scenes under ~200 lines; prefer composition of simple shapes + kit components.

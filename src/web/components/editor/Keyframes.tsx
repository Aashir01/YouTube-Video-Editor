import React from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react';
import { KEYFRAME_EASES, type Clip, type Keyframe, type KeyframeEase } from '../../../shared/schema';
import {
  ANIMATABLE,
  CHANNELS,
  DEFAULT_EASE,
  KF_EPS,
  animatedChannels,
  channelAt,
  channelKeys,
  channelPatch,
  isAnimated,
  isChannelOf,
  staticValue,
  type Channel,
} from '../../../shared/keyframes';
import { formatTime } from '../../../shared/timeline';
import { useStudio } from '../../lib/store';
import { player } from '../../lib/player';
import { cn, clamp } from '../../lib/utils';
import { Section } from '../ui';

type Patch = (p: Record<string, unknown>) => void;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const OUTSIDE = 'Move the playhead over the clip to set keyframes';
export const EASE_LABELS: Record<KeyframeEase, string> = { linear: 'Linear', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in & out', hold: 'Hold' };

/** The playhead in clip time, or null when it is outside the clip. */
export const clipTimeNow = (clip: Clip): number | null => {
  const t = r3(useStudio.getState().time - clip.start);
  return t < -0.001 || t > clip.duration + 0.001 ? null : clamp(t, 0, clip.duration);
};

export const DiamondIcon: React.FC<{ filled?: boolean; dot?: boolean; className?: string }> = ({ filled, dot, className }) => (
  <svg viewBox="0 0 10 10" className={cn('size-2.5', className)} aria-hidden>
    <path d="M5 .9 9.1 5 5 9.1.9 5Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
    {dot && !filled && <circle cx="5" cy="5" r="1.2" fill="currentColor" />}
  </svg>
);

// ---------------------------------------------------------------------------
// The ◆ button next to an animatable setting
// ---------------------------------------------------------------------------

export const KfButton: React.FC<{ clip: Clip; ch: Channel }> = ({ clip, ch }) => {
  const list = channelKeys(clip, ch);
  const state = useStudio((s) => {
    const t = s.time - clip.start;
    if (t < -0.001 || t > clip.duration + 0.001) return 'outside' as const;
    if (!list.length) return 'off' as const;
    return list.some((k) => Math.abs(k.t - t) <= KF_EPS) ? ('on' as const) : ('between' as const);
  });
  const animated = list.length > 0;
  const label = CHANNELS[ch].label;
  const title =
    state === 'outside' ? OUTSIDE : state === 'on' ? `Remove the ${label} keyframe here` : animated ? `Add a ${label} keyframe at the playhead` : `Animate ${label}: add a keyframe at the playhead`;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={state === 'on'}
      data-kf-button={ch}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const t = clipTimeNow(clip);
        if (t === null) return void toast(OUTSIDE);
        const { edit } = useStudio.getState();
        if (state === 'on') void edit([{ op: 'removeKeyframe', clipId: clip.id, t, channels: [ch] }], 'Delete keyframe');
        else void edit([{ op: 'setKeyframe', clipId: clip.id, t, values: { [ch]: channelAt(clip, ch, t) } }], animated ? 'Add keyframe' : `Animate ${label}`);
      }}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-white/10',
        animated ? 'text-hue-yellow' : 'text-dim hover:text-muted',
        state === 'outside' && 'opacity-40',
      )}
    >
      <DiamondIcon filled={state === 'on'} dot={state === 'between'} />
    </button>
  );
};

// ---------------------------------------------------------------------------
// Fields that understand animation
// ---------------------------------------------------------------------------

const mergePatches = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = cur && typeof cur === 'object' && v && typeof v === 'object' ? { ...(cur as object), ...(v as object) } : v;
  }
  return out;
};

export interface AnimFields {
  value: (ch: Channel) => number;
  animated: (ch: Channel) => boolean;
  /** Set values: animated channels get a keyframe at the playhead, the others change their static value. */
  set: (values: Partial<Record<Channel, number>>, label?: string) => void;
  /** Props for a NumberField/RangeField bound to a channel, with its ◆ button. */
  field: (ch: Channel) => { value: number; onChange: (v: number) => void; adornment: React.ReactNode };
}

export const useAnim = (clip: Clip, patch: Patch): AnimFields => {
  // only an animated clip needs to follow the playhead: its values change over time
  const time = useStudio((s) => (clip.keyframes ? s.time : 0));
  const t = clamp(time - clip.start, 0, clip.duration);
  const value = (ch: Channel) => (isAnimated(clip, ch) ? channelAt(clip, ch, t) : staticValue(clip, ch));
  const set: AnimFields['set'] = (values, label = 'Keyframe') => {
    const keyed: Record<string, number> = {};
    let fixed: Record<string, unknown> = {};
    for (const [ch, v] of Object.entries(values) as [Channel, number][]) {
      if (isAnimated(clip, ch)) keyed[ch] = v;
      else fixed = mergePatches(fixed, channelPatch(clip, ch, v));
    }
    if (Object.keys(fixed).length) patch(fixed);
    if (!Object.keys(keyed).length) return;
    const at = clipTimeNow(clip);
    if (at === null) return void toast(OUTSIDE);
    useStudio.getState().editSoon(`kf:${clip.id}:${Object.keys(keyed).sort().join(',')}`, { op: 'setKeyframe', clipId: clip.id, t: at, values: keyed }, label);
  };
  return {
    value,
    animated: (ch) => isAnimated(clip, ch),
    set,
    field: (ch) => ({ value: value(ch), onChange: (v) => set({ [ch]: v }, `Keyframe ${CHANNELS[ch].label}`), adornment: <KfButton clip={clip} ch={ch} /> }),
  };
};

// ---------------------------------------------------------------------------
// Presets: one click to a common animation
// ---------------------------------------------------------------------------

interface Preset {
  id: string;
  label: string;
  hint: string;
  applies: (c: Clip) => boolean;
  build: (c: Clip) => Record<string, Keyframe[]>;
}

const win = (c: Clip, max = 0.5) => r3(Math.min(max, c.duration / 3));
const keysOf = (c: Clip, ch: Channel): Keyframe[] => [...channelKeys(c, ch)];
/** Replace the keyframes inside [from, to] with `add`, keeping the rest of the channel's animation. */
const mergeWindow = (list: Keyframe[], from: number, to: number, add: Keyframe[]) => [...list.filter((k) => k.t < from - KF_EPS || k.t > to + KF_EPS), ...add].sort((a, b) => a.t - b.t);
const isPip = (c: Clip) => (c.type === 'video' || c.type === 'image') && Boolean(c.box);
const visibleOpacity = (c: Clip, t: number) => channelAt(c, 'opacity', t) || 1;

const PRESETS: Preset[] = [
  {
    id: 'fade-in',
    label: 'Fade in',
    hint: 'Opacity from 0 at the start',
    applies: (c) => isChannelOf(c.type, 'opacity'),
    build: (c) => {
      const d = win(c);
      return { opacity: mergeWindow(keysOf(c, 'opacity'), 0, d, [{ t: 0, v: 0, ease: 'ease-out' }, { t: d, v: visibleOpacity(c, d) }]) };
    },
  },
  {
    id: 'fade-out',
    label: 'Fade out',
    hint: 'Opacity to 0 at the end',
    applies: (c) => isChannelOf(c.type, 'opacity'),
    build: (c) => {
      const d = win(c);
      const s = r3(c.duration - d);
      return { opacity: mergeWindow(keysOf(c, 'opacity'), s, c.duration, [{ t: s, v: visibleOpacity(c, s), ease: 'ease-in' }, { t: c.duration, v: 0 }]) };
    },
  },
  {
    id: 'zoom-in',
    label: 'Slow zoom in',
    hint: 'Push in 15% across the clip',
    applies: (c) => c.type === 'video' || c.type === 'image',
    build: (c) => {
      const s = staticValue(c, 'scale');
      return { scale: [{ t: 0, v: s, ease: 'linear' }, { t: c.duration, v: r3(s * 1.15) }] };
    },
  },
  {
    id: 'zoom-out',
    label: 'Slow zoom out',
    hint: 'Pull out 15% across the clip',
    applies: (c) => c.type === 'video' || c.type === 'image',
    build: (c) => {
      const s = staticValue(c, 'scale');
      return { scale: [{ t: 0, v: r3(s * 1.15), ease: 'linear' }, { t: c.duration, v: s }] };
    },
  },
  {
    id: 'slide-in',
    label: 'Slide in',
    hint: 'Enter from the nearest side',
    applies: (c) => isPip(c) || c.type === 'text',
    build: (c): Record<string, Keyframe[]> => {
      const d = win(c, 0.6);
      if (c.type === 'text') {
        const x = channelAt(c, 'x', d);
        return {
          x: mergeWindow(keysOf(c, 'x'), 0, d, [{ t: 0, v: clamp(x - 0.12, 0, 1), ease: 'ease-out' }, { t: d, v: x }]),
          opacity: mergeWindow(keysOf(c, 'opacity'), 0, d, [{ t: 0, v: 0, ease: 'ease-out' }, { t: d, v: visibleOpacity(c, d) }]),
        };
      }
      const x = channelAt(c, 'box.x', d);
      const w = channelAt(c, 'box.w', d);
      const from = x + w / 2 > 0.5 ? 1.02 : -w - 0.02;
      return { 'box.x': mergeWindow(keysOf(c, 'box.x'), 0, d, [{ t: 0, v: r3(from), ease: 'ease-out' }, { t: d, v: x }]) };
    },
  },
  {
    id: 'slide-out',
    label: 'Slide out',
    hint: 'Leave through the nearest side',
    applies: (c) => isPip(c) || c.type === 'text',
    build: (c): Record<string, Keyframe[]> => {
      const d = win(c, 0.6);
      const s = r3(c.duration - d);
      if (c.type === 'text') {
        const x = channelAt(c, 'x', s);
        return {
          x: mergeWindow(keysOf(c, 'x'), s, c.duration, [{ t: s, v: x, ease: 'ease-in' }, { t: c.duration, v: clamp(x + 0.12, 0, 1) }]),
          opacity: mergeWindow(keysOf(c, 'opacity'), s, c.duration, [{ t: s, v: visibleOpacity(c, s), ease: 'ease-in' }, { t: c.duration, v: 0 }]),
        };
      }
      const x = channelAt(c, 'box.x', s);
      const w = channelAt(c, 'box.w', s);
      const to = x + w / 2 > 0.5 ? 1.02 : -w - 0.02;
      return { 'box.x': mergeWindow(keysOf(c, 'box.x'), s, c.duration, [{ t: s, v: x, ease: 'ease-in' }, { t: c.duration, v: r3(to) }]) };
    },
  },
];

// ---------------------------------------------------------------------------
// Inspector section: presets + every keyframe, editable
// ---------------------------------------------------------------------------

export const AnimationSection: React.FC<{ clip: Clip }> = ({ clip }) => {
  const chs = animatedChannels(clip);
  const now = useStudio((s) => (clip.keyframes ? r3(s.time - clip.start) : -1));
  if (!ANIMATABLE[clip.type].length) return null;
  const { edit } = useStudio.getState();
  const presets = PRESETS.filter((p) => p.applies(clip));
  const jump = (ch: Channel, dir: -1 | 1) => {
    const t = r3(useStudio.getState().time - clip.start);
    const list = channelKeys(clip, ch);
    const k = dir < 0 ? [...list].reverse().find((x) => x.t < t - KF_EPS) : list.find((x) => x.t > t + KF_EPS);
    if (k) player.seek(clip.start + Math.max(0, k.t));
  };
  return (
    // remounts (and opens) as soon as the clip becomes animated
    <Section key={chs.length ? 'animated' : 'still'} title={chs.length ? `Animation · ${chs.length}` : 'Animation'} defaultOpen={chs.length > 0}>
      {chs.length === 0 && <p className="-mt-1 text-[11px] leading-snug text-dim">Click ◆ next to a setting to animate it from the playhead, or start from a preset.</p>}
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.id}
              title={p.hint}
              className="rounded-md border border-line px-2 py-0.5 text-[11px] font-semibold text-muted hover:border-line-2 hover:text-text"
              onClick={() => void edit([{ op: 'updateClip', clipId: clip.id, patch: { keyframes: p.build(clip) } }], `Animation: ${p.label}`)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {chs.map((ch) => {
        const list = channelKeys(clip, ch);
        return (
          <div key={ch} className="rounded-lg border border-line bg-black/20 p-1.5" data-kf-channel={ch}>
            <div className="mb-1 flex items-center gap-1.5 px-0.5">
              <DiamondIcon filled className="text-hue-yellow" />
              <span className="text-xs font-semibold">{CHANNELS[ch].label}</span>
              <span className="text-[10px] text-dim">{list.length} key{list.length === 1 ? '' : 's'}</span>
              <span className="ml-auto flex items-center">
                <button className="rounded p-0.5 text-dim hover:bg-white/10 hover:text-text" title="Previous keyframe" onClick={() => jump(ch, -1)}>
                  <ChevronLeft className="size-3.5" />
                </button>
                <button className="rounded p-0.5 text-dim hover:bg-white/10 hover:text-text" title="Next keyframe" onClick={() => jump(ch, 1)}>
                  <ChevronRight className="size-3.5" />
                </button>
                <button
                  className="rounded p-0.5 text-dim hover:bg-white/10 hover:text-danger"
                  title="Remove this animation (keeps the value at the playhead)"
                  onClick={() => void edit([{ op: 'clearKeyframes', clipId: clip.id, channels: [ch], keepAt: clipTimeNow(clip) ?? 0 }], 'Remove animation')}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            </div>
            <div className="flex max-h-40 flex-col gap-px overflow-y-auto">
              {list.map((k, i) => {
                const here = Math.abs(k.t - now) <= KF_EPS;
                return (
                  <div key={`${k.t}-${i}`} className={cn('grid grid-cols-[auto_1fr_auto_auto] items-center gap-1.5 rounded px-1 py-0.5 text-[11px]', here && 'bg-hue-yellow/10')}>
                    <button className={cn('font-mono tabular-nums hover:text-text', here ? 'text-hue-yellow' : 'text-muted')} title="Go to this keyframe" onClick={() => player.seek(clip.start + Math.max(0, k.t))}>
                      {formatTime(clip.start + k.t)}
                    </button>
                    <span className="tabular-nums text-text">{CHANNELS[ch].format(k.v)}</span>
                    {i < list.length - 1 ? (
                      <select
                        value={k.ease ?? DEFAULT_EASE}
                        title="How the value moves to the next keyframe"
                        className="cursor-pointer rounded border border-line bg-black/30 px-1 py-px text-[10px] text-muted outline-none hover:text-text"
                        onChange={(e) => void edit([{ op: 'setKeyframeEase', clipId: clip.id, t: k.t, ease: e.target.value as KeyframeEase, channels: [ch] }], 'Keyframe easing')}
                      >
                        {KEYFRAME_EASES.map((e) => (
                          <option key={e} value={e}>
                            {EASE_LABELS[e]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span />
                    )}
                    <button className="rounded p-0.5 text-dim hover:text-danger" title="Delete keyframe" onClick={() => void edit([{ op: 'removeKeyframe', clipId: clip.id, t: k.t, channels: [ch] }], 'Delete keyframe')}>
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </Section>
  );
};

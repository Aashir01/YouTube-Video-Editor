import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, MessageSquareText, MousePointerClick, Plus, Scissors, Trash2, TriangleAlert, WandSparkles, X } from 'lucide-react';
import {
  CAPTION_PRESETS,
  EASINGS,
  GRADE_PRESETS,
  TEXT_ANIMATIONS,
  TRANSITION_TYPES,
  type AudioClip,
  type CaptionsClip,
  type Clip,
  type CodeClip,
  type ImageClip,
  type SceneClip,
  type TextClip,
  type VideoClip,
} from '../../../shared/schema';
import { templateCatalog } from '../../../shared/templates';
import { FONTS } from '../../../shared/fonts';
import { clipEnd } from '../../../shared/timeline';
import { api, type TemplateInfo } from '../../lib/api';
import { clipLabel, getClipRef, useStudio } from '../../lib/store';
import { duplicateSelection, splitAtPlayhead } from '../../lib/actions';
import { cn, errorText } from '../../lib/utils';
import { ClipIcon, clipColor } from '../icons';
import { Badge, ColorField, Empty, Field, NumberField, RangeField, Section, Segmented, SelectField, Switch, TextArea } from '../ui';
import { SchemaForm } from './SchemaForm';

const FONT_OPTIONS = FONTS.map((f) => ({ value: f.id, label: f.family.replace(' Variable', '') }));
const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x.replace(/-/g, ' ') }));

type Patch = (p: Record<string, unknown>) => void;

// ---------------------------------------------------------------------------
// Shared sections
// ---------------------------------------------------------------------------

const Timing: React.FC<{ clip: Clip; patch: Patch }> = ({ clip, patch }) => {
  const edit = useStudio((s) => s.edit);
  return (
    <Section title="Timing">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Start" value={clip.start} min={0} step={0.1} unit="s" onChange={(v) => void edit([{ op: 'moveClip', clipId: clip.id, start: v }], 'Move clip')} />
        <NumberField label="Length" value={clip.duration} min={0.1} step={0.1} unit="s" onChange={(v) => void edit([{ op: 'trimClip', clipId: clip.id, end: clip.start + v }], 'Change length')} />
      </div>
      {(clip.type === 'video' || clip.type === 'audio') && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="In" value={clip.trimStart} min={0} step={0.1} unit="s" onChange={(v) => patch({ trimStart: v })} />
          <NumberField label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} unit="×" onChange={(v) => patch({ speed: v })} />
        </div>
      )}
    </Section>
  );
};

const Transitions: React.FC<{ clip: Clip; patch: Patch }> = ({ clip, patch }) => {
  const row = (key: 'transitionIn' | 'transitionOut', label: string) => {
    const t = clip[key];
    return (
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <Field label={label}>
          <SelectField value={t?.type ?? ''} placeholder="None" options={opts(TRANSITION_TYPES)} onChange={(v) => patch({ [key]: v ? { type: v, duration: t?.duration ?? 0.4 } : null })} />
        </Field>
        <Field label="Secs">
          <NumberField value={t?.duration} min={0.05} max={5} step={0.05} onChange={(v) => t && patch({ [key]: { ...t, duration: v } })} />
        </Field>
      </div>
    );
  };
  return (
    <Section title="Transitions" defaultOpen={Boolean(clip.transitionIn || clip.transitionOut)}>
      {row('transitionIn', 'In')}
      {row('transitionOut', 'Out')}
    </Section>
  );
};

const Placement: React.FC<{ clip: VideoClip | ImageClip; patch: Patch }> = ({ clip, patch }) => {
  const boxes: Record<string, { x: number; y: number; w: number; h: number } | null> = {
    full: null,
    'top-left': { x: 0.04, y: 0.05, w: 0.32, h: 0.32 },
    'top-right': { x: 0.64, y: 0.05, w: 0.32, h: 0.32 },
    'bottom-left': { x: 0.04, y: 0.63, w: 0.32, h: 0.32 },
    'bottom-right': { x: 0.64, y: 0.63, w: 0.32, h: 0.32 },
    center: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
  };
  const current = clip.box ? (Object.entries(boxes).find(([, b]) => b && Math.abs(b.x - clip.box!.x) < 0.005 && Math.abs(b.y - clip.box!.y) < 0.005)?.[0] ?? 'custom') : 'full';
  return (
    <Section title="Frame">
      <Field label="Layout">
        <SelectField
          value={current}
          onChange={(v) => v !== 'custom' && patch({ box: boxes[v] ?? null, radius: v === 'full' ? 0 : 24, shadow: v !== 'full' })}
          options={[...Object.keys(boxes).map((k) => ({ value: k, label: k === 'full' ? 'Full frame' : `Picture-in-picture: ${k.replace('-', ' ')}` })), ...(current === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]}
        />
      </Field>
      {clip.box && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={clip.box.x} min={-1} max={2} step={0.01} onChange={(v) => patch({ box: { ...clip.box!, x: v } })} />
          <NumberField label="Y" value={clip.box.y} min={-1} max={2} step={0.01} onChange={(v) => patch({ box: { ...clip.box!, y: v } })} />
          <NumberField label="W" value={clip.box.w} min={0.01} max={3} step={0.01} onChange={(v) => patch({ box: { ...clip.box!, w: v } })} />
          <NumberField label="H" value={clip.box.h} min={0.01} max={3} step={0.01} onChange={(v) => patch({ box: { ...clip.box!, h: v } })} />
        </div>
      )}
      <Field label="Fit">
        <Segmented value={clip.fit} onChange={(v) => patch({ fit: v })} options={opts(['cover', 'contain', 'fill']).map((o) => ({ value: o.value as 'cover', label: o.label }))} size="sm" />
      </Field>
      <RangeField label="Opacity" value={clip.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ opacity: v })} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Radius" value={clip.radius} min={0} max={500} step={2} precision={0} onChange={(v) => patch({ radius: v })} />
        <NumberField label="Rotate" value={clip.rotation} min={-360} max={360} step={1} precision={0} unit="°" onChange={(v) => patch({ rotation: v })} />
      </div>
      <div className="flex gap-4">
        <Switch label="Shadow" checked={clip.shadow} onChange={(v) => patch({ shadow: v })} />
        <Switch label="Mirror" checked={clip.flipX} onChange={(v) => patch({ flipX: v })} />
      </div>
    </Section>
  );
};

const Grade: React.FC<{ clip: VideoClip | ImageClip; patch: Patch }> = ({ clip, patch }) => {
  const g = clip.grade ?? { preset: 'none', brightness: 1, contrast: 1, saturation: 1, hue: 0, vignette: 0, blur: 0 };
  const set = (p: Record<string, unknown>) => patch({ grade: { ...g, ...p } });
  return (
    <Section title="Color" defaultOpen={Boolean(clip.grade && clip.grade.preset !== 'none')}>
      <Field label="Look">
        <SelectField value={g.preset} options={opts(GRADE_PRESETS)} onChange={(v) => set({ preset: v })} />
      </Field>
      <RangeField label="Brightness" value={g.brightness} min={0.3} max={2} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => set({ brightness: v })} />
      <RangeField label="Contrast" value={g.contrast} min={0.3} max={2} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => set({ contrast: v })} />
      <RangeField label="Saturation" value={g.saturation} min={0} max={2.5} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => set({ saturation: v })} />
      <RangeField label="Vignette" value={g.vignette} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ vignette: v })} />
      <RangeField label="Blur" value={g.blur} min={0} max={40} step={0.5} format={(v) => `${v}px`} onChange={(v) => set({ blur: v })} />
      {clip.grade && (
        <button className="btn btn-sm btn-ghost self-start text-muted" onClick={() => patch({ grade: null })}>
          Reset color
        </button>
      )}
    </Section>
  );
};

const Motion: React.FC<{ clip: VideoClip | ImageClip; patch: Patch }> = ({ clip, patch }) => {
  const time = useStudio((s) => s.time);
  const kb = clip.kenBurns;
  return (
    <Section title="Motion" defaultOpen={Boolean(kb) || (clip.type === 'video' && clip.zooms.length > 0)}>
      <Switch
        label="Ken Burns (slow pan & zoom)"
        checked={Boolean(kb)}
        onChange={(v) => patch({ kenBurns: v ? { fromScale: 1, toScale: 1.15, fromX: 0.5, fromY: 0.5, toX: 0.5, toY: 0.5, easing: 'ease-in-out' } : null })}
      />
      {kb && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="From" value={kb.fromScale} min={0.5} max={4} step={0.01} unit="×" onChange={(v) => patch({ kenBurns: { ...kb, fromScale: v } })} />
          <NumberField label="To" value={kb.toScale} min={0.5} max={4} step={0.01} unit="×" onChange={(v) => patch({ kenBurns: { ...kb, toScale: v } })} />
          <NumberField label="X→" value={kb.toX} min={0} max={1} step={0.01} onChange={(v) => patch({ kenBurns: { ...kb, toX: v } })} />
          <NumberField label="Y→" value={kb.toY} min={0} max={1} step={0.01} onChange={(v) => patch({ kenBurns: { ...kb, toY: v } })} />
          <SelectField className="col-span-2" value={kb.easing} options={opts(EASINGS)} onChange={(v) => patch({ kenBurns: { ...kb, easing: v } })} />
        </div>
      )}
      {clip.type === 'video' && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Punch-in zooms ({clip.zooms.length})</span>
            <button
              className="btn btn-sm"
              onClick={() => {
                const at = Math.max(0, Math.min(clip.duration - 0.5, time - clip.start));
                patch({ zooms: [...clip.zooms, { at: Math.round(at * 100) / 100, duration: Math.min(2, clip.duration - at), scale: 1.25, x: 0.5, y: 0.4, style: 'smooth' }].sort((a, b) => a.at - b.at) });
              }}
            >
              <Plus className="size-3.5" /> At playhead
            </button>
          </div>
          {clip.zooms.map((z, i) => (
            <div key={i} className="relative grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-black/20 p-2 pr-7">
              <button className="absolute right-1 top-1 rounded p-0.5 text-dim hover:text-danger" onClick={() => patch({ zooms: clip.zooms.filter((_, j) => j !== i) })} title="Remove zoom">
                <X className="size-3.5" />
              </button>
              <NumberField label="At" value={z.at} min={0} step={0.1} unit="s" onChange={(v) => patch({ zooms: clip.zooms.map((x, j) => (j === i ? { ...x, at: v } : x)) })} />
              <NumberField label="For" value={z.duration} min={0.1} step={0.1} unit="s" onChange={(v) => patch({ zooms: clip.zooms.map((x, j) => (j === i ? { ...x, duration: v } : x)) })} />
              <NumberField label="Scale" value={z.scale} min={1} max={4} step={0.01} unit="×" onChange={(v) => patch({ zooms: clip.zooms.map((x, j) => (j === i ? { ...x, scale: v } : x)) })} />
              <SelectField value={z.style} options={opts(['smooth', 'snap', 'slow-push'])} onChange={(v) => patch({ zooms: clip.zooms.map((x, j) => (j === i ? { ...x, style: v } : x)) })} />
            </div>
          ))}
        </>
      )}
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Type editors
// ---------------------------------------------------------------------------

const VideoEditor: React.FC<{ clip: VideoClip; patch: Patch }> = ({ clip, patch }) => {
  const projectId = useStudio((s) => s.projectId)!;
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Section title="Audio">
        <Switch label="Mute clip audio" checked={clip.muted} onChange={(v) => patch({ muted: v })} />
        {!clip.muted && <RangeField label="Volume" value={clip.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ volume: v })} />}
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Fade in" value={clip.audioFadeIn} min={0} step={0.1} unit="s" onChange={(v) => patch({ audioFadeIn: v })} />
          <NumberField label="Fade out" value={clip.audioFadeOut} min={0} step={0.1} unit="s" onChange={(v) => patch({ audioFadeOut: v })} />
        </div>
        <button
          className="btn btn-sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            const t = toast.loading('Removing silences & filler words…');
            api
              .runTool(projectId, 'auto_cut', { assetId: clip.assetId })
              .then((r) => toast.success(r.summary ?? 'Jump cuts applied', { id: t }))
              .catch((e) => toast.error(errorText(e), { id: t }))
              .finally(() => setBusy(false));
          }}
        >
          <Scissors className="size-3.5" /> Auto-cut silences & fillers
        </button>
      </Section>
      <Placement clip={clip} patch={patch} />
      <Motion clip={clip} patch={patch} />
      <Grade clip={clip} patch={patch} />
    </>
  );
};

const ImageEditor: React.FC<{ clip: ImageClip; patch: Patch }> = ({ clip, patch }) => (
  <>
    <Placement clip={clip} patch={patch} />
    <Section title="Backdrop" defaultOpen={false}>
      <Switch label="Blurred backdrop behind letterboxing" checked={clip.blurredBackdrop} onChange={(v) => patch({ blurredBackdrop: v })} />
    </Section>
    <Motion clip={clip} patch={patch} />
    <Grade clip={clip} patch={patch} />
  </>
);

const AudioEditor: React.FC<{ clip: AudioClip; patch: Patch }> = ({ clip, patch }) => (
  <Section title="Audio">
    <Field label="Role">
      <Segmented
        size="sm"
        value={clip.role}
        onChange={(v) => patch({ role: v })}
        options={[
          { value: 'voiceover', label: 'Voice' },
          { value: 'music', label: 'Music' },
          { value: 'sfx', label: 'SFX' },
          { value: 'original', label: 'Original' },
        ]}
      />
    </Field>
    <RangeField label="Volume" value={clip.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ volume: v })} />
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="Fade in" value={clip.fadeIn} min={0} step={0.1} unit="s" onChange={(v) => patch({ fadeIn: v })} />
      <NumberField label="Fade out" value={clip.fadeOut} min={0} step={0.1} unit="s" onChange={(v) => patch({ fadeOut: v })} />
    </div>
    <Switch label="Duck under speech" checked={clip.duck} onChange={(v) => patch({ duck: v })} />
    <Switch label="Loop to fill the clip" checked={clip.loop} onChange={(v) => patch({ loop: v })} />
  </Section>
);

const TextEditor: React.FC<{ clip: TextClip; patch: Patch }> = ({ clip, patch }) => {
  const st = clip.style;
  const style = (p: Record<string, unknown>) => patch({ style: p });
  return (
    <>
      <Section title="Text">
        <TextArea value={clip.text} onChange={(v) => patch({ text: v })} rows={3} />
        <p className="-mt-1 text-[11px] text-dim">Wrap words in *asterisks* to highlight them.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="In">
            <SelectField value={clip.animationIn} options={opts(TEXT_ANIMATIONS)} onChange={(v) => patch({ animationIn: v })} />
          </Field>
          <Field label="Out">
            <SelectField value={clip.animationOut} options={opts(TEXT_ANIMATIONS)} onChange={(v) => patch({ animationOut: v })} />
          </Field>
          <NumberField label="X" value={clip.x} min={0} max={1} step={0.01} onChange={(v) => patch({ x: v })} />
          <NumberField label="Y" value={clip.y} min={0} max={1} step={0.01} onChange={(v) => patch({ y: v })} />
        </div>
      </Section>
      <Section title="Style">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Font">
            <SelectField value={st.font} options={FONT_OPTIONS} onChange={(v) => style({ font: v })} />
          </Field>
          <Field label="Align">
            <SelectField value={st.align} options={opts(['left', 'center', 'right'])} onChange={(v) => style({ align: v })} />
          </Field>
          <NumberField label="Size" value={st.size} min={6} max={600} step={2} precision={0} onChange={(v) => style({ size: v })} />
          <NumberField label="Weight" value={st.weight} min={100} max={900} step={100} precision={0} onChange={(v) => style({ weight: v })} />
        </div>
        <Field label="Color" inline>
          <ColorField value={st.color} onChange={(v) => style({ color: v })} className="w-44" />
        </Field>
        <Field label="Highlight" inline>
          <ColorField value={st.highlightColor} onChange={(v) => style({ highlightColor: v })} allowClear onClear={() => style({ highlightColor: null })} placeholder="brand" className="w-44" />
        </Field>
        <Field label="Box" inline>
          <ColorField value={st.background} onChange={(v) => style({ background: v })} allowClear onClear={() => style({ background: null })} className="w-44" />
        </Field>
        <Field label="Outline" inline>
          <ColorField value={st.strokeColor} onChange={(v) => style({ strokeColor: v, strokeWidth: st.strokeWidth || 6 })} allowClear onClear={() => style({ strokeColor: null, strokeWidth: 0 })} className="w-44" />
        </Field>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Switch label="Uppercase" checked={st.uppercase} onChange={(v) => style({ uppercase: v })} />
          <Switch label="Shadow" checked={st.shadow} onChange={(v) => style({ shadow: v })} />
          <Switch label="Italic" checked={st.italic} onChange={(v) => style({ italic: v })} />
        </div>
      </Section>
    </>
  );
};

const SceneEditor: React.FC<{ clip: SceneClip; patch: Patch }> = ({ clip, patch }) => {
  const catalog = useMemo(() => templateCatalog(), []);
  const t = catalog.find((x) => x.id === clip.template);
  return (
    <>
      <Section title="Template">
        <SelectField
          value={clip.template}
          options={catalog.map((x) => ({ value: x.id, label: `${x.name}${x.overlay ? ' (overlay)' : ''}` }))}
          onChange={(v) => {
            const next = catalog.find((x) => x.id === v);
            if (next) patch({ template: v, props: structuredClone(next.example) });
          }}
        />
        {t && <p className="text-[11px] leading-snug text-dim">{t.description}</p>}
      </Section>
      {t && (
        <Section title="Content">
          <SchemaForm schema={t.props as TemplateInfo['props']} value={clip.props as Record<string, unknown>} onChange={(p) => patch({ props: p })} />
        </Section>
      )}
    </>
  );
};

const CodeEditor: React.FC<{ clip: CodeClip; patch: Patch }> = ({ clip, patch }) => {
  const [props, setProps] = useState(JSON.stringify(clip.props, null, 2));
  useEffect(() => setProps(JSON.stringify(clip.props, null, 2)), [clip.props]);
  return (
    <>
      <Section title="Custom scene">
        {clip.description && <p className="text-xs leading-snug text-muted">{clip.description}</p>}
        <Switch label="Transparent overlay" checked={clip.transparent} onChange={(v) => patch({ transparent: v })} />
        <button
          className="btn btn-sm"
          onClick={() => {
            useStudio.setState({ composerPrefill: 'Change the selected code scene: ' });
            useStudio.getState().focusComposer();
          }}
        >
          <WandSparkles className="size-3.5" /> Ask the Director to change it
        </button>
      </Section>
      <Section title="Props (JSON)" defaultOpen={false}>
        <TextArea
          mono
          value={props}
          rows={6}
          commit="blur"
          onChange={(v) => {
            setProps(v);
            try {
              patch({ props: JSON.parse(v) });
            } catch {
              toast.error('Props must be valid JSON');
            }
          }}
        />
      </Section>
      <Section title="Code (TSX)" defaultOpen={false}>
        <TextArea mono value={clip.code} rows={16} commit="blur" onChange={(v) => patch({ code: v })} />
      </Section>
    </>
  );
};

const CaptionsEditor: React.FC<{ clip: CaptionsClip; patch: Patch }> = ({ clip, patch }) => {
  const st = clip.style;
  const style = (p: Record<string, unknown>) => patch({ style: p });
  return (
    <>
      <Section title="Captions">
        <Field label="Source">
          <Segmented
            size="sm"
            value={clip.mode}
            onChange={(v) => patch({ mode: v })}
            options={[
              { value: 'auto', label: 'Auto (from speech)' },
              { value: 'manual', label: 'Manual words' },
            ]}
          />
        </Field>
        <Field label="Style">
          <div className="grid grid-cols-2 gap-1.5">
            {CAPTION_PRESETS.map((p) => (
              <button key={p} onClick={() => style({ preset: p })} className={cn('rounded-md border px-2 py-1.5 text-xs font-semibold capitalize', st.preset === p ? 'border-accent bg-accent/15 text-text' : 'border-line text-muted hover:text-text')}>
                {p.replace('-', ' ')}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Position">
          <Segmented size="sm" value={st.position} onChange={(v) => style({ position: v })} options={opts(['top', 'center', 'bottom']).map((o) => ({ value: o.value as 'top', label: o.label }))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Size" value={st.fontSize} placeholder="auto" min={10} max={300} step={2} precision={0} onChange={(v) => style({ fontSize: v })} />
          <NumberField label="Words" value={st.maxWordsPerPage} placeholder="auto" min={1} max={20} step={1} precision={0} onChange={(v) => style({ maxWordsPerPage: Math.round(v) })} />
          <NumberField label="Offset" value={st.offsetY} min={-0.5} max={0.5} step={0.01} onChange={(v) => style({ offsetY: v })} />
          <NumberField label="Stroke" value={st.strokeWidth} placeholder="auto" min={0} max={30} step={1} precision={0} onChange={(v) => style({ strokeWidth: v })} />
        </div>
        <Field label="Font">
          <SelectField value={st.font ?? ''} placeholder="Preset default" options={FONT_OPTIONS} onChange={(v) => style({ font: v || null })} />
        </Field>
        <Field label="Text" inline>
          <ColorField value={st.color} onChange={(v) => style({ color: v })} className="w-44" />
        </Field>
        <Field label="Active word" inline>
          <ColorField value={st.highlightColor} onChange={(v) => style({ highlightColor: v })} allowClear onClear={() => style({ highlightColor: null })} placeholder="brand" className="w-44" />
        </Field>
        <Field label="Background" inline>
          <ColorField value={st.backgroundColor} onChange={(v) => style({ backgroundColor: v })} allowClear onClear={() => style({ backgroundColor: null })} className="w-44" />
        </Field>
        <Switch label="Uppercase" checked={st.uppercase ?? false} onChange={(v) => style({ uppercase: v })} />
      </Section>
    </>
  );
};

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

const ProjectHealth: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .lint(project.id)
        .then((r) => setWarnings(r.warnings))
        .catch(() => setWarnings([]));
    }, 600);
    return () => clearTimeout(t);
  }, [project]);
  return (
    <div className="flex flex-col">
      <Empty icon={<MousePointerClick className="size-7" />} title="Nothing selected">
        Click a clip on the timeline to edit it. Double-click to jump straight here.
      </Empty>
      {warnings && warnings.length > 0 && (
        <Section title={`Timeline check (${warnings.length})`}>
          <ul className="flex flex-col gap-1.5">
            {warnings.slice(0, 12).map((w, i) => (
              <li key={i} className="flex gap-1.5 text-xs leading-snug text-muted">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                {w}
              </li>
            ))}
          </ul>
          <button
            className="btn btn-sm self-start"
            onClick={() => {
              useStudio.setState({ composerPrefill: 'Run a timeline check and fix the problems you find.' });
              useStudio.getState().focusComposer();
            }}
          >
            <WandSparkles className="size-3.5" /> Ask the Director to fix these
          </button>
        </Section>
      )}
    </div>
  );
};

export const Inspector: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const selection = useStudio((s) => s.selection);
  const editSoon = useStudio((s) => s.editSoon);
  const edit = useStudio((s) => s.edit);

  if (selection.length === 0) return <div className="h-full overflow-y-auto"><ProjectHealth /></div>;
  if (selection.length > 1) {
    return (
      <Empty title={`${selection.length} clips selected`}>
        <div className="mt-3 flex flex-col gap-2">
          <button className="btn" onClick={duplicateSelection}>
            <Copy className="size-4" /> Duplicate
          </button>
          <button className="btn text-danger" onClick={() => void edit([{ op: 'removeClips', clipIds: selection }], `Delete ${selection.length} clips`)}>
            <Trash2 className="size-4" /> Delete
          </button>
        </div>
      </Empty>
    );
  }
  const ref = getClipRef(project, selection[0]!);
  if (!ref) return null;
  const { clip, track } = ref;
  const patch: Patch = (p) => editSoon(`clip:${clip.id}`, { op: 'updateClip', clipId: clip.id, patch: p }, `Edit ${clip.type}`);
  const color = clipColor(clip);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="flex size-7 items-center justify-center rounded-md" style={{ background: color.bg, color: color.text, border: `1px solid ${color.border}` }}>
          <ClipIcon clip={clip} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold">{clipLabel(clip, project)}</div>
          <div className="text-[11px] text-dim">
            {clip.type} on {track.name} · {clip.start.toFixed(2)}–{clipEnd(clip).toFixed(2)}s
          </div>
        </div>
        {track.locked && <Badge tone="warn">locked</Badge>}
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto', track.locked && 'pointer-events-none opacity-60')}>
        <Timing clip={clip} patch={patch} />
        {clip.type === 'video' && <VideoEditor clip={clip} patch={patch} />}
        {clip.type === 'image' && <ImageEditor clip={clip} patch={patch} />}
        {clip.type === 'audio' && <AudioEditor clip={clip} patch={patch} />}
        {clip.type === 'text' && <TextEditor clip={clip} patch={patch} />}
        {clip.type === 'scene' && <SceneEditor clip={clip} patch={patch} />}
        {clip.type === 'code' && <CodeEditor clip={clip} patch={patch} />}
        {clip.type === 'captions' && <CaptionsEditor clip={clip} patch={patch} />}
        {clip.type !== 'audio' && clip.type !== 'captions' && <Transitions clip={clip} patch={patch} />}
      </div>
      <div className="flex gap-1.5 border-t border-line p-2">
        <button className="btn btn-sm flex-1" onClick={splitAtPlayhead} title="Split at playhead (S)">
          <Scissors className="size-3.5" /> Split
        </button>
        <button className="btn btn-sm flex-1" onClick={duplicateSelection}>
          <Copy className="size-3.5" /> Duplicate
        </button>
        <button
          className="btn btn-sm flex-1"
          onClick={() => {
            useStudio.setState({ composerPrefill: 'About the selected clip: ' });
            useStudio.getState().focusComposer();
          }}
        >
          <MessageSquareText className="size-3.5" /> Ask AI
        </button>
        <button className="btn btn-sm btn-icon text-danger" title="Delete" onClick={() => void edit([{ op: 'removeClips', clipIds: [clip.id] }], 'Delete clip')}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
};

import React from 'react';
import { FONTS } from '../../../../shared/fonts';
import { useStudio } from '../../../lib/store';
import { mediaUrl } from '../../../lib/api';
import { ColorField, Field, NumberField, Section, SelectField, Switch, TextArea, TextInput } from '../../ui';
import { PanelHeader } from '../LeftPanel';

const FONT_OPTIONS = FONTS.map((f) => ({ value: f.id, label: f.family.replace(' Variable', '') }));

export const ProjectPanel: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const editSoon = useStudio((s) => s.editSoon);
  const { brief, brand, canvas } = project;
  const setBrief = (patch: Record<string, unknown>) => editSoon('brief', { op: 'setBrief', patch }, 'Edit brief');
  const setBrand = (patch: Record<string, unknown>) => editSoon('brand', { op: 'setBrand', patch }, 'Edit brand');
  const images = project.assets.filter((a) => a.kind === 'image');
  const logo = images.find((a) => a.id === brand.logoAssetId);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Project" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Brief">
          <Field label="Topic">
            <TextArea value={brief.topic} onChange={(v) => setBrief({ topic: v })} rows={2} placeholder="What is this video about?" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mode">
              <SelectField
                value={brief.mode}
                onChange={(v) => setBrief({ mode: v })}
                options={[
                  { value: 'generate', label: 'From topic' },
                  { value: 'edit', label: 'Edit footage' },
                  { value: 'hybrid', label: 'Both' },
                ]}
              />
            </Field>
            <Field label="Target length">
              <NumberField value={brief.targetDurationSec} min={5} max={7200} step={5} unit="s" precision={0} placeholder="auto" onChange={(v) => setBrief({ targetDurationSec: v })} />
            </Field>
          </div>
          <Field label="Goal">
            <TextInput value={brief.goal} onChange={(v) => setBrief({ goal: v })} placeholder="e.g. teach, sell, entertain" />
          </Field>
          <Field label="Audience">
            <TextInput value={brief.audience} onChange={(v) => setBrief({ audience: v })} placeholder="Who is watching?" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tone">
              <TextInput value={brief.tone} onChange={(v) => setBrief({ tone: v })} placeholder="e.g. energetic" />
            </Field>
            <Field label="Language">
              <TextInput value={brief.language} onChange={(v) => setBrief({ language: v })} placeholder="en" />
            </Field>
          </div>
          <Field label="Visual style">
            <TextInput value={brief.style} onChange={(v) => setBrief({ style: v })} placeholder="e.g. clean, bold, documentary" />
          </Field>
          <Field label="Call to action">
            <TextInput value={brief.callToAction} onChange={(v) => setBrief({ callToAction: v })} placeholder="Subscribe, link in description…" />
          </Field>
          <Field label="Notes for the Director">
            <TextArea value={brief.notes} onChange={(v) => setBrief({ notes: v })} rows={3} placeholder="Anything else: must-haves, things to avoid, references…" />
          </Field>
        </Section>

        <Section title="Brand">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Channel">
              <TextInput value={brand.channelName} onChange={(v) => setBrand({ channelName: v })} placeholder="Channel name" />
            </Field>
            <Field label="Handle">
              <TextInput value={brand.handle} onChange={(v) => setBrand({ handle: v })} placeholder="@handle" />
            </Field>
          </div>
          {(
            [
              ['primary', 'Primary'],
              ['secondary', 'Secondary'],
              ['accent', 'Accent'],
              ['background', 'Background'],
              ['surface', 'Surface'],
              ['text', 'Text'],
              ['mutedText', 'Muted text'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label} inline>
              <ColorField value={brand[key]} onChange={(v) => setBrand({ [key]: v })} className="w-40" />
            </Field>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Heading font">
              <SelectField value={brand.headingFont} onChange={(v) => setBrand({ headingFont: v })} options={FONT_OPTIONS} />
            </Field>
            <Field label="Body font">
              <SelectField value={brand.bodyFont} onChange={(v) => setBrand({ bodyFont: v })} options={FONT_OPTIONS} />
            </Field>
          </div>
          <Field label="Logo" hint={images.length === 0 ? 'Upload a logo (PNG with transparency works best) in Media first.' : undefined}>
            <div className="flex items-center gap-2">
              {logo?.thumb && <img src={mediaUrl(project.id, logo.thumb)} alt="" className="checker size-9 rounded border border-line object-contain" />}
              <SelectField value={brand.logoAssetId ?? ''} onChange={(v) => setBrand({ logoAssetId: v || null })} options={images.map((a) => ({ value: a.id, label: a.name }))} placeholder="No logo" />
            </div>
          </Field>
          <Switch label="Logo watermark in the corner" checked={brand.watermark} disabled={!brand.logoAssetId} onChange={(v) => setBrand({ watermark: v })} />
        </Section>

        <Section title="Canvas" defaultOpen={false}>
          <Field label="Background" inline>
            <ColorField value={canvas.background} onChange={(v) => editSoon('canvas', { op: 'setCanvas', patch: { background: v } }, 'Canvas background')} className="w-40" />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="W" value={canvas.width} min={64} max={7680} step={2} precision={0} onChange={(v) => editSoon('canvas', { op: 'setCanvas', patch: { width: Math.round(v) } }, 'Canvas size')} />
            <NumberField label="H" value={canvas.height} min={64} max={7680} step={2} precision={0} onChange={(v) => editSoon('canvas', { op: 'setCanvas', patch: { height: Math.round(v) } }, 'Canvas size')} />
            <NumberField label="FPS" value={canvas.fps} min={12} max={60} step={1} precision={0} onChange={(v) => editSoon('canvas', { op: 'setCanvas', patch: { fps: Math.round(v) } }, 'Frame rate')} />
          </div>
        </Section>
      </div>
    </div>
  );
};

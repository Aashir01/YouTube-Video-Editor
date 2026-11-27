import React, { useState } from 'react';
import { toast } from 'sonner';
import { Crosshair, EyeOff, ScanFace } from 'lucide-react';
import type { BlurClip, Clip, VideoClip } from '../../../shared/schema';
import { baseVideoFor } from '../../../shared/motion';
import { api } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { errorText } from '../../lib/utils';
import { NumberField, RangeField, Section, Segmented } from '../ui';
import { useAnim } from './Keyframes';

type Patch = (p: Record<string, unknown>) => void;

/** Run an editor tool with a loading toast; shows the tool's own summary. */
const useToolRun = () => {
  const projectId = useStudio((s) => s.projectId)!;
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, tool: string, input: Record<string, unknown>, working: string, done: string) => {
    setBusy(key);
    const t = toast.loading(working);
    api
      .runTool(projectId, tool, input)
      .then((r) => toast.success(`${done}: ${r.summary ?? 'done'}`, { id: t }))
      .catch((e) => toast.error(errorText(e), { id: t }))
      .finally(() => setBusy(null));
  };
  return { busy, run };
};

/** Make a text, picture-in-picture or blur clip follow a face or whatever is under it. */
export const MotionTracking: React.FC<{ clip: Clip }> = ({ clip }) => {
  const project = useStudio((s) => s.project!);
  const { busy, run } = useToolRun();
  const base = baseVideoFor(project, clip);
  return (
    <Section title="Motion tracking" defaultOpen={clip.type === 'blur'}>
      <p className="-mt-1 text-[11px] leading-snug text-dim">
        {base ? 'Place it where you want it at its first frame, then let it follow along. It keeps its spot relative to what it follows.' : 'Put a video on a track below this clip to follow something in it.'}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <button className="btn btn-sm" disabled={!base || busy !== null} title="Follow the nearest face in the video below" onClick={() => run('face', 'track_motion', { clipId: clip.id, target: 'face' }, 'Following the face…', 'Motion tracking')}>
          <ScanFace className="size-3.5" /> {busy === 'face' ? 'Tracking…' : 'Follow a face'}
        </button>
        <button className="btn btn-sm" disabled={!base || busy !== null} title="Follow whatever is under this clip now: an object, a licence plate, a screen" onClick={() => run('under', 'track_motion', { clipId: clip.id, target: 'under' }, 'Tracking what is under it…', 'Motion tracking')}>
          <Crosshair className="size-3.5" /> {busy === 'under' ? 'Tracking…' : 'Track what’s under it'}
        </button>
      </div>
    </Section>
  );
};

/** One click: a soft blur over every face in a video clip, following each one. */
export const BlurFacesButton: React.FC<{ clip: VideoClip }> = ({ clip }) => {
  const { busy, run } = useToolRun();
  return (
    <button className="btn btn-sm" disabled={busy !== null} title="Hide every face in this clip: adds a blur that follows each person" onClick={() => run('blur', 'blur_faces', { clipId: clip.id }, 'Finding and blurring faces…', 'Blur faces')}>
      <EyeOff className="size-3.5" /> {busy ? 'Blurring faces…' : 'Blur faces'}
    </button>
  );
};

export const BlurEditor: React.FC<{ clip: BlurClip; patch: Patch }> = ({ clip, patch }) => {
  const A = useAnim(clip, patch);
  return (
    <Section title="Blur">
      <p className="-mt-1 text-[11px] leading-snug text-dim">Blurs whatever is under the box: drag it over a face, plate or screen in the preview.</p>
      <Segmented
        size="sm"
        value={clip.shape}
        onChange={(v) => patch({ shape: v })}
        options={[
          { value: 'ellipse', label: 'Soft oval' },
          { value: 'rect', label: 'Rectangle' },
        ]}
      />
      <RangeField label="Strength" value={clip.strength} min={4} max={120} step={1} format={(v) => `${Math.round(v)} px`} onChange={(v) => patch({ strength: Math.round(v) })} />
      <RangeField label="Opacity" {...A.field('opacity')} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" {...A.field('box.x')} min={-1} max={2} step={0.01} />
        <NumberField label="Y" {...A.field('box.y')} min={-1} max={2} step={0.01} />
        <NumberField label="W" {...A.field('box.w')} min={0.01} max={3} step={0.01} />
        <NumberField label="H" {...A.field('box.h')} min={0.01} max={3} step={0.01} />
      </div>
    </Section>
  );
};

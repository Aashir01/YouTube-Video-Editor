import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Crosshair, EyeOff, Eraser, Palette, ScanFace, Undo2, Upload, UserRound, Vibrate } from 'lucide-react';
import type { BlurClip, Clip, VideoClip } from '../../../shared/schema';
import { baseVideoFor } from '../../../shared/motion';
import { api } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { errorText } from '../../lib/utils';
import { NumberField, RangeField, Section, Segmented, SelectField, Switch } from '../ui';
import { useUpload } from './panels/MediaPanel';
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

/** Remove the background of a video clip: the person (no green screen needed) or a green/blue screen. */
export const BackgroundSection: React.FC<{ clip: VideoClip }> = ({ clip }) => {
  const asset = useStudio((s) => s.project?.assets.find((a) => a.id === clip.assetId));
  const { busy, run } = useToolRun();
  const [blurBehind, setBlurBehind] = useState(false);
  const derived = asset?.derived?.kind === 'background' || asset?.derived?.kind === 'greenscreen' ? asset.derived : null;
  if (clip.multicam) return null;
  return (
    <Section title="Background" defaultOpen={Boolean(derived)}>
      {derived ? (
        <>
          <p className="-mt-1 text-[11px] leading-snug text-dim">
            {derived.kind === 'background' ? 'The background is removed' : `The screen (${derived.note ?? 'auto'}) is keyed out`}: whatever is on the tracks below shows through.
          </p>
          <button className="btn btn-sm" disabled={busy !== null} onClick={() => run('restore', 'remove_background', { clipId: clip.id, mode: 'restore' }, 'Restoring…', 'Original')}>
            <Undo2 className="size-3.5" /> Restore the original
          </button>
        </>
      ) : (
        <>
          <p className="-mt-1 text-[11px] leading-snug text-dim">Cut the person out (no green screen needed), or key out a green or blue screen. Put an image or b-roll on a track below it, or blur the original behind.</p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() => run('person', 'remove_background', { clipId: clip.id, mode: 'person', behind: blurBehind ? 'blur' : 'none' }, 'Removing the background (every frame)…', 'Background removed')}
            >
              <UserRound className="size-3.5" /> Remove background
            </button>
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() => run('screen', 'remove_background', { clipId: clip.id, mode: 'screen', behind: blurBehind ? 'blur' : 'none' }, 'Keying out the screen…', 'Screen removed')}
            >
              <Eraser className="size-3.5" /> Remove green screen
            </button>
          </div>
          <Switch checked={blurBehind} onChange={setBlurBehind} label="Blurred original behind (portrait mode)" />
        </>
      )}
    </Section>
  );
};

/** Stabilize shaky footage and apply a color look from a .cube LUT (both as processed copies). */
export const FootageSection: React.FC<{ clip: VideoClip }> = ({ clip }) => {
  const project = useStudio((s) => s.project!);
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const luts = project.assets.filter((a) => /\.cube$/i.test(a.file));
  const { busy, run } = useToolRun();
  const { upload, progress } = useUpload();
  const [strength, setStrength] = useState<'light' | 'medium' | 'strong'>('medium');
  const [lut, setLut] = useState('');
  const [intensity, setIntensity] = useState(1);
  const file = useRef<HTMLInputElement>(null);
  const derived = asset?.derived?.kind === 'stabilized' || asset?.derived?.kind === 'lut' ? asset.derived : null;
  const chosen = lut || luts[0]?.id || '';
  if (clip.multicam) return null;
  return (
    <Section title="Footage" defaultOpen={Boolean(derived)}>
      {derived && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-black/20 px-2 py-1.5 text-[11px] text-muted">
          <span className="flex-1">{derived.kind === 'stabilized' ? `Stabilized: ${derived.note ?? ''}` : `Color look: ${derived.note ?? ''}`}</span>
          <button className="btn btn-sm" disabled={busy !== null} onClick={() => run('restore', 'remove_background', { clipId: clip.id, mode: 'restore' }, 'Restoring…', 'Original')}>
            <Undo2 className="size-3.5" /> Restore the original
          </button>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Segmented size="sm" className="flex-1" value={strength} onChange={setStrength} options={(['light', 'medium', 'strong'] as const).map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))} />
        <button className="btn btn-sm" disabled={busy !== null} onClick={() => run('stab', 'stabilize_video', { clipId: clip.id, strength }, 'Stabilizing (two passes)…', 'Stabilized')}>
          <Vibrate className="size-3.5" /> Stabilize
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <SelectField className="flex-1" value={chosen} onChange={setLut} placeholder={luts.length ? undefined : 'Import a .cube LUT…'} options={luts.map((a) => ({ value: a.id, label: a.name }))} />
        <button className="btn btn-sm btn-icon" title="Import a .cube LUT" aria-label="Import a .cube LUT" disabled={progress !== null} onClick={() => file.current?.click()}>
          <Upload className="size-3.5" />
        </button>
        <input
          ref={file}
          type="file"
          accept=".cube"
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void upload(files).then((added) => added[0] && setLut(added[0].id));
          }}
        />
      </div>
      <RangeField label="Look strength" value={intensity} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={setIntensity} />
      <button className="btn btn-sm" disabled={busy !== null || !chosen} onClick={() => run('lut', 'apply_lut', { clipId: clip.id, lutAssetId: chosen, intensity }, 'Applying the color look…', 'Color look')}>
        <Palette className="size-3.5" /> Apply the look
      </button>
    </Section>
  );
};

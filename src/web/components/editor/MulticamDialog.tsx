import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Mic, Video } from 'lucide-react';
import type { Asset } from '../../../shared/schema';
import { api, mediaUrl } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { player } from '../../lib/player';
import { cn, errorText, formatClock } from '../../lib/utils';
import { Field, Modal, Segmented, SelectField, Spinner } from '../ui';

/**
 * Multicam: pick the cameras (and microphones) of one recording. Cutroom lines them up by their
 * sound and cuts to whoever is talking; any cut can be switched later with 1–9 or the clip menu.
 */
const SourceRow: React.FC<{ asset: Asset; projectId: string; order: number; onToggle: () => void; icon: React.ReactNode }> = ({ asset, projectId, order, onToggle, icon }) => (
  <button
    onClick={onToggle}
    aria-pressed={order > 0}
    className={cn('flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors', order > 0 ? 'border-accent/60 bg-accent/[0.08]' : 'border-line hover:border-line-2')}
  >
    <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold', order > 0 ? 'bg-accent text-white' : 'border border-line text-dim')}>{order > 0 ? order : ''}</span>
    {asset.thumb ? <img src={mediaUrl(projectId, asset.thumb)} alt="" className="h-8 w-14 shrink-0 rounded object-cover" /> : <span className="flex h-8 w-14 shrink-0 items-center justify-center rounded bg-black/30 text-dim">{icon}</span>}
    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{asset.name}</span>
    <span className="font-mono text-[10px] text-dim">{formatClock(asset.meta.duration ?? 0)}</span>
  </button>
);

export const MulticamDialog: React.FC = () => {
  const open = useStudio((s) => s.multicamOpen);
  const project = useStudio((s) => s.project);
  const close = () => useStudio.setState({ multicamOpen: false });
  const [cams, setCams] = useState<string[]>([]);
  const [mics, setMics] = useState<string[]>([]);
  const [follow, setFollow] = useState<'speaker' | 'first'>('speaker');
  const [wide, setWide] = useState('auto');
  const [busy, setBusy] = useState(false);
  const videos = useMemo(() => project?.assets.filter((a) => a.kind === 'video' && a.meta.hasAudio !== false) ?? [], [project?.assets]);
  const audios = useMemo(() => project?.assets.filter((a) => a.kind === 'audio') ?? [], [project?.assets]);
  useEffect(() => {
    if (!open) return;
    setCams([]);
    setMics([]);
    setWide('auto');
  }, [open]);
  if (!project) return null;

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const ready = cams.length >= 1 && cams.length + mics.length >= 2;

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createMulticam(project.id, { cameras: cams, microphones: mics.length ? mics : undefined, follow, wide: follow === 'speaker' && wide !== 'auto' ? wide : undefined });
      toast.success(r.summary, { duration: 9000 });
      for (const w of r.warnings) toast.warning(w, { duration: 9000 });
      close();
      const first = useStudio.getState().project?.tracks.flatMap((t) => t.clips).find((c) => c.type === 'video' && c.multicam === r.groupId);
      if (first) player.seek(first.start);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && close()}
      title="Multicam"
      description="Pick the cameras of one recording, and any separate microphones. They are lined up by their sound, then the edit cuts to whoever is talking."
      footer={
        <>
          <button className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={() => void create()}>
            {busy ? <Spinner /> : <Video className="size-4" />} {busy ? 'Syncing and cutting…' : 'Sync and create'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Cameras {cams.length > 0 && <span className="normal-case text-dim">· camera 1 is the reference</span>}</div>
          {videos.length === 0 ? (
            <p className="text-xs text-dim">Import the camera files first (Media tab).</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {videos.map((a) => (
                <SourceRow key={a.id} asset={a} projectId={project.id} order={cams.indexOf(a.id) + 1} onToggle={() => toggle(cams, setCams, a.id)} icon={<Video className="size-4" />} />
              ))}
            </div>
          )}
        </div>
        {audios.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Microphones <span className="normal-case text-dim">· optional, one per person cuts best</span></div>
            <div className="flex flex-col gap-1.5">
              {audios.map((a) => (
                <SourceRow key={a.id} asset={a} projectId={project.id} order={mics.indexOf(a.id) + 1} onToggle={() => toggle(mics, setMics, a.id)} icon={<Mic className="size-4" />} />
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Segmented
            value={follow}
            onChange={setFollow}
            options={[
              { value: 'speaker', label: 'Follow the speaker' },
              { value: 'first', label: 'Stay on camera 1' },
            ]}
          />
          {follow === 'speaker' && cams.length > 1 && (
            <Field label="Wide shot (shows everyone)">
              <SelectField
                value={wide}
                onChange={setWide}
                options={[{ value: 'auto', label: 'Find it automatically' }, ...cams.map((id, i) => ({ value: id, label: `Camera ${i + 1}: ${project.assets.find((a) => a.id === id)?.name ?? id}` }))]}
              />
            </Field>
          )}
          <p className="text-[11px] leading-relaxed text-dim">Later, press 1–9 during playback to cut to a camera at the playhead, or right-click a cut to switch it.</p>
        </div>
      </div>
    </Modal>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { Thumbnail } from '@remotion/player';
import { toast } from 'sonner';
import { CircleCheck, Clapperboard, Download, ExternalLink, FileText, Plus, RefreshCw, Trash2, Upload, WandSparkles, X } from 'lucide-react';
import type { RenderRecord, ThumbnailInput } from '../../../shared/schema';
import { ThumbnailComposition, THUMBNAIL_TEMPLATES } from '../../../remotion/Thumbnail';
import { formatTime, projectDuration } from '../../../shared/timeline';
import { api, mediaUrl, renderUrl } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { cn, errorText, formatBytes, formatClock } from '../../lib/utils';
import { YouTubeIcon } from '../icons';
import { Badge, Field, Modal, ProgressBar, Segmented, SelectField, Spinner, Switch, TextArea, TextInput } from '../ui';

const PRESETS = [
  { value: 'draft', label: 'Draft — half resolution, fast' },
  { value: 'standard', label: 'Standard — full resolution' },
  { value: 'high', label: 'High quality — larger file' },
  { value: '4k', label: '4K — 2× canvas' },
];

const CATEGORIES = [
  { value: '27', label: 'Education' },
  { value: '28', label: 'Science & Technology' },
  { value: '22', label: 'People & Blogs' },
  { value: '24', label: 'Entertainment' },
  { value: '26', label: 'Howto & Style' },
  { value: '20', label: 'Gaming' },
  { value: '10', label: 'Music' },
  { value: '25', label: 'News & Politics' },
  { value: '17', label: 'Sports' },
  { value: '19', label: 'Travel & Events' },
  { value: '1', label: 'Film & Animation' },
  { value: '2', label: 'Autos & Vehicles' },
  { value: '15', label: 'Pets & Animals' },
];

const active = (r: RenderRecord) => ['queued', 'bundling', 'rendering', 'finishing'].includes(r.status);

const RenderRow: React.FC<{ r: RenderRecord }> = ({ r }) => {
  const projectId = useStudio((s) => s.projectId)!;
  const running = active(r);
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        {r.status === 'done' ? <CircleCheck className="size-4 text-ok" /> : running ? <Spinner className="size-4 text-accent" /> : <X className="size-4 text-danger" />}
        <span className="font-semibold capitalize">{r.preset}</span>
        <span className="text-dim">
          {[r.width && `${r.width}×${r.height}`, r.durationSec && formatClock(r.durationSec), r.sizeBytes && formatBytes(r.sizeBytes), r.elapsedSec && `rendered in ${formatClock(r.elapsedSec)}`].filter(Boolean).join(' · ')}
        </span>
        <span className="flex-1" />
        {r.status === 'done' && r.file && (
          <>
            <a className="btn btn-sm" href={renderUrl(projectId, r.file, true)} download>
              <Download className="size-3.5" /> MP4
            </a>
            <a className="btn btn-sm btn-ghost" href={renderUrl(projectId, r.file.replace(/\.mp4$/, '.srt'), true)} download title="Captions file">
              <FileText className="size-3.5" /> SRT
            </a>
          </>
        )}
        {running ? (
          <button className="btn btn-sm btn-ghost" onClick={() => void api.cancelRender(projectId, r.id)}>
            Cancel
          </button>
        ) : (
          <button className="btn btn-sm btn-ghost btn-icon text-dim hover:text-danger" title="Delete render" onClick={() => void api.deleteRender(projectId, r.id).catch((e) => toast.error(errorText(e)))}>
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {running && (
        <div className="mt-2">
          <ProgressBar value={r.progress} />
          <div className="mt-1 text-[11px] capitalize text-dim">
            {r.status}… {Math.round(r.progress * 100)}%
          </div>
        </div>
      )}
      {r.error && <div className="mt-1 text-[11px] text-danger">{r.error}</div>}
    </div>
  );
};

const RenderSection: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const [preset, setPreset] = useState('standard');
  const [starting, setStarting] = useState(false);
  const renders = project.renders.filter((r) => r.kind === 'video');
  const latest = renders.find((r) => r.status === 'done' && r.file);
  const duration = projectDuration(project);
  const start = async () => {
    setStarting(true);
    try {
      await api.render(project.id, { preset });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Field label="Quality" className="flex-1">
          <SelectField value={preset} onChange={setPreset} options={PRESETS} />
        </Field>
        <button className="btn btn-primary" disabled={starting || duration === 0} onClick={() => void start()}>
          {starting ? <Spinner /> : <Clapperboard className="size-4" />} Render {duration > 0 ? formatClock(duration) : ''}
        </button>
      </div>
      <p className="-mt-1 text-[11px] leading-snug text-dim">
        H.264 MP4 with AAC audio{project.audio.normalize ? `, loudness-normalized to ${project.audio.loudnessTarget} LUFS` : ''}, plus an SRT caption file. Rendering runs locally with all your CPU cores.
      </p>
      {latest?.file && <video src={renderUrl(project.id, latest.file)} controls className="w-full rounded-lg border border-line bg-black" style={{ maxHeight: 260 }} />}
      <div className="flex flex-col gap-2">
        {renders.map((r) => (
          <RenderRow key={r.id} r={r} />
        ))}
      </div>
    </div>
  );
};

const ThumbnailSection: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const editSoon = useStudio((s) => s.editSoon);
  const [rendering, setRendering] = useState(false);
  const thumb = project.youtube.thumbnail;
  const props = thumb.props as Record<string, unknown>;
  const portrait = project.canvas.height > project.canvas.width;
  const [w, h] = portrait ? [1080, 1920] : [1280, 720];
  const assetUrls = useMemo(() => Object.fromEntries(project.assets.map((a) => [a.id, mediaUrl(project.id, a.file)])), [project.assets, project.id]);
  const input = useMemo<ThumbnailInput>(() => ({ project, assetUrls, thumbnail: thumb }), [project, assetUrls, thumb]);
  const setThumb = (patch: Record<string, unknown>) => editSoon('thumb', { op: 'setYoutube', patch: { thumbnail: patch } }, 'Edit thumbnail');
  const images = project.assets.filter((a) => a.kind === 'image');
  const render = async () => {
    setRendering(true);
    try {
      useStudio.getState().flushEdits();
      await api.thumbnail(project.id);
      toast.success('Thumbnail rendered');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setRendering(false);
    }
  };
  return (
    <div className={cn('grid gap-3', portrait ? 'grid-cols-[160px_1fr]' : 'grid-cols-1')}>
      <div className="overflow-hidden rounded-lg border border-line bg-black" style={{ aspectRatio: `${w} / ${h}` }}>
        {thumb.code ? (
          thumb.file ? <img src={`${mediaUrl(project.id, thumb.file)}?v=${project.updatedAt}`} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-xs text-dim">Custom design — render to preview</div>
        ) : (
          <Thumbnail component={ThumbnailComposition} inputProps={input} compositionWidth={w} compositionHeight={h} fps={30} durationInFrames={1} frameToDisplay={0} style={{ width: '100%', height: '100%' }} />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Layout">
            <SelectField value={thumb.template} onChange={(v) => setThumb({ template: v, code: null })} options={THUMBNAIL_TEMPLATES.map((t) => ({ value: t, label: t.replace('-', ' ') }))} />
          </Field>
          <Field label="Image">
            <SelectField value={String(props.imageAssetId ?? '')} onChange={(v) => setThumb({ props: { imageAssetId: v || null } })} placeholder="None" options={images.map((a) => ({ value: a.id, label: a.name }))} />
          </Field>
        </div>
        <Field label="Headline" hint="2–5 words. *word* = highlighted.">
          <TextInput value={String(props.text ?? '')} onChange={(v) => setThumb({ props: { text: v } })} placeholder="e.g. Sleep *hacks* that work" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Subtext">
            <TextInput value={String(props.subtext ?? '')} onChange={(v) => setThumb({ props: { subtext: v } })} />
          </Field>
          <Field label="Emoji / badge">
            <TextInput value={String(props.emoji ?? '')} onChange={(v) => setThumb({ props: { emoji: v } })} placeholder="😴" />
          </Field>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm flex-1" disabled={rendering} onClick={() => void render()}>
            {rendering ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />} Render PNG
          </button>
          <button
            className="btn btn-sm flex-1"
            onClick={() => {
              useStudio.getState().setExportOpen(false);
              useStudio.setState({ composerPrefill: 'Design a high-CTR thumbnail for this video and show me.' });
              useStudio.getState().focusComposer();
            }}
          >
            <WandSparkles className="size-3.5" /> Ask Director
          </button>
        </div>
        {thumb.file && (
          <a className="text-[11px] text-accent-2 hover:underline" href={mediaUrl(project.id, thumb.file)} target="_blank" rel="noreferrer">
            Open rendered PNG
          </a>
        )}
      </div>
    </div>
  );
};

const MetadataSection: React.FC = () => {
  const yt = useStudio((s) => s.project!.youtube);
  const editSoon = useStudio((s) => s.editSoon);
  const set = (patch: Record<string, unknown>) => editSoon('youtube', { op: 'setYoutube', patch }, 'Edit YouTube details');
  const [tags, setTags] = useState(yt.tags.join(', '));
  useEffect(() => setTags(yt.tags.join(', ')), [yt.tags]);
  return (
    <div className="flex flex-col gap-3">
      <Field label={`Title (${yt.title.length}/100)`}>
        <TextInput value={yt.title} onChange={(v) => set({ title: v.slice(0, 100) })} placeholder="A clear, curiosity-driving title" />
      </Field>
      {yt.titleOptions.length > 0 && (
        <div className="-mt-1.5 flex flex-wrap gap-1">
          {yt.titleOptions.map((t) => (
            <button key={t} onClick={() => set({ title: t })} className={cn('rounded-full border px-2 py-0.5 text-left text-[11px]', t === yt.title ? 'border-accent bg-accent/15' : 'border-line text-muted hover:text-text')}>
              {t}
            </button>
          ))}
        </div>
      )}
      <Field label="Description">
        <TextArea value={yt.description} onChange={(v) => set({ description: v })} rows={7} placeholder="Hook, summary, chapters, links, credits…" />
      </Field>
      <Field label="Tags" hint="Comma separated">
        <TextInput
          value={tags}
          commit="blur"
          onChange={(v) => {
            setTags(v);
            set({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) });
          }}
        />
      </Field>
      <Field label={`Chapters (${yt.chapters.length})`} hint={yt.chapters.length && yt.chapters[0]!.time > 0 ? 'YouTube requires the first chapter at 0:00.' : 'Added to the description on upload. First one must start at 0:00, at least 3 chapters.'}>
        <div className="flex flex-col gap-1">
          {yt.chapters.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-14 shrink-0 font-mono text-[11px] text-muted">{formatTime(c.time, false)}</span>
              <TextInput value={c.title} onChange={(v) => set({ chapters: yt.chapters.map((x, j) => (j === i ? { ...x, title: v } : x)) })} className="py-1" />
              <button className="btn btn-ghost btn-icon text-dim" onClick={() => set({ chapters: yt.chapters.filter((_, j) => j !== i) })} aria-label="Remove chapter">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <button
            className="btn btn-sm btn-ghost self-start text-muted"
            onClick={() => {
              const t = Math.round(useStudio.getState().time * 10) / 10;
              set({ chapters: [...yt.chapters, { time: t, title: 'New chapter' }].sort((a, b) => a.time - b.time) });
            }}
          >
            <Plus className="size-3.5" /> Chapter at playhead
          </button>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Category">
          <SelectField value={yt.category} onChange={(v) => set({ category: v })} options={CATEGORIES} />
        </Field>
        <Field label="Visibility">
          <SelectField value={yt.privacy} onChange={(v) => set({ privacy: v })} options={['private', 'unlisted', 'public']} />
        </Field>
      </div>
      <Switch label="Made for kids" checked={yt.madeForKids} onChange={(v) => set({ madeForKids: v })} />
    </div>
  );
};

const UploadSection: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const openSettings = useStudio((s) => s.openSettings);
  const [status, setStatus] = useState<{ hasClient: boolean; connected: boolean; channelTitle: string } | null>(null);
  const done = project.renders.filter((r) => r.kind === 'video' && r.status === 'done' && r.file);
  const [renderId, setRenderId] = useState(done[0]?.id ?? '');
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => api.youtubeStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  useEffect(() => {
    if (!renderId && done[0]) setRenderId(done[0].id);
  }, [done, renderId]);

  if (!status) return <Spinner className="text-dim" />;
  if (!status.hasClient) {
    return (
      <div className="text-xs leading-relaxed text-muted">
        To upload directly, add a Google OAuth client (free) in Settings → YouTube. Or download the MP4 and upload it in YouTube Studio.
        <button
          className="btn btn-sm mt-2"
          onClick={() => {
            useStudio.getState().setExportOpen(false);
            openSettings('youtube');
          }}
        >
          Set up YouTube
        </button>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <button className="btn" onClick={() => window.open('/api/youtube/connect', '_blank', 'width=520,height=700')}>
        <YouTubeIcon className="size-4 text-[#ff0033]" /> Connect your channel
      </button>
    );
  }
  const upload = async () => {
    setBusy(true);
    try {
      useStudio.getState().flushEdits();
      await api.youtubeUpload(project.id, { renderId, privacy: project.youtube.privacy, publishAt: schedule ? new Date(schedule).toISOString() : undefined });
      toast.success('Upload started — progress is in the activity menu.');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-xs">
        <YouTubeIcon className="size-4 text-[#ff0033]" />
        <span className="font-semibold">{status.channelTitle || 'Connected'}</span>
        <Badge tone="ok">connected</Badge>
      </div>
      {done.length === 0 ? (
        <p className="text-xs text-muted">Render the video first.</p>
      ) : (
        <>
          <Field label="Video">
            <SelectField value={renderId} onChange={setRenderId} options={done.map((r) => ({ value: r.id, label: `${r.preset} · ${new Date(r.createdAt).toLocaleString()}` }))} />
          </Field>
          <Field label="Schedule (optional)" hint="Scheduled videos upload as private and go public at this time.">
            <input type="datetime-local" className="field" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
          </Field>
          <button className="btn btn-primary" disabled={busy || !renderId || !project.youtube.title.trim()} onClick={() => void upload()}>
            {busy ? <Spinner /> : <Upload className="size-4" />} Upload as {schedule ? 'scheduled' : project.youtube.privacy}
          </button>
          {!project.youtube.title.trim() && <p className="text-[11px] text-warn">Add a title first.</p>}
        </>
      )}
      {project.youtube.uploadedVideoId && (
        <a className="flex items-center gap-1 text-xs text-accent-2 hover:underline" href={`https://youtu.be/${project.youtube.uploadedVideoId}`} target="_blank" rel="noreferrer">
          <ExternalLink className="size-3.5" /> View the uploaded video
        </a>
      )}
    </div>
  );
};

export const ExportDialog: React.FC = () => {
  const open = useStudio((s) => s.exportOpen);
  const setOpen = useStudio((s) => s.setExportOpen);
  const [tab, setTab] = useState<'render' | 'youtube'>('render');
  return (
    <Modal open={open} onOpenChange={setOpen} title="Export & publish" description="Render a high-quality MP4 and get it ready for YouTube." className="w-[min(980px,96vw)]" bodyClassName="p-0">
      <div className="border-b border-line px-5 py-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'render', label: <><Clapperboard className="size-3.5" /> Render</> },
            { value: 'youtube', label: <><YouTubeIcon className="size-3.5" /> YouTube</> },
          ]}
        />
      </div>
      {tab === 'render' ? (
        <div className="grid gap-6 p-5 md:grid-cols-[1.2fr_1fr]">
          <div>
            <h3 className="label">Video</h3>
            <RenderSection />
          </div>
          <div>
            <h3 className="label">Thumbnail</h3>
            <ThumbnailSection />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 p-5 md:grid-cols-[1.3fr_1fr]">
          <div>
            <h3 className="label">Details</h3>
            <MetadataSection />
          </div>
          <div className="flex flex-col gap-6">
            <div>
              <h3 className="label">Upload</h3>
              <UploadSection />
            </div>
            <div>
              <h3 className="label">Thumbnail</h3>
              <ThumbnailSection />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

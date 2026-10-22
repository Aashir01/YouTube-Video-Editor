import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AudioLines,
  Captions,
  CirclePlus,
  Ellipsis,
  FileText,
  Film,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  Mic,
  Paperclip,
  Scissors,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  WandSparkles,
} from 'lucide-react';
import type { Asset } from '../../../../shared/schema';
import { api, mediaUrl, type StockResult } from '../../../lib/api';
import { useStudio } from '../../../lib/store';
import { addAtPlayhead, clearDragPayload, setDragPayload } from '../../../lib/dnd';
import { cn, errorText, formatBytes, formatClock } from '../../../lib/utils';
import { Badge, Empty, Menu, Segmented, Spinner, TextArea } from '../../ui';
import { PanelHeader } from '../LeftPanel';

type Filter = 'all' | 'video' | 'image' | 'audio' | 'document';
type Source = 'project' | 'stock' | 'ai';

export const useUpload = () => {
  const projectId = useStudio((s) => s.projectId);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = async (files: File[]) => {
    if (!projectId || files.length === 0) return [];
    setProgress(0);
    try {
      const { assets } = await api.upload(projectId, files, setProgress);
      toast.success(`Added ${assets.length} file${assets.length === 1 ? '' : 's'}`);
      return assets;
    } catch (err) {
      toast.error(errorText(err));
      return [];
    } finally {
      setProgress(null);
    }
  };
  return { upload, progress };
};

const kindIcon = (a: Asset, cls = 'size-6') =>
  a.kind === 'video' ? <Film className={cls} /> : a.kind === 'image' ? <ImageIcon className={cls} /> : a.kind === 'audio' ? <AudioLines className={cls} /> : <FileText className={cls} />;

/** Placeholder tint per asset kind, matching the timeline clip colors. */
const KIND_STYLE: Record<Asset['kind'], string> = {
  video: 'text-hue-sky bg-[radial-gradient(circle_at_50%_120%,rgb(56_189_248/0.22),transparent_70%)]',
  image: 'text-hue-mint bg-[radial-gradient(circle_at_50%_120%,rgb(45_212_191/0.22),transparent_70%)]',
  audio: 'text-hue-green bg-[radial-gradient(circle_at_50%_120%,rgb(52_211_153/0.2),transparent_70%)]',
  document: 'text-hue-amber bg-[radial-gradient(circle_at_50%_120%,rgb(251_191_36/0.2),transparent_70%)]',
  other: 'text-dim',
};

const AssetCard: React.FC<{ asset: Asset; selected: boolean; onSelect: () => void }> = ({ asset, selected, onSelect }) => {
  const projectId = useStudio((s) => s.projectId)!;
  const attachToChat = useStudio((s) => s.attachToChat);
  const placeable = asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio';
  const speech = asset.kind === 'video' || asset.kind === 'audio';
  const tr = asset.transcript.status;
  return (
    <div
      draggable={placeable && asset.status === 'ready'}
      onDragStart={(e) => setDragPayload(e, { kind: 'asset', assetId: asset.id })}
      onDragEnd={clearDragPayload}
      onClick={onSelect}
      onDoubleClick={() => placeable && void addAtPlayhead({ kind: 'asset', assetId: asset.id })}
      className={cn('group relative cursor-pointer overflow-hidden rounded-xl border bg-panel-2 transition-all', selected ? 'border-accent shadow-[0_0_0_3px_rgb(255_90_31/0.18)]' : 'border-line hover:-translate-y-px hover:border-line-2')}
    >
      <div className={cn('relative flex aspect-video items-center justify-center overflow-hidden bg-[#0a0c12]', !asset.thumb && KIND_STYLE[asset.kind])}>
        {asset.thumb ? <img src={mediaUrl(projectId, asset.thumb)} alt="" className="size-full object-cover" loading="lazy" draggable={false} /> : kindIcon(asset)}
        {asset.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Spinner className="text-white" />
          </div>
        )}
        {asset.status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-danger/20" title={asset.error}>
            <TriangleAlert className="size-5 text-danger" />
          </div>
        )}
        {asset.meta.duration ? <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">{formatClock(asset.meta.duration)}</span> : null}
        {speech && tr !== 'none' && (
          <span className="absolute bottom-1 left-1 rounded bg-black/70 p-0.5 text-white" title={tr === 'done' ? `Transcribed (${asset.transcript.wordCount ?? 0} words)` : tr === 'pending' ? 'Transcribing…' : `Transcription failed: ${asset.transcript.error ?? ''}`}>
            {tr === 'pending' ? <Spinner className="size-3" /> : <Captions className={cn('size-3', tr === 'error' && 'text-danger')} />}
          </span>
        )}
        {asset.origin === 'tts' && <Mic className="absolute left-1 top-1 size-3.5 text-ok" />}
      </div>
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={asset.name}>
          {asset.name}
        </span>
      </div>
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
        {placeable && (
          <button className="rounded-md bg-black/70 p-1 text-white backdrop-blur hover:bg-accent" title="Add at playhead" onClick={(e) => (e.stopPropagation(), void addAtPlayhead({ kind: 'asset', assetId: asset.id }))}>
            <CirclePlus className="size-3.5" />
          </button>
        )}
        <Menu
          trigger={
            <button className="rounded bg-black/70 p-1 text-white hover:bg-black" onClick={(e) => e.stopPropagation()} aria-label="Asset menu">
              <Ellipsis className="size-3.5" />
            </button>
          }
          items={[
            ...(placeable ? [{ label: 'Add at playhead', icon: <CirclePlus />, onSelect: () => void addAtPlayhead({ kind: 'asset', assetId: asset.id }) }] : []),
            { label: 'Attach to chat', icon: <Paperclip />, onSelect: () => attachToChat([asset.id]) },
            ...(speech
              ? [
                  { label: tr === 'done' ? 'Re-transcribe' : 'Transcribe', icon: <Captions />, onSelect: () => void api.transcribe(projectId, asset.id).then(() => toast('Transcription started')).catch((e) => toast.error(errorText(e))) },
                  {
                    label: 'Auto-cut silences & fillers',
                    icon: <Scissors />,
                    onSelect: () => {
                      const t = toast.loading('Cutting silences & filler words…');
                      api
                        .runTool(projectId, 'auto_cut', { assetId: asset.id })
                        .then((r) => toast.success(r.summary ?? 'Jump cuts applied', { id: t }))
                        .catch((e) => toast.error(errorText(e), { id: t }));
                    },
                  },
                ]
              : []),
            'separator' as const,
            {
              label: 'Delete from project',
              icon: <Trash2 />,
              danger: true,
              onSelect: () => {
                if (confirm(`Delete "${asset.name}"? Clips using it are removed too.`)) void api.deleteAsset(projectId, asset.id).catch((e) => toast.error(errorText(e)));
              },
            },
          ]}
        />
      </div>
    </div>
  );
};

const AssetDetails: React.FC<{ asset: Asset }> = ({ asset }) => {
  const edit = useStudio((s) => s.editSoon);
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-black/20 px-3 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted">{kindIcon(asset, 'size-4')}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{asset.name}</span>
        <Badge>{asset.origin}</Badge>
      </div>
      <div className="text-dim">
        {[asset.meta.width && `${asset.meta.width}×${asset.meta.height}`, asset.meta.duration && formatClock(asset.meta.duration), asset.meta.fps && `${Math.round(asset.meta.fps)}fps`, formatBytes(asset.size)].filter(Boolean).join(' · ')}
      </div>
      <TextArea value={asset.description ?? ''} onChange={(v) => edit(`asset:${asset.id}`, { op: 'updateAsset', assetId: asset.id, patch: { description: v } }, 'Describe asset')} placeholder="Describe what this shows (helps the Director use it)…" rows={2} />
      {asset.transcript.preview && <div className="line-clamp-3 italic text-muted">“{asset.transcript.preview}”</div>}
      {asset.text?.preview && <div className="line-clamp-3 text-muted">{asset.text.preview}</div>}
      {asset.source?.author && (
        <div className="text-dim">
          {asset.source.provider} · {asset.source.author} · {asset.source.license}
        </div>
      )}
      {asset.error && <div className="text-danger">{asset.error}</div>}
    </div>
  );
};

const ProjectMedia: React.FC = () => {
  const assets = useStudio((s) => s.project?.assets ?? []);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const { upload, progress } = useUpload();
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectId = useStudio((s) => s.projectId)!;

  const list = assets.filter((a) => filter === 'all' || a.kind === filter || (filter === 'document' && a.kind === 'other')).slice().reverse();
  const sel = assets.find((a) => a.id === selected);

  const importUrl = () => {
    const url = prompt('Paste a direct link to a video, image, audio file or document:');
    if (!url) return;
    const t = toast.loading('Downloading…');
    api
      .importUrl(projectId, url)
      .then(() => toast.success('Imported', { id: t }))
      .catch((e) => toast.error(errorText(e), { id: t }));
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="flex gap-1.5 px-3 pt-3">
        <button className="btn btn-primary flex-1" onClick={() => fileInput.current?.click()} disabled={progress !== null}>
          {progress !== null ? <Spinner /> : <Upload className="size-4" />}
          {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Upload'}
        </button>
        <button className="btn btn-icon" title="Import from URL" onClick={importUrl}>
          <Link2 className="size-4" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept="video/*,audio/*,image/*,.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.srt,.vtt,.html,.htm,.xml,.yaml,.yml,.rtf"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1 px-3 py-2">
        {(['all', 'video', 'image', 'audio', 'document'] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn('chip capitalize transition-colors hover:text-text', filter === f && 'bg-accent/20 text-accent-ink ring-1 ring-accent/30')}>
            {f === 'document' ? 'docs' : f}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {list.length === 0 ? (
          <Empty icon={<Upload className="size-7" />} title={assets.length ? 'Nothing here' : 'Add your material'}>
            Drop footage, photos, logos, music, PDFs or notes here. The Director can analyze, transcribe and use all of it.
          </Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {list.map((a) => (
              <AssetCard key={a.id} asset={a} selected={a.id === selected} onSelect={() => setSelected(a.id === selected ? null : a.id)} />
            ))}
          </div>
        )}
      </div>
      {sel && <AssetDetails asset={sel} />}
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 text-sm font-semibold text-[#c9bcff]">Drop files to upload</div>
      )}
    </div>
  );
};

const StockBrowser: React.FC = () => {
  const projectId = useStudio((s) => s.projectId)!;
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'video' | 'image'>('video');
  const [results, setResults] = useState<StockResult[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<Record<string, boolean>>({});

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await api.stockSearch(projectId, query.trim(), type);
      setResults(r.results);
      setErrors(r.errors);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const importOne = async (r: StockResult) => {
    setImporting((m) => ({ ...m, [r.id]: true }));
    try {
      await api.runTool(projectId, 'import_stock', { ids: [r.id] });
      toast.success('Added to project media');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setImporting((m) => ({ ...m, [r.id]: false }));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 p-3">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. city timelapse night" />
          <button className="btn btn-icon" disabled={busy} aria-label="Search">
            {busy ? <Spinner /> : <Search className="size-4" />}
          </button>
        </form>
        <Segmented
          size="sm"
          value={type}
          onChange={setType}
          options={[
            { value: 'video', label: 'Videos' },
            { value: 'image', label: 'Photos' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {errors.length > 0 && <div className="mb-2 rounded-md bg-warn/10 px-2 py-1.5 text-[11px] text-warn">{errors.join(' · ')}</div>}
        {results === null ? (
          <Empty icon={<Search className="size-7" />} title="Free stock footage">
            Search Pexels, Pixabay and Openverse. Add Pexels/Pixabay keys in Settings → Media for video results.
          </Empty>
        ) : results.length === 0 ? (
          <Empty title="No results">Try a more visual description.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {results.map((r) => (
              <div key={r.id} className="group relative overflow-hidden rounded-lg border border-line bg-panel-2">
                <img src={r.thumb} alt={r.description ?? ''} className="aspect-video w-full object-cover" loading="lazy" />
                {r.duration ? <span className="absolute bottom-6 right-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">{formatClock(r.duration)}</span> : null}
                <div className="truncate px-1.5 py-1 text-[10px] text-dim" title={`${r.author ?? ''} · ${r.license}`}>
                  {r.provider} · {r.author ?? 'unknown'}
                </div>
                <button
                  className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => void importOne(r)}
                  disabled={importing[r.id]}
                >
                  {importing[r.id] ? <Spinner /> : '+ Add to project'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const AiImage: React.FC = () => {
  const projectId = useStudio((s) => s.projectId)!;
  const portrait = useStudio((s) => (s.project ? s.project.canvas.height > s.project.canvas.width : false));
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>(portrait ? '9:16' : '16:9');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.runTool(projectId, 'generate_image', { prompt, aspect });
      setLast(r.imageUrls[0] ?? null);
      toast.success('Image added to project media');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 p-3">
      <TextArea value={prompt} onChange={setPrompt} rows={5} placeholder="Describe the image: subject, style, lighting, composition. Avoid text in the image." />
      <Segmented
        size="sm"
        value={aspect}
        onChange={setAspect}
        options={[
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
          { value: '1:1', label: '1:1' },
        ]}
      />
      <button className="btn btn-primary" disabled={busy || prompt.trim().length < 10} onClick={() => void run()}>
        {busy ? <Spinner /> : <WandSparkles className="size-4" />}
        Generate image
      </button>
      <p className="text-[11px] leading-snug text-dim">Uses OpenAI (gpt-image) or Gemini, whichever key you configured. Each image is billed by the provider.</p>
      {last && <img src={last} alt="" className="rounded-lg border border-line" />}
    </div>
  );
};

export const MediaPanel: React.FC = () => {
  const [source, setSource] = useState<Source>('project');
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Media">
        <Segmented
          size="sm"
          value={source}
          onChange={setSource}
          options={[
            { value: 'project', label: 'Project' },
            { value: 'stock', label: 'Stock' },
            { value: 'ai', label: <ImagePlus className="size-3.5" />, title: 'AI image' },
          ]}
        />
      </PanelHeader>
      {source === 'project' ? <ProjectMedia /> : source === 'stock' ? <StockBrowser /> : <AiImage />}
    </div>
  );
};

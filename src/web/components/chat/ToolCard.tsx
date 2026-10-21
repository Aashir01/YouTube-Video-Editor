import React, { useState } from 'react';
import {
  Brain,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clapperboard,
  CodeXml,
  Eye,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  LayoutTemplate,
  ListChecks,
  Mic,
  Music,
  Palette,
  Captions,
  Scissors,
  ScrollText,
  Search,
  Sparkles,
  Upload,
  Users,
  Wrench,
} from 'lucide-react';
import type { ChatMessage } from '../../../shared/agent-types';
import { cn } from '../../lib/utils';
import { Modal, Spinner } from '../ui';
import { YouTubeIcon } from '../icons';

export type ToolMsg = Extract<ChatMessage, { role: 'tool' }>;

const TOOL_META: Record<string, { label: string; running: string; icon: React.ElementType }> = {
  get_project: { label: 'Read the project', running: 'Reading the project', icon: FileText },
  get_timeline: { label: 'Read the timeline', running: 'Reading the timeline', icon: Clapperboard },
  inspect_assets: { label: 'Inspected media', running: 'Inspecting media', icon: Film },
  view_media: { label: 'Looked at media', running: 'Looking at media', icon: Eye },
  analyze_media: { label: 'Analyzed media', running: 'Analyzing media', icon: Film },
  transcribe: { label: 'Transcribed speech', running: 'Transcribing speech', icon: Captions },
  get_transcript: { label: 'Read the transcript', running: 'Reading the transcript', icon: Captions },
  search_transcript: { label: 'Searched the transcript', running: 'Searching the transcript', icon: Search },
  read_document: { label: 'Read a document', running: 'Reading a document', icon: FileText },
  annotate_asset: { label: 'Took notes on media', running: 'Taking notes', icon: FileText },
  web_search: { label: 'Searched the web', running: 'Searching the web', icon: Globe },
  fetch_url: { label: 'Read a web page', running: 'Reading a web page', icon: Globe },
  write_script: { label: 'Wrote the script', running: 'Writing the script', icon: ScrollText },
  list_voices: { label: 'Checked voices', running: 'Checking voices', icon: Mic },
  generate_voiceover: { label: 'Recorded voiceover', running: 'Recording voiceover', icon: Mic },
  search_stock: { label: 'Searched stock footage', running: 'Searching stock footage', icon: Search },
  import_stock: { label: 'Imported stock footage', running: 'Importing stock footage', icon: Film },
  generate_image: { label: 'Generated an image', running: 'Generating an image', icon: ImageIcon },
  generate_audio: { label: 'Generated audio', running: 'Generating audio', icon: Music },
  add_library_sound: { label: 'Added a sound', running: 'Adding a sound', icon: Music },
  list_templates: { label: 'Browsed templates', running: 'Browsing templates', icon: LayoutTemplate },
  add_scene: { label: 'Added a graphic', running: 'Adding a graphic', icon: Sparkles },
  write_code_scene: { label: 'Animated a custom scene', running: 'Coding a custom animation', icon: CodeXml },
  apply_edits: { label: 'Edited the timeline', running: 'Editing the timeline', icon: Scissors },
  add_media: { label: 'Placed media', running: 'Placing media', icon: Film },
  add_captions: { label: 'Added captions', running: 'Adding captions', icon: Captions },
  auto_cut: { label: 'Cut pauses & fillers', running: 'Cutting pauses & fillers', icon: Scissors },
  check_timeline: { label: 'Checked the timeline', running: 'Checking the timeline', icon: ListChecks },
  preview_frames: { label: 'Reviewed frames', running: 'Rendering preview frames', icon: Eye },
  design_thumbnail: { label: 'Designed the thumbnail', running: 'Designing the thumbnail', icon: ImageIcon },
  set_youtube_metadata: { label: 'Wrote title & description', running: 'Writing title & description', icon: YouTubeIcon },
  render_video: { label: 'Rendered the video', running: 'Rendering the video', icon: Clapperboard },
  upload_to_youtube: { label: 'Uploaded to YouTube', running: 'Uploading to YouTube', icon: Upload },
  set_brief: { label: 'Saved the brief', running: 'Saving the brief', icon: FileText },
  set_brand: { label: 'Saved the brand', running: 'Saving the brand', icon: Palette },
  set_canvas: { label: 'Set the format', running: 'Setting the format', icon: Clapperboard },
  load_skill: { label: 'Loaded a playbook', running: 'Loading a playbook', icon: Brain },
  delegate: { label: 'Delegated to a specialist', running: 'Specialist at work', icon: Users },
};

export const toolMeta = (name: string) => {
  if (TOOL_META[name]) return TOOL_META[name]!;
  const external = name.startsWith('mcp__');
  const pretty = (external ? name.split('__').slice(2).join(' ') : name).replace(/_/g, ' ');
  return { label: external ? `${pretty} (${name.split('__')[1]})` : pretty, running: pretty, icon: Wrench };
};

const inputPreview = (m: ToolMsg): string => {
  const i = (m.input ?? {}) as Record<string, unknown>;
  const pick = i.query ?? i.prompt ?? i.skill ?? i.name ?? i.template ?? i.url ?? i.agent ?? i.title ?? i.text;
  if (typeof pick === 'string') return pick.length > 70 ? `${pick.slice(0, 70)}…` : pick;
  return '';
};

const Lightbox: React.FC<{ src: string | null; onClose: () => void }> = ({ src, onClose }) => (
  <Modal open={Boolean(src)} onOpenChange={(o) => !o && onClose()} title="Preview" className="w-[min(1100px,94vw)]">
    {src && <img src={src} alt="" className="mx-auto max-h-[75vh] rounded-lg" />}
  </Modal>
);

export const ToolRow: React.FC<{ m: ToolMsg }> = ({ m }) => {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const meta = toolMeta(m.name);
  const Icon = meta.icon;
  const preview = inputPreview(m);
  return (
    <div className="rounded-lg">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-panel-3">
        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md', m.status === 'error' ? 'bg-danger/15 text-danger' : 'bg-panel-3 text-muted')}>
          {m.status === 'running' ? <Spinner className="size-3" /> : <Icon className="size-3" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className={cn('font-medium', m.status === 'running' ? 'text-text' : 'text-muted')}>{m.status === 'running' ? `${meta.running}…` : meta.label}</span>
          {(m.summary || preview) && <span className="text-dim"> · {m.summary ?? preview}</span>}
        </span>
        {m.status === 'error' && <CircleX className="size-3.5 shrink-0 text-danger" />}
        {m.durationMs !== undefined && m.durationMs > 1500 && <span className="shrink-0 text-[10px] tabular-nums text-dim">{(m.durationMs / 1000).toFixed(1)}s</span>}
        <ChevronRight className={cn('size-3 shrink-0 text-dim transition-transform', open && 'rotate-90')} />
      </button>
      {m.images && m.images.length > 0 && (
        <div className="mb-1 ml-9 mt-1 grid grid-cols-3 gap-1">
          {m.images.slice(0, 9).map((src, i) => (
            <button key={i} onClick={() => setZoom(src)} className="overflow-hidden rounded-md border border-line bg-black">
              <img src={src} alt="" className="aspect-video w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="mb-1 ml-9 mr-1 mt-1 flex flex-col gap-1.5 rounded-lg border border-line bg-bg p-2 font-mono text-[11px] leading-relaxed">
          <div>
            <div className="mb-0.5 font-sans text-[10px] font-bold uppercase tracking-wider text-dim">Input</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted">{JSON.stringify(m.input, null, 2)}</pre>
          </div>
          {m.output && (
            <div>
              <div className="mb-0.5 font-sans text-[10px] font-bold uppercase tracking-wider text-dim">Result</div>
              <pre className={cn('max-h-64 overflow-auto whitespace-pre-wrap break-words', m.status === 'error' ? 'text-danger' : 'text-muted')}>{m.output}</pre>
            </div>
          )}
        </div>
      )}
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  );
};

export const ToolGroup: React.FC<{ tools: ToolMsg[] }> = ({ tools }) => {
  const running = tools.some((t) => t.status === 'running');
  const errors = tools.filter((t) => t.status === 'error').length;
  const [expanded, setExpanded] = useState(false);
  const withImages = tools.filter((t) => t.images?.length);
  const visible = expanded || running || tools.length <= 3 ? tools : [...tools.slice(-2)];
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 py-1">
      {!running && tools.length > 3 && (
        <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] font-semibold text-dim hover:text-muted">
          <CircleCheck className="size-3.5 text-ok" />
          {tools.length} steps{errors ? ` · ${errors} failed` : ''}
          <span className="flex-1" />
          {expanded ? 'Collapse' : `Show all${withImages.length ? ` (${withImages.length} with images)` : ''}`}
        </button>
      )}
      <div className="flex flex-col px-1">
        {visible.map((t) => (
          <ToolRow key={t.id} m={t} />
        ))}
      </div>
    </div>
  );
};

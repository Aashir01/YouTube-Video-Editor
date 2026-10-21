import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Thumbnail } from '@remotion/player';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import type { Clip, CompositionInput, Project } from '../../../../shared/schema';
import { CAPTION_PRESETS } from '../../../../shared/schema';
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateDef } from '../../../../shared/templates';
import { Main } from '../../../../remotion/Main';
import { api } from '../../../lib/api';
import { useStudio } from '../../../lib/store';
import { addAtPlayhead, clearDragPayload, setDragPayload, type DragPayload } from '../../../lib/dnd';
import { cn, errorText } from '../../../lib/utils';
import { PanelHeader } from '../LeftPanel';

const CATEGORY_LABEL: Record<string, string> = {
  titles: 'Titles',
  lists: 'Lists',
  data: 'Data & charts',
  quotes: 'Quotes',
  overlays: 'Overlays',
  'calls-to-action': 'Calls to action',
  explainers: 'Explainers',
  media: 'Media frames',
};

/** Renders one still frame of a clip with the project's brand (lazy: only when scrolled into view). */
const ClipStill: React.FC<{ project: Project; clip: Clip; at: number; background?: string }> = ({ project, clip, at, background }) => {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const { width, height, fps } = project.canvas;
  const input = useMemo<CompositionInput>(
    () => ({
      project: { ...project, canvas: { ...project.canvas, background: background ?? project.canvas.background }, tracks: [{ id: 'preview', name: 'Main', kind: 'video', muted: true, hidden: false, locked: false, clips: [clip] }] },
      assetUrls: {},
      transcripts: {},
      mode: 'still',
    }),
    [project, clip, background],
  );
  return (
    <div ref={box} className="pointer-events-none overflow-hidden bg-[#0b0d12]" style={{ aspectRatio: `${width} / ${height}` }}>
      {visible && (
        <Thumbnail
          component={Main}
          inputProps={input}
          compositionWidth={width}
          compositionHeight={height}
          fps={fps}
          durationInFrames={Math.max(1, Math.ceil(clip.duration * fps))}
          frameToDisplay={Math.min(Math.ceil(clip.duration * fps) - 1, Math.round(at * fps))}
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </div>
  );
};

const Card: React.FC<{ payload: DragPayload; title: string; subtitle?: string; badge?: string; children: React.ReactNode }> = ({ payload, title, subtitle, badge, children }) => (
  <button
    draggable
    onDragStart={(e) => setDragPayload(e, payload)}
    onDragEnd={clearDragPayload}
    onClick={() => void addAtPlayhead(payload)}
    className="group overflow-hidden rounded-lg border border-line bg-panel-2 text-left transition-colors hover:border-accent/70"
    title={subtitle ? `${title} — ${subtitle}` : title}
  >
    <div className="relative">
      {children}
      {badge && <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] font-bold uppercase tracking-wide text-white">{badge}</span>}
      <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">+ Add at playhead</span>
    </div>
    <div className="px-1.5 py-1">
      <div className="truncate text-[11px] font-semibold">{title}</div>
      {subtitle && <div className="line-clamp-2 text-[10px] leading-snug text-dim">{subtitle}</div>}
    </div>
  </button>
);

const sampleCaption = (preset: string, duration: number): Clip =>
  ({
    id: `cap-${preset}`,
    type: 'captions',
    mode: 'manual',
    start: 0,
    duration,
    words: [
      { text: 'This', start: 0, end: 0.3 },
      { text: 'changes', start: 0.3, end: 0.7 },
      { text: 'everything', start: 0.7, end: 1.3 },
      { text: 'for', start: 1.3, end: 1.5 },
      { text: 'you', start: 1.5, end: 1.9 },
    ],
    style: { preset, color: '#FFFFFF', position: 'center', offsetY: 0 },
  }) as unknown as Clip;

export const GraphicsPanel: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const [q, setQ] = useState('');
  // brand + canvas changes refresh previews; timeline edits don't
  const look = useMemo(() => project, [project.brand, project.canvas.width, project.canvas.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const portrait = project.canvas.height > project.canvas.width;
  const cols = portrait ? 'grid-cols-3' : 'grid-cols-2';

  const match = (t: TemplateDef) => !q.trim() || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q.trim().toLowerCase());
  const clips = useMemo(
    () => Object.fromEntries(TEMPLATES.map((t) => [t.id, { id: `tpl-${t.id}`, type: 'scene', template: t.id, start: 0, duration: t.defaultDuration, props: t.example } as unknown as Clip])),
    [],
  );
  const textClips = useMemo(
    () =>
      ({
        title: { id: 'txt-title', type: 'text', text: 'Big *bold* title', start: 0, duration: 3, x: 0.5, y: 0.5, style: { font: 'montserrat', size: 120, weight: 800, color: '#FFFFFF', align: 'center', uppercase: true, italic: false, letterSpacing: 0, lineHeight: 1.1, padding: 24, radius: 16, strokeWidth: 0, shadow: true, maxWidth: 0.85 }, animationIn: 'none', animationOut: 'none', opacity: 1, rotation: 0 },
        lower: { id: 'txt-lower', type: 'text', text: 'Your *name* here', start: 0, duration: 4, x: 0.28, y: 0.82, style: { font: 'inter', size: 54, weight: 700, color: '#FFFFFF', align: 'left', uppercase: false, italic: false, letterSpacing: 0, lineHeight: 1.1, background: 'rgba(0,0,0,0.65)', padding: 24, radius: 16, strokeWidth: 0, shadow: true, maxWidth: 0.85 }, animationIn: 'none', animationOut: 'none', opacity: 1, rotation: 0 },
        box: { id: 'txt-box', type: 'text', text: 'Key point goes *here*', start: 0, duration: 3, x: 0.5, y: 0.5, style: { font: 'montserrat', size: 60, weight: 800, color: '#FFFFFF', align: 'center', uppercase: false, italic: false, letterSpacing: 0, lineHeight: 1.1, background: 'rgba(0,0,0,0.6)', padding: 24, radius: 16, strokeWidth: 0, shadow: true, maxWidth: 0.85 }, animationIn: 'none', animationOut: 'none', opacity: 1, rotation: 0 },
      }) as unknown as Record<string, Clip>,
    [],
  );

  const applyCaptions = (preset: string) => {
    const t = toast.loading('Adding captions…');
    api
      .runTool(project.id, 'add_captions', { style: { preset } })
      .then((r) => toast.success(r.text.includes('WARNING') ? 'Captions added — they appear once speech is transcribed or voiced' : `Captions: ${preset}`, { id: t }))
      .catch((err) => toast.error(errorText(err), { id: t }));
  };

  const BG = '#1b2238';

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Graphics" />
      <div className="px-3 pt-3">
        <label className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-2 focus-within:border-accent">
          <Search className="size-4 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates…" className="w-full bg-transparent py-1.5 outline-none" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {!q && (
          <>
            <h3 className="label mt-4">Text</h3>
            <div className={cn('grid gap-2', cols)}>
              <Card payload={{ kind: 'text', preset: 'title' }} title="Title">
                <ClipStill project={look} clip={textClips.title!} at={1} background="#151a2c" />
              </Card>
              <Card payload={{ kind: 'text', preset: 'lower' }} title="Lower third">
                <ClipStill project={look} clip={textClips.lower!} at={1} background="#151a2c" />
              </Card>
              <Card payload={{ kind: 'text', preset: 'caption-box' }} title="Text box">
                <ClipStill project={look} clip={textClips.box!} at={1} background="#151a2c" />
              </Card>
            </div>
            <h3 className="label mt-5">Captions</h3>
            <p className="mb-2 text-[11px] leading-snug text-dim">Click a style to caption all speech on the timeline. Captions follow your edits automatically.</p>
            <div className={cn('grid gap-2', cols)}>
              {CAPTION_PRESETS.map((preset) => (
                <button key={preset} onClick={() => applyCaptions(preset)} className="overflow-hidden rounded-lg border border-line bg-panel-2 text-left hover:border-accent/70">
                  <ClipStill project={look} clip={sampleCaption(preset, 2)} at={0.85} background="#252a3d" />
                  <div className="truncate px-1.5 py-1 text-[11px] font-semibold capitalize">{preset.replace('-', ' ')}</div>
                </button>
              ))}
            </div>
          </>
        )}
        {TEMPLATE_CATEGORIES.map((cat) => {
          const list = TEMPLATES.filter((t) => t.category === cat && match(t));
          if (!list.length) return null;
          return (
            <section key={cat}>
              <h3 className="label mt-5">{CATEGORY_LABEL[cat] ?? cat}</h3>
              <div className={cn('grid gap-2', cols)}>
                {list.map((t) => (
                  <Card key={t.id} payload={{ kind: 'template', templateId: t.id }} title={t.name} subtitle={t.description} badge={t.overlay ? 'overlay' : undefined}>
                    <ClipStill project={look} clip={clips[t.id]!} at={Math.min(t.defaultDuration * 0.6, 2.2)} background={t.overlay ? BG : undefined} />
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

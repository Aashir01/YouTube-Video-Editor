import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowRight,
  Clapperboard,
  Copy,
  Ellipsis,
  Film,
  KeyRound,
  Monitor,
  Play,
  Scissors,
  Settings,
  Smartphone,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand,
} from 'lucide-react';
import { api, mediaUrl, type ProjectSummary } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { navigate } from '../../lib/nav';
import { cn, errorText, formatClock, timeAgo } from '../../lib/utils';
import { Logo } from '../icons';
import { Badge, Empty, IconBtn, Menu, Segmented, Spinner } from '../ui';

type Format = 'long' | 'short';
type Mode = 'generate' | 'edit' | 'hybrid';

const KICKOFF_KEY = (id: string) => `director:kickoff:${id}`;

/** A first message to send to the Director once the editor opens. */
export const takeKickoff = (projectId: string): string | null => {
  try {
    const v = sessionStorage.getItem(KICKOFF_KEY(projectId));
    sessionStorage.removeItem(KICKOFF_KEY(projectId));
    return v;
  } catch {
    return null;
  }
};

const EXAMPLES: { text: string; format: Format; mode: Mode }[] = [
  { text: 'A 5-minute explainer on how black holes form, with animated diagrams and a calm voiceover', format: 'long', mode: 'generate' },
  { text: 'Edit my talking-head recording: cut silences and filler words, add captions, zooms and b-roll', format: 'long', mode: 'edit' },
  { text: 'A punchy 45-second Short: 3 productivity tips for students', format: 'short', mode: 'generate' },
  { text: 'Turn my notes and screenshots into a product walkthrough video', format: 'long', mode: 'hybrid' },
];

export const Home: React.FC = () => {
  const system = useStudio((s) => s.system);
  const openSettings = useStudio((s) => s.openSettings);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState<Format>('long');
  const [mode, setMode] = useState<Mode>('hybrid');
  const [creating, setCreating] = useState(false);

  const load = () =>
    api
      .projects()
      .then(setProjects)
      .catch((err) => {
        toast.error(errorText(err));
        setProjects([]);
      });

  useEffect(() => {
    document.title = 'Director Studio';
    void load();
  }, []);

  const create = async (opts: { demo?: boolean } = {}) => {
    setCreating(true);
    try {
      const text = topic.trim();
      const name = opts.demo ? '' : text ? text.split(/[.\n]/)[0]!.slice(0, 60) : 'Untitled video';
      const p = await api.createProject({ name: opts.demo ? (format === 'short' ? 'Demo Short' : 'Demo: Why Sleep Matters') : name, format, mode, topic: text, demo: opts.demo });
      if (text && !opts.demo) {
        const modeLine = mode === 'edit' ? 'I want to edit my own footage.' : mode === 'generate' ? 'Create it from the topic (voiceover, graphics, stock footage).' : 'Combine my material with generated graphics/voiceover as needed.';
        try {
          sessionStorage.setItem(KICKOFF_KEY(p.id), `${text}\n\nFormat: ${format === 'short' ? 'YouTube Short (9:16)' : 'long-form YouTube video (16:9)'}. ${modeLine}`);
        } catch {
          /* ignore */
        }
      }
      navigate(p.id);
    } catch (err) {
      toast.error(errorText(err));
      setCreating(false);
    }
  };

  const noLlm = system && !system.llm;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/85 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <Logo className="size-7" />
          <span className="text-[15px] font-bold tracking-tight">Director Studio</span>
          <Badge tone="accent">AI video editor</Badge>
        </div>
        <IconBtn label="Settings" onClick={() => openSettings()}>
          <Settings className="size-4.5" />
        </IconBtn>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-16">
        {noLlm && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3">
            <KeyRound className="size-5 text-[#b9a8ff]" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Connect an AI model to unlock the Director</div>
              <div className="text-xs text-muted">Works with OpenAI, Google Gemini, Anthropic Claude, OpenRouter, Groq, DeepSeek, Ollama/LM Studio or any OpenAI-compatible API. You can still edit manually without one.</div>
            </div>
            <button className="btn btn-primary" onClick={() => openSettings('models')}>
              Add API key
            </button>
          </div>
        )}
        {system && !system.ffmpeg.available && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-xs">
            <TriangleAlert className="size-4 text-warn" />
            FFmpeg was not found. Install it (see README) for media analysis, silence detection and audio normalization.
          </div>
        )}

        <section className="pt-12 pb-10">
          <h1 className="text-center text-3xl font-extrabold tracking-tight md:text-4xl">
            What are we making{' '}
            <span className="bg-gradient-to-r from-[#a48bff] to-accent-2 bg-clip-text text-transparent">today</span>?
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted">
            Describe your video. The Director asks what it needs, collects your footage and files, then scripts, edits, animates, captions and packages it for YouTube.
          </p>

          <div className="mx-auto mt-7 max-w-3xl rounded-2xl border border-line bg-panel p-3 shadow-2xl shadow-accent/5 focus-within:border-accent/60">
            <textarea
              value={topic}
              autoFocus
              rows={3}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create();
              }}
              placeholder="e.g. A 6-minute video explaining how compound interest works, for beginners, with charts and a friendly tone…"
              className="w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-dim"
            />
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Segmented
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'long', label: <><Monitor className="size-3.5" /> Video 16:9</> },
                  { value: 'short', label: <><Smartphone className="size-3.5" /> Short 9:16</> },
                ]}
              />
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'generate', label: <><Wand className="size-3.5" /> From topic</>, title: 'Script, voiceover, graphics and stock footage generated from your topic' },
                  { value: 'edit', label: <><Scissors className="size-3.5" /> Edit footage</>, title: 'Cut, caption and polish footage you upload' },
                  { value: 'hybrid', label: <><Sparkles className="size-3.5" /> Both</>, title: 'Your material plus generated graphics and voiceover' },
                ]}
              />
              <div className="flex-1" />
              <button className="btn btn-primary px-4" disabled={creating} onClick={() => void create()}>
                {creating ? <Spinner /> : <ArrowRight className="size-4" />}
                {topic.trim() ? 'Start creating' : 'Blank project'}
              </button>
            </div>
          </div>

          <div className="mx-auto mt-4 flex max-w-3xl flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.text}
                onClick={() => {
                  setTopic(ex.text);
                  setFormat(ex.format);
                  setMode(ex.mode);
                }}
                className="max-w-[340px] truncate rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted transition-colors hover:border-line-2 hover:text-text"
                title={ex.text}
              >
                {ex.text}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Your videos</h2>
            <button className="btn btn-sm" onClick={() => void create({ demo: true })} disabled={creating}>
              <Play className="size-3.5" /> Open a demo project
            </button>
          </div>
          {projects === null ? (
            <div className="flex justify-center py-12">
              <Spinner className="size-6 text-dim" />
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line">
              <Empty icon={<Clapperboard className="size-8" />} title="No videos yet">
                Describe a video above to start, or open the demo project to explore the editor.
              </Empty>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
              {projects.map((p) => (
                <ProjectCard key={p.id} p={p} onChanged={load} />
              ))}
            </div>
          )}
        </section>

        {system && <SystemStrip />}
      </main>
    </div>
  );
};

const ProjectCard: React.FC<{ p: ProjectSummary; onChanged: () => void }> = ({ p, onChanged }) => {
  const portrait = p.height > p.width;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-line-2">
      <button className="block w-full text-left" onClick={() => navigate(p.id)}>
        <div className="relative aspect-video overflow-hidden bg-panel-2">
          {p.thumb ? (
            <img src={mediaUrl(p.id, p.thumb)} alt="" className={cn('size-full', portrait ? 'object-contain' : 'object-cover')} loading="lazy" />
          ) : (
            <div className="flex size-full items-center justify-center bg-gradient-to-br from-accent/20 via-panel-2 to-accent-2/10">
              <Film className="size-8 text-dim" />
            </div>
          )}
          <div className="absolute bottom-2 left-2 flex gap-1">
            <Badge className="bg-black/70 text-white">{portrait ? 'Short' : '16:9'}</Badge>
            {p.duration > 0 && <Badge className="bg-black/70 text-white">{formatClock(p.duration)}</Badge>}
          </div>
        </div>
        <div className="px-3 py-2.5">
          <div className="truncate font-semibold">{p.name}</div>
          <div className="mt-0.5 truncate text-xs text-dim">
            {timeAgo(p.updatedAt)} · {p.assetCount} asset{p.assetCount === 1 ? '' : 's'}
            {p.topic ? ` · ${p.topic}` : ''}
          </div>
        </div>
      </button>
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
        <Menu
          trigger={
            <button className="btn btn-icon border-transparent bg-black/60 text-white hover:bg-black/80" aria-label="Project menu">
              <Ellipsis className="size-4" />
            </button>
          }
          items={[
            { label: 'Open', icon: <Play />, onSelect: () => navigate(p.id) },
            {
              label: 'Duplicate',
              icon: <Copy />,
              onSelect: () =>
                void api
                  .duplicateProject(p.id)
                  .then(onChanged)
                  .catch((e) => toast.error(errorText(e))),
            },
            'separator',
            {
              label: 'Delete',
              icon: <Trash2 />,
              danger: true,
              onSelect: () => {
                if (!confirm(`Delete "${p.name}" and all its media? This cannot be undone.`)) return;
                void api
                  .deleteProject(p.id)
                  .then(onChanged)
                  .catch((e) => toast.error(errorText(e)));
              },
            },
          ]}
        />
      </div>
    </div>
  );
};

const SystemStrip: React.FC = () => {
  const system = useStudio((s) => s.system)!;
  const openSettings = useStudio((s) => s.openSettings);
  const items: { label: string; value: string; ok: boolean; section: Parameters<typeof openSettings>[0] }[] = [
    { label: 'AI model', value: system.llm ? system.llm.model : 'not configured', ok: Boolean(system.llm), section: 'models' },
    { label: 'Transcription', value: system.transcription ?? 'not available', ok: Boolean(system.transcription), section: 'speech' },
    { label: 'Voiceover', value: system.tts ?? 'not available', ok: Boolean(system.tts), section: 'speech' },
    { label: 'FFmpeg', value: system.ffmpeg.available ? (system.ffmpeg.full ? system.ffmpeg.source : `${system.ffmpeg.source} (limited)`) : 'missing', ok: system.ffmpeg.available, section: 'render' },
  ];
  return (
    <div className="mt-12 flex flex-wrap justify-center gap-2">
      {items.map((i) => (
        <button key={i.label} onClick={() => openSettings(i.section)} className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs hover:border-line-2">
          <span className={cn('size-1.5 rounded-full', i.ok ? 'bg-ok' : 'bg-warn')} />
          <span className="text-dim">{i.label}</span>
          <span className="max-w-[220px] truncate text-muted">{i.value}</span>
        </button>
      ))}
    </div>
  );
};

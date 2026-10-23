import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowRight,
  AudioLines,
  Bot,
  Captions,
  Clapperboard,
  Copy,
  Ellipsis,
  FileText,
  Film,
  KeyRound,
  Mic,
  Monitor,
  Music,
  Play,
  Scissors,
  ScrollText,
  Settings,
  Smartphone,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  Wand,
} from 'lucide-react';
import { api, mediaUrl, type ProjectSummary } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { navigate } from '../../lib/nav';
import { cn, errorText, formatClock, timeAgo } from '../../lib/utils';
import { Logo } from '../icons';
import { Empty, IconBtn, Menu, Segmented, Spinner } from '../ui';

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

const EXAMPLES: { text: string; format: Format; mode: Mode; icon: React.ElementType; hue: string }[] = [
  { text: 'A 5-minute explainer on how black holes form, with animated diagrams and a calm voiceover', format: 'long', mode: 'generate', icon: Sparkles, hue: 'text-hue-violet' },
  { text: 'Edit my talking-head recording: cut silences and filler words, add captions, zooms and b-roll', format: 'long', mode: 'edit', icon: Scissors, hue: 'text-hue-ember' },
  { text: 'A punchy 45-second Short: 3 productivity tips for students', format: 'short', mode: 'generate', icon: Smartphone, hue: 'text-hue-pink' },
  { text: 'Turn my notes and screenshots into a product walkthrough video', format: 'long', mode: 'hybrid', icon: FileText, hue: 'text-hue-mint' },
];

/** The stages the Director works through, shown under the prompt. */
const PIPELINE: { label: string; icon: React.ElementType; hue: string }[] = [
  { label: 'Script', icon: ScrollText, hue: 'text-hue-amber' },
  { label: 'Voice', icon: Mic, hue: 'text-hue-green' },
  { label: 'Motion', icon: Sparkles, hue: 'text-hue-violet' },
  { label: 'B-roll', icon: Film, hue: 'text-hue-sky' },
  { label: 'Captions', icon: Captions, hue: 'text-hue-yellow' },
  { label: 'Music', icon: Music, hue: 'text-hue-pink' },
  { label: 'Publish', icon: Upload, hue: 'text-hue-ember' },
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
    document.title = 'Cutroom';
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
    <div className="relative flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-[#05060a]/35 px-6 py-3 backdrop-blur-2xl">
        <div className="flex items-center gap-2.5">
          <Logo className="size-8 drop-shadow-[0_4px_14px_rgb(255_90_31/0.35)]" />
          <span className="text-[17px] font-semibold tracking-[-0.02em]">Cutroom</span>
          <span className="ml-1 rounded-md border border-line-2 bg-panel-2/80 px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-wider text-muted">Studio</span>
        </div>
        <IconBtn label="Settings" onClick={() => openSettings()}>
          <Settings className="size-4.5" />
        </IconBtn>
      </header>

      <main className="relative mx-auto w-full max-w-6xl flex-1 px-6 pb-16">
        {noLlm && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3">
            <span className="tile size-9 text-accent">
              <KeyRound className="size-4.5" />
            </span>
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
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-xs">
            <TriangleAlert className="size-4 text-warn" />
            FFmpeg was not found. Install it (see README) for media analysis, silence detection and audio normalization.
          </div>
        )}

        <section className="pt-14 pb-12">
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel/70 py-1 pl-1 pr-3 text-xs text-muted backdrop-blur">
              <span className="tile size-5 rounded-full text-accent-2">
                <Bot className="size-3" />
              </span>
              Your editing room, with a Director on call
            </span>
          </div>
          <h1 className="mt-5 text-center text-4xl font-extrabold tracking-[-0.035em] md:text-[52px] md:leading-[1.05]">
            What are we <span className="text-gradient">cutting</span> today?
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-center text-[15px] leading-relaxed text-muted">
            Describe your video. The Director asks what it needs, collects your footage and files, then scripts, edits, animates, captions and packages it for YouTube.
          </p>

          <div className="relative mx-auto mt-8 max-w-3xl">
            <div className="pointer-events-none absolute -inset-6 rounded-[32px] bg-[radial-gradient(60%_60%_at_50%_50%,rgb(255_90_31/0.14),transparent_70%)] blur-xl" />
            <div className="glass ring-gradient relative rounded-2xl border-transparent p-3 shadow-[0_30px_90px_-24px_rgb(0_0_0/0.9)]">
              <textarea
                value={topic}
                autoFocus
                rows={3}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create();
                }}
                placeholder="e.g. A 6-minute video explaining how compound interest works, for beginners, with charts and a friendly tone…"
                className="w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-dim focus-visible:outline-none"
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
                <span className="hidden text-[11px] text-dim md:inline">Ctrl ↵</span>
                <button className="btn btn-primary px-4" disabled={creating} onClick={() => void create()}>
                  {creating ? <Spinner /> : <ArrowRight className="size-4" />}
                  {topic.trim() ? 'Start creating' : 'Blank project'}
                </button>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-5 grid max-w-3xl gap-2 sm:grid-cols-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.text}
                onClick={() => {
                  setTopic(ex.text);
                  setFormat(ex.format);
                  setMode(ex.mode);
                }}
                className="glass group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs text-muted transition-all hover:-translate-y-px hover:border-white/20 hover:text-text"
                title={ex.text}
              >
                <span className={cn('tile size-7', ex.hue)}>
                  <ex.icon className="size-3.5" />
                </span>
                <span className="line-clamp-2 leading-snug">{ex.text}</span>
              </button>
            ))}
          </div>

          <div className="mx-auto mt-7 flex max-w-3xl flex-wrap items-center justify-center gap-x-1 gap-y-2">
            {PIPELINE.map((step, i) => (
              <React.Fragment key={step.label}>
                {i > 0 && <span className="h-px w-4 bg-gradient-to-r from-line to-line-2" />}
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                  <span className={cn('tile size-6 rounded-md', step.hue)}>
                    <step.icon className="size-3" />
                  </span>
                  {step.label}
                </span>
              </React.Fragment>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight">
              <span className="tile size-7 text-hue-sky">
                <Clapperboard className="size-3.5" />
              </span>
              Your videos
              {projects && projects.length > 0 && <span className="rounded-full bg-panel-3 px-2 py-px text-[11px] font-semibold text-muted">{projects.length}</span>}
            </h2>
            <button className="btn btn-sm" onClick={() => void create({ demo: true })} disabled={creating}>
              <Play className="size-3.5 text-accent" fill="currentColor" /> Open a demo project
            </button>
          </div>
          {projects === null ? (
            <div className="flex justify-center py-12">
              <Spinner className="size-6 text-dim" />
            </div>
          ) : projects.length === 0 ? (
            <div className="glass rounded-2xl border-dashed">
              <Empty icon={<Clapperboard className="size-6" />} title="No videos yet">
                Describe a video above to start, or open the demo project to explore the editor.
              </Empty>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
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

/** Two-color washes for projects without a thumbnail, picked from the project id. */
const COVERS = [
  ['#ff5a1f', '#8b7bff'],
  ['#38bdf8', '#2dd4bf'],
  ['#f472b6', '#8b7bff'],
  ['#fbbf24', '#ff5a1f'],
  ['#34d399', '#38bdf8'],
];
const coverFor = (id: string) => COVERS[[...id].reduce((h, c) => h + c.charCodeAt(0), 0) % COVERS.length]!;

const ProjectCard: React.FC<{ p: ProjectSummary; onChanged: () => void }> = ({ p, onChanged }) => {
  const portrait = p.height > p.width;
  const [c1, c2] = coverFor(p.id);
  return (
    <div className="glass group relative overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_18px_50px_-20px_rgb(255_90_31/0.45)]">
      <button className="block w-full text-left" onClick={() => navigate(p.id)}>
        <div className="relative aspect-video overflow-hidden" style={{ background: `radial-gradient(120% 120% at 0% 0%, ${c1}40, transparent 60%), radial-gradient(120% 120% at 100% 100%, ${c2}40, transparent 60%), rgb(0 0 0 / 0.35)` }}>
          {p.thumb ? (
            <>
              {portrait && <img src={mediaUrl(p.id, p.thumb)} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-2xl" loading="lazy" />}
              <img src={mediaUrl(p.id, p.thumb)} alt="" className={cn('relative size-full transition-transform duration-300 group-hover:scale-[1.03]', portrait ? 'object-contain' : 'object-cover')} loading="lazy" />
            </>
          ) : (
            <div className="flex size-full items-center justify-center">
              <span className="tile size-12 rounded-2xl text-white/80">
                <Film className="size-5" />
              </span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-2 left-2 flex gap-1">
            <span className={cn('chip backdrop-blur', portrait ? 'bg-hue-pink/25 text-[#ffc4e3]' : 'bg-hue-sky/25 text-[#bfe9ff]')}>
              {portrait ? <Smartphone className="size-3" /> : <Monitor className="size-3" />}
              {portrait ? 'Short' : '16:9'}
            </span>
            {p.duration > 0 && <span className="chip bg-black/60 font-mono text-white backdrop-blur">{formatClock(p.duration)}</span>}
          </div>
          <span className="absolute inset-0 m-auto flex size-11 scale-90 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-[0_8px_30px_-6px_rgb(255_90_31/0.9)] transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
            <Play className="size-4.5 translate-x-px" fill="currentColor" />
          </span>
        </div>
        <div className="border-t border-line px-3.5 py-3">
          <div className="truncate font-semibold">{p.name}</div>
          <div className="mt-1 flex items-center gap-1.5 truncate text-xs text-dim">
            <span>{timeAgo(p.updatedAt)}</span>
            <span className="size-0.5 rounded-full bg-dim" />
            <span>
              {p.assetCount} asset{p.assetCount === 1 ? '' : 's'}
            </span>
            {p.topic && (
              <>
                <span className="size-0.5 rounded-full bg-dim" />
                <span className="truncate">{p.topic}</span>
              </>
            )}
          </div>
        </div>
      </button>
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
        <Menu
          trigger={
            <button className="btn btn-icon border-transparent bg-black/60 text-white backdrop-blur hover:bg-black/80" aria-label="Project menu">
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
  const items: { label: string; value: string; ok: boolean; section: Parameters<typeof openSettings>[0]; icon: React.ElementType; hue: string }[] = [
    { label: 'AI model', value: system.llm ? system.llm.model : 'not configured', ok: Boolean(system.llm), section: 'models', icon: Bot, hue: 'text-hue-violet' },
    { label: 'Transcription', value: system.transcription ?? 'not available', ok: Boolean(system.transcription), section: 'speech', icon: AudioLines, hue: 'text-hue-mint' },
    { label: 'Voiceover', value: system.tts ?? 'not available', ok: Boolean(system.tts), section: 'speech', icon: Mic, hue: 'text-hue-green' },
    { label: 'FFmpeg', value: system.ffmpeg.available ? (system.ffmpeg.full ? system.ffmpeg.source : `${system.ffmpeg.source} (limited)`) : 'missing', ok: system.ffmpeg.available, section: 'render', icon: Film, hue: 'text-hue-sky' },
  ];
  return (
    <div className="mt-14">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-dim">Studio status</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <button key={i.label} onClick={() => openSettings(i.section)} className="glass flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:border-white/20">
            <span className={cn('tile size-8', i.hue)}>
              <i.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[11px] text-dim">
                {i.label}
                <span className={cn('size-1.5 rounded-full', i.ok ? 'bg-ok shadow-[0_0_6px_rgb(34_211_154/0.9)]' : 'bg-warn')} />
              </span>
              <span className="block truncate text-xs font-semibold text-text">{i.value}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

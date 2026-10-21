import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CirclePlus, Mic, Pause, Play } from 'lucide-react';
import { api, librarySoundUrl, type LibrarySound } from '../../../lib/api';
import { useStudio } from '../../../lib/store';
import { addAtPlayhead, clearDragPayload, setDragPayload } from '../../../lib/dnd';
import { errorText } from '../../../lib/utils';
import { Field, NumberField, RangeField, Section, SelectField, Spinner, Switch, TextArea } from '../../ui';
import { PanelHeader } from '../LeftPanel';

type VoiceList = Awaited<ReturnType<typeof api.voices>>;

let previewAudio: HTMLAudioElement | null = null;

const SoundRow: React.FC<{ s: LibrarySound; playing: boolean; onPlay: () => void }> = ({ s, playing, onPlay }) => (
  <div
    draggable
    onDragStart={(e) => setDragPayload(e, { kind: 'sound', soundId: s.id, soundKind: s.kind })}
    onDragEnd={clearDragPayload}
    className="group flex cursor-grab items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-panel-2"
  >
    <button onClick={onPlay} className="flex size-7 shrink-0 items-center justify-center rounded-full bg-panel-3 text-muted hover:text-text" aria-label={playing ? 'Stop preview' : 'Play preview'}>
      {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
    </button>
    <div className="min-w-0 flex-1">
      <div className="truncate text-xs font-semibold">{s.name}</div>
      <div className="truncate text-[10px] text-dim">{s.description}</div>
    </div>
    <button className="rounded p-1 text-dim opacity-0 hover:text-text group-hover:opacity-100" title="Add at playhead" onClick={() => void addAtPlayhead({ kind: 'sound', soundId: s.id, soundKind: s.kind })}>
      <CirclePlus className="size-4" />
    </button>
  </div>
);

const Voiceover: React.FC = () => {
  const projectId = useStudio((s) => s.projectId)!;
  const system = useStudio((s) => s.system);
  const [voices, setVoices] = useState<VoiceList | null>(null);
  const [engine, setEngine] = useState('');
  const [voice, setVoice] = useState('');
  const [style, setStyle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .voices()
      .then((v) => {
        setVoices(v);
        if (v[0]) {
          setEngine(v[0].engine);
          setVoice(v[0].default);
        }
      })
      .catch(() => setVoices([]));
  }, []);

  const current = voices?.find((v) => v.engine === engine);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.runTool(projectId, 'generate_voiceover', { text, engine: engine || undefined, voice: voice || undefined, style: style || undefined });
      toast.success(r.summary ? `Voiceover placed (${r.summary})` : 'Voiceover placed on the timeline');
      setText('');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (voices && voices.length === 0) {
    return <p className="text-xs leading-relaxed text-muted">No voice engine available. Add an ElevenLabs, OpenAI or Gemini key in Settings → Voice, or install the free local Kokoro voice (see README).</p>;
  }
  return (
    <>
      <TextArea value={text} onChange={setText} rows={4} placeholder="Type narration to voice. It's placed at the end of the Voiceover track with word timings for captions." />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Engine">
          <SelectField
            value={engine}
            onChange={(v) => {
              setEngine(v);
              setVoice(voices?.find((x) => x.engine === v)?.default ?? '');
            }}
            options={(voices ?? []).map((v) => ({ value: v.engine, label: v.label }))}
          />
        </Field>
        <Field label="Voice">
          <SelectField value={voice} onChange={setVoice} options={(current?.voices ?? []).map((v) => ({ value: v.id, label: v.name + (v.accent ? ` (${v.accent})` : '') }))} />
        </Field>
      </div>
      <Field label="Delivery (optional)">
        <input className="field" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. warm and energetic" />
      </Field>
      <button className="btn btn-primary" disabled={busy || !text.trim() || !voices} onClick={() => void run()}>
        {busy ? <Spinner /> : <Mic className="size-4" />}
        Generate voiceover
      </button>
      {system?.tts && <p className="text-[11px] text-dim">Default engine: {system.tts}</p>}
    </>
  );
};

export const AudioPanel: React.FC = () => {
  const audio = useStudio((s) => s.project!.audio);
  const editSoon = useStudio((s) => s.editSoon);
  const [library, setLibrary] = useState<LibrarySound[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    api.library().then(setLibrary).catch(() => undefined);
    return () => {
      mounted.current = false;
      previewAudio?.pause();
    };
  }, []);

  const play = (id: string) => {
    previewAudio?.pause();
    if (playing === id) return setPlaying(null);
    previewAudio = new Audio(librarySoundUrl(id));
    previewAudio.onended = () => mounted.current && setPlaying(null);
    void previewAudio.play().catch(() => setPlaying(null));
    setPlaying(id);
  };

  const mix = (patch: Record<string, unknown>) => editSoon('audio-mix', { op: 'setAudioMix', patch }, 'Audio mix');

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Audio" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="AI voiceover">
          <Voiceover />
        </Section>
        <Section title="Music">
          <div className="-mx-1.5 flex flex-col">
            {library
              .filter((s) => s.kind === 'music')
              .map((s) => (
                <SoundRow key={s.id} s={s} playing={playing === s.id} onPlay={() => play(s.id)} />
              ))}
          </div>
          <p className="text-[11px] leading-snug text-dim">Royalty-free beds generated on your machine. Upload your own tracks in Media.</p>
        </Section>
        <Section title="Sound effects">
          <div className="-mx-1.5 flex flex-col">
            {library
              .filter((s) => s.kind === 'sfx')
              .map((s) => (
                <SoundRow key={s.id} s={s} playing={playing === s.id} onPlay={() => play(s.id)} />
              ))}
          </div>
        </Section>
        <Section title="Mix">
          <RangeField label="Music under speech" value={audio.duckLevel} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => mix({ duckLevel: v })} />
          <Switch label="Normalize loudness on export" checked={audio.normalize} onChange={(v) => mix({ normalize: v })} />
          <Field label="Loudness target" hint="YouTube plays back at about −14 LUFS.">
            <NumberField value={audio.loudnessTarget} min={-30} max={-8} step={0.5} unit="LUFS" precision={1} onChange={(v) => mix({ loudnessTarget: v })} />
          </Field>
        </Section>
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Captions, CircleCheck, Download, Languages, Mic, Plus, X } from 'lucide-react';
import { LANGUAGES, language, missingCounts, subtitleSource } from '../../../shared/subtitles';
import { api, subtitlesUrl } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { navigate } from '../../lib/nav';
import { cn, errorText } from '../../lib/utils';
import { Segmented, SelectField, Spinner, Switch, Tip } from '../ui';

/**
 * Subtitles in other languages: the AI translates the captions sentence by sentence and they stay
 * in sync with later edits (only new sentences get translated). Each language can be downloaded,
 * shown in the captions, sent to YouTube with the next upload, or turned into a dubbed version.
 */
export const LanguagesPanel: React.FC = () => {
  const project = useStudio((s) => s.project!);
  const transcripts = useStudio((s) => s.transcripts);
  const state = useStudio((s) => s.translations);
  const hasModel = useStudio((s) => s.system?.llm !== null);
  const edit = useStudio((s) => s.edit);
  const [adding, setAdding] = useState('');
  const [metadata, setMetadata] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [dubbing, setDubbing] = useState<string | null>(null);
  const [original, setOriginal] = useState<'duck' | 'mute'>('duck');

  const captions = project.tracks.flatMap((t) => t.clips).find((c) => c.type === 'captions');
  const words = useMemo(() => subtitleSource(project, transcripts), [project, transcripts]);
  const missing = useMemo(() => missingCounts(words, state), [words, state]);
  const languages = state?.languages ?? [];
  const spoken = project.brief.language || 'en';
  const choices = LANGUAGES.filter((l) => l.code !== spoken && !languages.includes(l.code));
  const anyMissing = languages.filter((l) => (missing[l] ?? 0) > 0);

  const mark = (langs: string[], on: boolean) =>
    setBusy((s) => {
      const next = new Set(s);
      for (const l of langs) on ? next.add(l) : next.delete(l);
      return next;
    });

  const translate = async (langs: string[]) => {
    mark(langs, true);
    try {
      const r = await api.translate(project.id, langs, metadata);
      useStudio.setState({ translations: r.state });
      const names = langs.map((l) => language(l).name).join(', ');
      if (r.failed) toast.warning(`${names}: ${r.failed} sentence${r.failed === 1 ? '' : 's'} came back empty; they show in the original until you translate again`);
      else toast.success(r.translated ? `Subtitles translated into ${names}` : `${names} is already up to date`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      mark(langs, false);
    }
  };

  const add = async () => {
    if (!adding) return;
    const lang = adding;
    setAdding('');
    await translate([lang]);
  };

  const remove = async (lang: string) => {
    try {
      const r = await api.removeLanguage(project.id, lang);
      useStudio.setState({ translations: r.state });
      if (captions?.type === 'captions' && captions.language === lang) void edit([{ op: 'updateClip', clipId: captions.id, patch: { language: null } }], 'Captions language');
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const showInCaptions = (lang: string | null) => {
    if (captions?.type !== 'captions') return;
    void edit([{ op: 'updateClip', clipId: captions.id, patch: { language: lang } }], 'Captions language');
  };

  const dub = async (lang: string) => {
    mark([lang], true);
    const t = toast.loading(`Dubbing into ${language(lang).name}… (each line is voiced, this takes a while)`);
    try {
      const r = await api.dub(project.id, { language: lang, original });
      toast.success(`Dubbed version ready: ${r.name} (${r.lines} lines, ${r.engine})${r.cut ? `; ${r.cut} long line${r.cut === 1 ? '' : 's'} cut short` : ''}`, {
        id: t,
        duration: 10000,
        action: { label: 'Open', onClick: () => navigate(r.id) },
      });
      setDubbing(null);
    } catch (err) {
      toast.error(errorText(err), { id: t });
    } finally {
      mark([lang], false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-muted">
        Your AI translates the captions sentence by sentence. They stay in sync when you edit: only new sentences are translated. Every render writes a subtitle file per language, and the YouTube upload adds them as caption tracks with the translated title and description.
      </p>
      {words.length === 0 ? (
        <div className="rounded-lg border border-line bg-black/20 px-3 py-2 text-xs text-muted">Subtitles are made from the transcript: transcribe the footage first (Text tab).</div>
      ) : !hasModel ? (
        <div className="rounded-lg border border-line bg-black/20 px-3 py-2 text-xs text-muted">
          Translating needs an AI model.{' '}
          <button className="font-semibold text-accent-2-ink hover:underline" onClick={() => useStudio.getState().openSettings('models')}>
            Add one in Settings
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <SelectField className="flex-1" value={adding} onChange={setAdding} placeholder="Add a language…" options={choices.map((l) => ({ value: l.code, label: `${l.name} — ${l.native}` }))} />
        <button className="btn btn-primary" disabled={!adding || words.length === 0} onClick={() => void add()}>
          <Plus className="size-4" /> Add and translate
        </button>
      </div>
      <Switch checked={metadata} onChange={setMetadata} label="Also translate the YouTube title and description" />
      {languages.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {anyMissing.length > 1 && (
            <button className="btn btn-sm self-start" disabled={busy.size > 0} onClick={() => void translate(anyMissing)}>
              <Languages className="size-3.5" /> Translate what is new in all ({anyMissing.length} languages)
            </button>
          )}
          {languages.map((code) => {
            const l = language(code);
            const todo = missing[code] ?? 0;
            const working = busy.has(code);
            const shown = captions?.type === 'captions' && captions.language === code;
            return (
              <div key={code} data-language={code} className="rounded-lg border border-line bg-panel-2 px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold">{l.name}</span>
                  <span className="text-dim">{l.native}</span>
                  <span className="flex-1" />
                  {working ? (
                    <span className="flex items-center gap-1.5 text-dim">
                      <Spinner className="size-3.5" /> {dubbing === code ? 'Dubbing…' : 'Translating…'}
                    </span>
                  ) : todo > 0 ? (
                    <button className="btn btn-sm" onClick={() => void translate([code])}>
                      <Languages className="size-3.5" /> Translate {todo} new sentence{todo === 1 ? '' : 's'}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-ok">
                      <CircleCheck className="size-3.5" /> Up to date
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <a className="btn btn-sm" href={subtitlesUrl(project.id, code)} download aria-label={`Download ${l.name} subtitles`}>
                    <Download className="size-3.5" /> SRT
                  </a>
                  <Tip label={captions ? (shown ? 'The captions show this language' : 'Show the captions in this language') : 'Add captions first (Text tab or the Director)'}>
                    <button className={cn('btn btn-sm', shown && 'border-accent/60 text-accent-2-ink')} disabled={!captions} aria-pressed={shown} onClick={() => showInCaptions(shown ? null : code)}>
                      <Captions className="size-3.5" /> {shown ? 'In the captions' : 'Show in captions'}
                    </button>
                  </Tip>
                  <button className="btn btn-sm" disabled={working} onClick={() => setDubbing(dubbing === code ? null : code)}>
                    <Mic className="size-3.5" /> Dubbed version…
                  </button>
                  <span className="flex-1" />
                  <button className="btn btn-sm btn-ghost btn-icon text-dim hover:text-danger" aria-label={`Remove ${l.name}`} onClick={() => void remove(code)}>
                    <X className="size-3.5" />
                  </button>
                </div>
                {dubbing === code && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-black/20 p-2 text-[11px] text-muted">
                    <span>A new project with each line voiced in {l.name}, timed to the original. The original voice:</span>
                    <Segmented
                      size="sm"
                      value={original}
                      onChange={setOriginal}
                      options={[
                        { value: 'duck', label: 'Lowered' },
                        { value: 'mute', label: 'Silent' },
                      ]}
                    />
                    <button className="btn btn-sm btn-primary" disabled={working} onClick={() => void dub(code)}>
                      {working ? <Spinner className="size-3.5" /> : <Mic className="size-3.5" />} Make the {l.name} version
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

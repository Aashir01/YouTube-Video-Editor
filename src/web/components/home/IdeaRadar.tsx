import React, { useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Lightbulb, Radar, Search, Sparkles } from 'lucide-react';
import { compactNumber, ideaBrief, type IdeasResult, type IdeaVideo } from '../../../shared/ideas';
import { api } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { prefs } from '../../lib/prefs';
import { cn, errorText } from '../../lib/utils';
import { Segmented, SelectField, Spinner } from '../ui';

const REGIONS = [
  { value: '', label: 'Anywhere' },
  { value: 'PK', label: 'Pakistan' },
  { value: 'IN', label: 'India' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'AE', label: 'UAE' },
  { value: 'BD', label: 'Bangladesh' },
];
const LANGUAGES = [
  { value: '', label: 'Any language' },
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'Urdu' },
  { value: 'hi', label: 'Hindi' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ar', label: 'Arabic' },
];

const age = (iso: string) => {
  const d = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return d < 1 ? 'today' : d < 30 ? `${d}d ago` : `${Math.round(d / 30)}mo ago`;
};

const Card: React.FC<{ v: IdeaVideo; onUse: () => void }> = ({ v, onUse }) => (
  <div className={cn('glass flex flex-col overflow-hidden rounded-xl', v.outlier < 2 && 'opacity-60 hover:opacity-100')} data-idea={v.id} title={v.outlier < 2 ? 'About as many views as this channel usually gets' : undefined}>
    <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="relative block aspect-video bg-black/40">
      {v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" className="size-full object-cover" />}
      <span className={cn('absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold', v.outlier >= 10 ? 'bg-accent text-white' : v.outlier >= 3 ? 'bg-warn text-black' : 'bg-black/70 text-text')}>{v.outlier}×</span>
      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1 text-[10px] text-text">{v.isShort ? 'Short' : `${Math.max(1, Math.round(v.duration / 60))} min`}</span>
    </a>
    <div className="flex flex-1 flex-col gap-1 p-2.5">
      <div className="line-clamp-2 text-xs font-semibold leading-snug" title={v.title}>
        {v.title}
      </div>
      <div className="truncate text-[10px] text-dim">
        {v.channelTitle} · {compactNumber(v.channelSubscribers)} subs
      </div>
      <div className="text-[10px] text-muted">
        {compactNumber(v.views)} views · {age(v.publishedAt)} · channel average {compactNumber(v.channelAverage)}
      </div>
      <div className="mt-auto flex gap-1.5 pt-1.5">
        <button className="btn btn-sm btn-primary flex-1 justify-center" onClick={onUse}>
          <Sparkles className="size-3" /> Use this idea
        </button>
        <a className="btn btn-sm" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" aria-label="Watch on YouTube">
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  </div>
);

/** Idea radar on the home screen: what is working right now in a niche, and a brief for your own take. */
export const IdeaRadar: React.FC<{ onUse: (brief: string) => void }> = ({ onUse }) => {
  const openSettings = useStudio((s) => s.openSettings);
  const [query, setQuery] = useState(() => prefs.get('ideaQuery', ''));
  const [region, setRegion] = useState(() => prefs.get('ideaRegion', ''));
  const [language, setLanguage] = useState(() => prefs.get('ideaLanguage', ''));
  const [kind, setKind] = useState<'any' | 'shorts' | 'long'>('any');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IdeasResult | null>(null);
  const [needsKey, setNeedsKey] = useState(false);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    prefs.set('ideaQuery', query.trim());
    prefs.set('ideaRegion', region);
    prefs.set('ideaLanguage', language);
    setBusy(true);
    setNeedsKey(false);
    try {
      const r = await api.ideas({ query: query.trim(), region: region || undefined, language: language || undefined, kind });
      if (r.needsKey) setNeedsKey(true);
      else setResult(r);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const p = result?.patterns;
  return (
    <section className="mb-14" data-testid="idea-radar">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="tile size-7 text-hue-mint">
          <Radar className="size-3.5" />
        </span>
        <h2 className="text-[15px] font-bold tracking-tight">Idea radar</h2>
        <span className="text-xs text-dim">videos in your niche that beat their channel’s average by the most</span>
      </div>
      <form className="glass flex flex-wrap items-center gap-2 rounded-xl p-2" onSubmit={(e) => void search(e)}>
        <label className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-line bg-black/25 px-2.5 focus-within:border-accent/70">
          <Search className="size-3.5 text-dim" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Your niche, e.g. personal finance, cricket, cooking, tech reviews" aria-label="Niche" className="w-full bg-transparent py-1.5 text-sm outline-none focus-visible:outline-none" />
        </label>
        <SelectField className="w-36 py-1 text-xs" value={region} onChange={setRegion} options={REGIONS} />
        <SelectField className="w-32 py-1 text-xs" value={language} onChange={setLanguage} options={LANGUAGES} />
        <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: 'any', label: 'All' }, { value: 'shorts', label: 'Shorts' }, { value: 'long', label: 'Long' }]} />
        <button className="btn btn-primary" disabled={busy || !query.trim()}>
          {busy ? <Spinner /> : <Radar className="size-4" />} Find ideas
        </button>
      </form>
      {needsKey && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
          The idea radar reads YouTube with a free YouTube Data API key (or your connected channel).
          <button className="btn btn-sm" onClick={() => openSettings('media')}>
            Add the key
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => openSettings('youtube')}>
            Connect YouTube
          </button>
        </div>
      )}
      {result && (
        <div className="mt-3">
          {p && p.phrases.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="idea-patterns">
              <Lightbulb className="size-3.5 text-warn" />
              <span className="text-dim">The outliers share:</span>
              {p.phrases.map((x) => (
                <span key={x.text} className="rounded-full border border-line bg-panel-2 px-2 py-0.5 font-semibold text-muted">
                  {x.text} <span className="text-dim">{x.count}</span>
                </span>
              ))}
              <span className="text-dim">
                · titles ~{p.averageTitleLength} characters · {p.withNumber}% with a number · {p.withQuestion}% questions · {p.shortsShare}% Shorts
              </span>
            </div>
          )}
          {result.videos.length === 0 ? (
            <div className="glass rounded-xl px-4 py-6 text-center text-xs text-muted">Nothing found for “{result.query}” in the last {result.days} days. Try broader words.</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {result.videos.slice(0, 12).map((v) => (
                <Card key={v.id} v={v} onUse={() => onUse(ideaBrief(v, result.query))} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

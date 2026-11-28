import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, Gift, LogOut, Share2, Sparkles, Zap } from 'lucide-react';
import { PRODUCT } from '../../../shared/product';
import { api, type CloudPlans, type CloudStatus, type CloudUsage } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { cn, copyText, errorText } from '../../lib/utils';
import { Badge, Field, ProgressBar, SelectField, Spinner } from '../ui';

const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className, ...rest }) => (
  <div className={cn('rounded-xl border border-line bg-panel-2 p-4', className)} {...rest}>
    {children}
  </div>
);

const fmt = (n: number) => n.toLocaleString('en-US');
const size = (mb: number) => (mb < 1000 ? `${mb} MB` : `${(mb / 1000).toFixed(1).replace(/\.0$/, '')} GB`);
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const SignIn: React.FC<{ status: CloudStatus; onDone: (s: CloudStatus) => void }> = ({ status, onDone }) => {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState(status.email);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [referral, setReferral] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(status.error ?? '');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const s = await api.cloudSignIn(mode, { email, password, ...(mode === 'signup' ? { name, referral } : {}) });
      if (!s.signedIn) {
        setError(s.error ?? 'Could not sign in');
        return;
      }
      toast.success(mode === 'signup' ? `Welcome to Cutroom AI: ${fmt(s.account?.credits.total ?? 0)} free credits` : 'Signed in to Cutroom AI');
      onDone(s);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="grid gap-3">
      <div className="flex gap-1 rounded-lg bg-black/25 p-0.5 text-xs" role="tablist">
        {(['signup', 'login'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn('flex-1 rounded-md px-3 py-1.5 font-semibold text-muted', mode === m && 'bg-white/[0.09] text-text')}>
            {m === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        ))}
      </div>
      <form className="grid gap-3" onSubmit={(e) => void submit(e)}>
        {mode === 'signup' && (
          <Field label="Name (optional)">
            <input className="field" aria-label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        )}
        <Field label="Email">
          <input className="field" aria-label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
          <input className="field" aria-label="Password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
        </Field>
        {mode === 'signup' && (
          <Field label="Invite code (optional)">
            <input className="field font-mono uppercase" aria-label="Invite code" value={referral} onChange={(e) => setReferral(e.target.value)} />
          </Field>
        )}
        {error && <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        <button className="btn btn-primary justify-center" disabled={busy || !email || !password}>
          {busy ? <Spinner /> : <Sparkles className="size-4" />} {mode === 'signup' ? 'Create account and get free credits' : 'Sign in'}
        </button>
      </form>
    </Card>
  );
};

const Account: React.FC<{ status: CloudStatus; onChange: (s: CloudStatus) => void }> = ({ status, onChange }) => {
  const a = status.account;
  // on the website, signing out of Cutroom AI is signing out of the site
  const hosted = useStudio((s) => Boolean(s.system?.hosted));
  const [storage, setStorage] = useState<{ usedMb: number; limitMb: number | null } | null>(null);
  useEffect(() => {
    if (hosted)
      api
        .hostedStatus()
        .then((r) => setStorage(r.storage))
        .catch(() => undefined);
  }, [hosted]);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<CloudUsage | null>(null);
  useEffect(() => {
    api
      .cloudUsage()
      .then(setUsage)
      .catch(() => undefined);
  }, [a?.credits.total]);
  const run = async (fn: () => Promise<CloudStatus>, done?: string) => {
    setBusy(true);
    try {
      onChange(await fn());
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (!a) return <Card className="text-xs text-warn">{status.error ?? 'Cutroom Cloud is not reachable right now.'}</Card>;
  const used = a.monthlyAllowance ? Math.max(0, a.credits.monthly) / a.monthlyAllowance : 0;
  const options = status.models.map((m) => ({ value: m.id, label: `${m.name}${m.tier === 'premium' ? ' · Pro' : ''}` }));
  const main = status.main?.providerId === 'cutroom' ? status.main.model : '';
  const fast = status.fast?.providerId === 'cutroom' ? status.fast.model : '';
  return (
    <>
      <Card className="grid gap-4" data-testid="cloud-account">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{a.name || a.email}</div>
            {a.name && <div className="truncate text-[11px] text-dim">{a.email}</div>}
          </div>
          <Badge tone={a.plan === 'free' ? 'default' : 'accent'}>{a.planName} plan</Badge>
          <button className="btn btn-sm btn-ghost text-dim" disabled={busy} onClick={() => (hosted ? window.location.assign('/logout') : void run(() => api.cloudLogout(), 'Signed out of Cutroom AI'))}>
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <Zap className={cn('size-5', a.credits.total > 0 ? 'text-accent' : 'text-danger')} />
            <span className="text-3xl font-bold tabular-nums" data-testid="cloud-credits">
              {fmt(a.credits.total)}
            </span>
            <span className="text-xs text-muted">credits</span>
          </div>
          <ProgressBar className="mt-2" value={used} tone={a.credits.total > 0 ? 'accent' : 'danger'} />
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
            <span>
              This month: {fmt(Math.max(0, a.credits.monthly))} of {fmt(a.monthlyAllowance)} (back on {day(a.renewsAt)})
            </span>
            {a.credits.bonus > 0 && <span>Gifts: {fmt(a.credits.bonus)}</span>}
            {a.credits.extra > 0 && <span>Bought: {fmt(a.credits.extra)} (never expire)</span>}
            {a.planUntil && <span>Plan until {day(a.planUntil)}</span>}
            {storage && (
              <span data-testid="storage">
                Storage: {size(storage.usedMb)}
                {storage.limitMb ? ` of ${size(storage.limitMb)}` : ''}
              </span>
            )}
            {a.plan === 'free' && <span>Free plan renders end with a small “Made with Cutroom” badge (Creator removes it)</span>}
          </div>
        </div>
        {status.inUse ? (
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <Field label="Director model" hint="Plans and edits">
              <SelectField value={main} placeholder="Your own provider" options={options} onChange={(v) => void run(() => api.cloudUse({ main: v, fast: fast || 'auto-fast' }))} />
            </Field>
            <Field label="Fast model" hint="Summaries, titles, translations">
              <SelectField value={fast} placeholder="Your own provider" options={options} onChange={(v) => void run(() => api.cloudUse({ main: main || 'auto', fast: v }))} />
            </Field>
          </div>
        ) : (
          <div className="flex items-center gap-3 border-t border-line pt-3">
            <span className="flex-1 text-xs text-muted">The Director uses your own AI provider right now.</span>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(() => api.cloudUse(), 'The Director now runs on Cutroom AI')}>
              <Sparkles className="size-3.5" /> Use Cutroom AI
            </button>
          </div>
        )}
      </Card>
      {usage && usage.entries.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center text-sm font-semibold">
            <span className="flex-1">Recent use</span>
            <span className="text-[11px] font-normal text-dim">
              {fmt(usage.period.spent)} credits on {fmt(usage.period.requests)} AI requests since {day(usage.period.since)}
            </span>
          </div>
          <div className="max-h-56 overflow-y-auto text-[11px]" data-testid="cloud-usage">
            {usage.entries.map((e, i) => (
              <div key={i} className="flex items-center gap-3 border-t border-line/60 py-1.5 first:border-0">
                <span className="w-28 shrink-0 text-dim">{when(e.at)}</span>
                <span className="min-w-0 flex-1 truncate text-muted" title={e.model ?? e.note}>
                  {e.kind === 'charge' ? `${e.note}${e.inputTokens ? ` · ${fmt(e.inputTokens)} in / ${fmt(e.outputTokens ?? 0)} out tokens` : ''}` : e.note}
                </span>
                <span className={cn('w-14 shrink-0 text-right font-mono tabular-nums', e.delta < 0 ? 'text-muted' : 'text-ok')}>
                  {e.delta > 0 ? '+' : ''}
                  {fmt(e.delta)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
};

const Plans: React.FC<{ status: CloudStatus }> = ({ status }) => {
  const [plans, setPlans] = useState<CloudPlans | null>(null);
  useEffect(() => {
    api
      .cloudPlans()
      .then(setPlans)
      .catch(() => undefined);
  }, []);
  if (!plans) return null;
  const free = plans.plans.find((p) => p.id === 'free');
  const creator = plans.plans.find((p) => p.id === 'creator');
  return (
    <div>
      <div className="label">Plans and credits</div>
      <div className="mb-2 text-[11px] leading-relaxed text-muted">
        Free: {fmt(plans.signupCredits)} credits to start and {fmt(free?.monthlyCredits ?? 0)} more each month, standard models. Creator: {fmt(creator?.monthlyCredits ?? 0)} credits every month and Pro models. Credits are charged by what each AI request really costs; the editor itself, local voices and transcription are always free.
      </div>
      <div className="grid grid-cols-3 gap-2">
        {plans.products.map((p) => {
          const href = p.checkoutUrl ?? plans.contactUrl;
          return (
            <div key={p.id} className="flex flex-col rounded-lg border border-line bg-panel-2 px-3 py-2.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold">{p.price}</span>
                <span className="text-[11px] text-muted">{p.name}</span>
              </div>
              <div className="mt-0.5 flex-1 text-[11px] text-dim">{p.note}</div>
              {href ? (
                <a className="btn btn-sm mt-2 justify-center" href={p.checkoutUrl ? `${p.checkoutUrl}${p.checkoutUrl.includes('?') ? '&' : '?'}email=${encodeURIComponent(status.account?.email ?? '')}` : href} target="_blank" rel="noreferrer">
                  {p.checkoutUrl ? 'Buy' : 'Ask for this'} <ExternalLink className="size-3" />
                </a>
              ) : (
                <span className="mt-2 text-center text-[10px] text-dim">Payments open soon</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Invite friends: they get extra credits, you get credits when they really use Cutroom AI and when they buy. */
const Invite: React.FC<{ account: NonNullable<CloudStatus['account']> }> = ({ account }) => {
  const [plans, setPlans] = useState<CloudPlans | null>(null);
  useEffect(() => {
    api
      .cloudPlans()
      .then(setPlans)
      .catch(() => undefined);
  }, []);
  const r = plans?.referral;
  const code = account.referralCode;
  const message = `I edit my YouTube videos with ${PRODUCT.name}, an AI video editor. Sign up in Settings → Cutroom AI with my invite code ${code}${r ? ` for ${fmt(r.invitee)} extra free AI credits` : ''}: ${PRODUCT.site}`;
  const stats = account.referrals;
  return (
    <Card className="grid gap-2.5" data-testid="cloud-invite">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Gift className="size-4 text-hue-pink" /> Invite friends, earn credits
      </div>
      {r && (
        <p className="text-[11px] leading-relaxed text-muted">
          Friends who join with your code get {fmt(r.invitee)} extra credits. You get {fmt(r.active)} when they start using Cutroom AI, and {fmt(r.purchase)} when they buy a plan or credits.
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="rounded-lg border border-line bg-black/25 px-3 py-1.5 font-mono text-sm font-bold tracking-widest" data-testid="invite-code">
          {code}
        </span>
        <button className="btn btn-sm" onClick={() => void copyText(message).then(() => toast.success('Invite message copied'))}>
          <Copy className="size-3.5" /> Copy invite
        </button>
        <a className="btn btn-sm" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
          <Share2 className="size-3.5" /> WhatsApp
        </a>
      </div>
      {stats && (
        <div className="text-[11px] text-dim" data-testid="invite-stats">
          {fmt(stats.invited)} joined · {fmt(stats.active)} using it · {fmt(stats.earned)} credits earned
        </div>
      )}
    </Card>
  );
};

export const CloudSection: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const hosted = useStudio((s) => Boolean(s.system?.hosted));
  const status = useStudio((s) => s.cloud);
  const setCloud = useStudio((s) => s.setCloud);
  const refreshCloud = useStudio((s) => s.refreshCloud);
  const [url, setUrl] = useState('');
  useEffect(() => {
    void refreshCloud();
  }, [refreshCloud]);
  useEffect(() => setUrl(status?.url ?? ''), [status?.url]);
  const update = (s: CloudStatus) => {
    setCloud(s);
    onChanged();
  };
  const saveUrl = async () => {
    if (!status || url.trim() === status.url) return;
    try {
      await api.saveSettings({ cloud: { url: url.trim() } });
      await refreshCloud();
      onChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="mb-1">
        <h3 className="flex items-center gap-2 text-base font-bold">
          Cutroom AI <Badge tone="accent">no API keys</Badge>
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          AI that works the moment you sign in: the Director, Find Shorts, titles and translations run on the best low-cost models (open models like DeepSeek and Qwen, Gemini Flash, and Pro models when you need them). Start with free credits, then pay only for what you use. Prefer your own key? Add a provider under AI models instead.
        </p>
      </div>
      {!status ? (
        <Spinner className="text-dim" />
      ) : status.signedIn ? (
        <Account status={status} onChange={update} />
      ) : hosted ? (
        <Card className="text-xs text-muted">
          Your sign-in expired.{' '}
          <a className="font-semibold text-accent-2-ink hover:underline" href="/logout">
            Sign in again
          </a>
        </Card>
      ) : (
        <SignIn status={status} onDone={update} />
      )}
      {status && <Plans status={status} />}
      {status?.signedIn && status.account?.referralCode && <Invite account={status.account} />}
      {!hosted && (
      <details className="text-xs text-dim">
        <summary className="cursor-pointer select-none">Advanced</summary>
        <Field className="mt-2" label="Cutroom Cloud server" hint="Only change this if you run your own Cutroom Cloud. Clear it to go back to Cutroom's server.">
          <input className="field font-mono text-xs" aria-label="Cutroom Cloud server" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => void saveUrl()} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </Field>
      </details>
      )}
    </div>
  );
};

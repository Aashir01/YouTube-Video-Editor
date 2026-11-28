/**
 * Cutroom AI in the app: sign in to Cutroom Cloud, keep the token in settings (the gateway then
 * shows up as the "Cutroom AI" provider) and read the plan, credits and usage for the UI.
 *
 *   GET  /api/cloud            status: signed in?, account, server URL
 *   POST /api/cloud/signup     { email, password, name?, referral?, use? }
 *   POST /api/cloud/login      { email, password, use? }
 *   POST /api/cloud/logout
 *   POST /api/cloud/use        make Cutroom AI the Director's models { main?, fast? }
 *   GET  /api/cloud/usage
 *   GET  /api/cloud/plans
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { CLOUD_PROVIDER_ID, cloudUrl, getSavedSettings, getSettings, saveSettings, type Settings } from '../config';

export const cloud = new Hono();

class CloudCallError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const call = async <T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> => {
  const s = getSavedSettings();
  const url = `${cloudUrl(s)}/v1${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new CloudCallError(502, `Cutroom Cloud is not reachable at ${cloudUrl(s)} (${(err as Error).message}). Check your internet connection, or the server address under Advanced.`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!res.ok) throw new CloudCallError(res.status, (body as { error?: { message?: string } })?.error?.message ?? `Cutroom Cloud answered ${res.status}`);
  return body as T;
};

interface CloudModelInfo {
  id: string;
  name: string;
  tier: string;
  vision: boolean;
  note: string;
}

const fetchModels = async () => (await call<{ data: CloudModelInfo[] }>('/models')).data.map((m) => ({ id: m.id, name: m.name ?? m.id, tier: m.tier ?? 'standard', vision: Boolean(m.vision), note: m.note ?? '' }));

const pointsAtCloud = (s: Settings) => s.llm.main?.providerId === CLOUD_PROVIDER_ID || s.llm.fast?.providerId === CLOUD_PROVIDER_ID;

/** Make Cutroom AI run the Director (main) and the small jobs (fast). */
const useCloud = (s: Settings, main = 'auto', fast = 'auto-fast'): Settings => ({
  ...s,
  llm: { ...s.llm, main: { providerId: CLOUD_PROVIDER_ID, model: main }, fast: { providerId: CLOUD_PROVIDER_ID, model: fast } },
});

/** Forget the sign-in here; models that pointed at Cutroom AI go back to the user's own provider, if any. */
const signedOut = (s: Settings): Settings => {
  const own = s.llm.providers.find((p) => p.id !== CLOUD_PROVIDER_ID && p.apiKey && p.models.length);
  const back = (ref: Settings['llm']['main'], i: number) => (ref?.providerId !== CLOUD_PROVIDER_ID ? ref : own ? { providerId: own.id, model: own.models[Math.min(i, own.models.length - 1)]! } : undefined);
  return { ...s, cloud: { ...s.cloud, token: '', plan: '' }, llm: { ...s.llm, main: back(s.llm.main, 0), fast: back(s.llm.fast, 1) } };
};

const status = async () => {
  const s = getSavedSettings();
  const base = { url: cloudUrl(s), email: s.cloud.email, models: s.cloud.models, inUse: pointsAtCloud(s), main: s.llm.main, fast: s.llm.fast };
  if (!s.cloud.token) return { ...base, signedIn: false as const };
  try {
    const account = await call<Record<string, unknown>>('/account', { token: s.cloud.token });
    // remember the plan for renders and uploads (no network needed there)
    const plan = String(account.plan ?? '');
    const fresh = getSavedSettings();
    if (fresh.cloud.token && fresh.cloud.plan !== plan) saveSettings({ ...fresh, cloud: { ...fresh.cloud, plan } });
    return { ...base, signedIn: true as const, account };
  } catch (err) {
    if (err instanceof CloudCallError && err.status === 401) {
      // revoked or expired: sign out here too
      saveSettings(signedOut(s));
      return { ...base, signedIn: false as const, error: err.message };
    }
    return { ...base, signedIn: true as const, offline: true, error: (err as Error).message };
  }
};

const send = (c: Context, err: unknown) => c.json({ error: (err as Error).message }, (err instanceof CloudCallError ? err.status : 500) as 400);

const Credentials = z.object({ email: z.string().min(3), password: z.string().min(1), name: z.string().optional(), referral: z.string().optional(), use: z.boolean().optional() });

const signIn = (kind: 'signup' | 'login') => async (c: Context) => {
  try {
    const body = Credentials.parse(await c.req.json());
    const r = await call<{ token: string; account: { email: string } }>(`/account/${kind}`, {
      body: { email: body.email, password: body.password, name: body.name, referral: body.referral || undefined, device: `Cutroom on ${process.platform}` },
    });
    const models = await fetchModels().catch(() => []);
    // with no other AI set up (in Settings or the environment), Cutroom AI runs the Director right away
    const eff = getSettings();
    const hasOther = Boolean(eff.llm.main && eff.llm.main.providerId !== CLOUD_PROVIDER_ID && eff.llm.providers.some((p) => p.id === eff.llm.main!.providerId));
    let s = getSavedSettings();
    s = { ...s, cloud: { ...s.cloud, token: r.token, email: r.account.email, plan: String((r.account as { plan?: string }).plan ?? ''), models } };
    if (body.use ?? !hasOther) s = useCloud(s);
    saveSettings(s);
    return c.json(await status());
  } catch (err) {
    // a wrong password or a taken email is an answer, not a failure: the status carries the message
    if (err instanceof CloudCallError && err.status >= 400 && err.status < 500) return c.json({ ...(await status()), error: err.message });
    return send(c, err);
  }
};

cloud.get('/', async (c) => c.json(await status()));
cloud.post('/signup', signIn('signup'));
cloud.post('/login', signIn('login'));

cloud.post('/logout', async (c) => {
  const s = getSavedSettings();
  if (s.cloud.token) await call('/account/logout', { method: 'POST', token: s.cloud.token }).catch(() => undefined);
  saveSettings(signedOut(s));
  return c.json(await status());
});

cloud.post('/use', async (c) => {
  const body = z.object({ main: z.string().optional(), fast: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
  const s = getSavedSettings();
  if (!s.cloud.token) return c.json({ error: 'Sign in to Cutroom AI first' }, 400);
  saveSettings(useCloud(s, body.main, body.fast));
  return c.json(await status());
});

cloud.get('/usage', async (c) => {
  const s = getSavedSettings();
  if (!s.cloud.token) return c.json({ error: 'Sign in to Cutroom AI first' }, 400);
  try {
    return c.json(await call('/account/usage?limit=40', { token: s.cloud.token }));
  } catch (err) {
    return send(c, err);
  }
});

cloud.get('/plans', async (c) => {
  try {
    return c.json(await call('/plans'));
  } catch (err) {
    return send(c, err);
  }
});

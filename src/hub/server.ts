/**
 * The Cutroom website: sign up and sign in with Cutroom Cloud accounts, then everything else is
 * passed through to the person's own studio (see apps.ts), including live event streams, media
 * with ranges and uploads.
 *
 *   GET  /signup, /login       the sign-in page (also the landing page)
 *   POST /signup, /login       forms; set the session cookie and go to the studio
 *   GET  /logout               end the session
 *   GET  /hub/health           for monitoring
 *   *                          the studio (signed in), else the sign-in page
 */
import http from 'node:http';
import { StudioFullError, Studios, type Studio } from './apps';
import type { HubConfig } from './config';
import { authPage, messagePage } from './pages';
import { SESSION_DAYS, Sessions, type Session } from './sessions';

const COOKIE = 'cutroom_session';

const cookies = (req: http.IncomingMessage) =>
  Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k!, decodeURIComponent(v.join('='))]),
  );

const readBody = (req: http.IncomingMessage, limit = 64 * 1024) =>
  new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > limit) {
        reject(new Error('Too large'));
        req.destroy();
      } else chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const send = (res: http.ServerResponse, status: number, body: string, headers: Record<string, string | string[]> = {}) => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...headers });
  res.end(body);
};

const redirect = (res: http.ServerResponse, to: string, headers: Record<string, string | string[]> = {}) => {
  res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', ...headers });
  res.end();
};

/** Only same-site paths after signing in (never another site). */
const safeNext = (next: unknown) => (typeof next === 'string' && /^\/(?!\/)[^\s\\]*$/.test(next) && !/^\/(login|signup|logout)\b/.test(next) ? next : '/');

export interface HubDeps {
  cfg: HubConfig;
  sessions: Sessions;
  studios?: Studios;
  fetch?: typeof fetch;
}

export const createHub = ({ cfg, sessions, fetch: f = fetch, ...rest }: HubDeps) => {
  const cloud = async <T>(path: string, init: { body?: unknown; token?: string; ip?: string } = {}): Promise<{ ok: boolean; status: number; data: T & { error?: { message?: string } } }> => {
    const res = await f(`${cfg.cloudUrl}/v1${path}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.ip ? { 'X-Forwarded-For': init.ip } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T & { error?: { message?: string } } };
  };

  const studios =
    rest.studios ??
    new Studios(cfg, async (userId) => {
      const token = sessions.latestToken(userId);
      if (!token) throw new Error('Sign in again');
      const r = await cloud<{ email: string; plan: string }>('/account', { token });
      if (!r.ok) throw new Error(r.data.error?.message ?? 'Sign in again');
      return { token, email: r.data.email, plan: r.data.plan };
    });

  const clientIp = (req: http.IncomingMessage) => {
    const fwd = cfg.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() : '';
    return fwd || req.socket.remoteAddress || 'unknown';
  };
  const secure = (req: http.IncomingMessage) => cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https';
  const sessionCookie = (req: http.IncomingMessage, id: string, maxAge = SESSION_DAYS * 86400) => `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;

  const auth = async (req: http.IncomingMessage, res: http.ServerResponse, mode: 'signup' | 'login') => {
    const form = new URLSearchParams(await readBody(req));
    const email = (form.get('email') ?? '').trim();
    const password = form.get('password') ?? '';
    const name = (form.get('name') ?? '').trim();
    const invite = (form.get('invite') ?? '').trim();
    const next = safeNext(form.get('next'));
    let r;
    try {
      r = await cloud<{ token: string; account: { id: string; email: string } }>(`/account/${mode}`, {
        body: { email, password, device: 'Cutroom website', ...(mode === 'signup' ? { name: name || undefined, referral: invite || undefined } : {}) },
        ip: clientIp(req),
      });
    } catch {
      return send(res, 502, authPage({ mode, email, name, invite, error: 'Cutroom is not reachable right now. Try again in a minute.' }));
    }
    if (!r.ok || !r.data.token) return send(res, r.status === 429 ? 429 : 400, authPage({ mode, email, name, invite, next, error: r.data.error?.message ?? 'That did not work; try again' }));
    const id = sessions.create({ userId: r.data.account.id, email: r.data.account.email, token: r.data.token });
    redirect(res, next, { 'Set-Cookie': sessionCookie(req, id) });
  };

  /** Pass a request through to the studio, streaming both ways. */
  const proxy = (req: http.IncomingMessage, res: http.ServerResponse, studio: Studio) => {
    const headers = { ...req.headers };
    delete headers.cookie; // the studio needs no website cookie
    headers['x-forwarded-for'] = clientIp(req);
    const up = http.request({ host: '127.0.0.1', port: studio.port, method: req.method, path: req.url, headers }, (ur) => {
      const stream = String(ur.headers['content-type'] ?? '').includes('text/event-stream');
      if (stream) {
        studio.streams++;
        res.on('close', () => {
          studio.streams = Math.max(0, studio.streams - 1);
          studio.lastSeen = Date.now();
        });
      }
      res.writeHead(ur.statusCode ?? 502, { ...ur.headers, 'x-frame-options': 'SAMEORIGIN' });
      ur.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) send(res, 502, messagePage('Your studio restarted', 'Reload the page to continue.', { href: '/', label: 'Reload' }));
      else res.destroy();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  };

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://hub');
    const p = url.pathname;
    try {
      if (p === '/hub/health') return send(res, 200, JSON.stringify({ ok: true, studios: studios.running.size }), { 'Content-Type': 'application/json' });
      if (p === '/signup' || p === '/login') {
        if (req.method === 'POST') return await auth(req, res, p.slice(1) as 'signup' | 'login');
        return send(res, 200, authPage({ mode: p.slice(1) as 'signup' | 'login', invite: url.searchParams.get('invite') ?? undefined, next: url.searchParams.get('next') ?? undefined }));
      }
      const sid = cookies(req)[COOKIE];
      const session: Session | null = sessions.get(sid);
      if (p === '/logout') {
        if (sid) sessions.delete(sid);
        return redirect(res, '/login', { 'Set-Cookie': sessionCookie(req, '', 0) });
      }
      if (!session) {
        if (req.method === 'GET' && !p.startsWith('/api/') && !p.startsWith('/media/') && !p.startsWith('/renders/')) {
          return p === '/' ? redirect(res, '/signup') : redirect(res, `/login?next=${encodeURIComponent(p + url.search)}`);
        }
        return send(res, 401, JSON.stringify({ error: 'Sign in again' }), { 'Content-Type': 'application/json' });
      }
      // a page on another site can't make the studio do things (the cookie is SameSite=Lax too)
      const origin = req.headers.origin;
      if (req.method !== 'GET' && req.method !== 'HEAD' && origin && new URL(origin).host !== req.headers.host) return send(res, 403, JSON.stringify({ error: 'Cross-site request refused' }), { 'Content-Type': 'application/json' });
      const studio = await studios.get(session.userId);
      proxy(req, res, studio);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof StudioFullError) return send(res, 503, messagePage('Busy right now', err.message, { href: url.pathname, label: 'Try again' }), { 'Retry-After': '60' });
      console.error('[hub]', err);
      send(res, 500, messagePage('Something went wrong', (err as Error).message, { href: '/', label: 'Back to Cutroom' }));
    }
  };

  const server = http.createServer((req, res) => void handler(req, res));
  server.requestTimeout = 0; // long uploads
  server.headersTimeout = 120_000;
  return { server, studios };
};

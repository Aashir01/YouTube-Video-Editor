/**
 * Cutroom Cloud's HTTP API.
 *
 *   GET  /v1/health
 *   GET  /v1/models                       the catalog (OpenAI list format, with Cutroom fields)
 *   GET  /v1/plans                        plans, products, checkout links
 *   POST /v1/account/signup               { email, password, name?, device?, referral? } -> { token, account }
 *   POST /v1/account/login                { email, password, device? } -> { token, account }
 *   POST /v1/account/logout               (token) forget this token
 *   GET  /v1/account                      (token) plan and credits
 *   GET  /v1/account/usage?limit=50       (token) ledger and this period's totals
 *   POST /v1/chat/completions             (token) OpenAI-compatible, billed in credits
 *   POST /v1/admin/grant                  (admin) { email, credits, bucket?, note? }
 *   POST /v1/admin/plan                   (admin) { email, plan, months? }
 *   POST /v1/admin/purchase               (admin) { email, product, ref? }  manual payments, later webhooks
 *   GET  /v1/admin/users?q=               (admin)
 *   GET  /v1/admin/stats                  (admin)
 */
import crypto from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { CloudConfig } from './config';
import type { CloudModel } from './catalog';
import { handleChat, openaiError } from './gateway';
import { CloudError, type Ledger } from './ledger';
import { PRODUCTS, plansOf } from './plans';

export interface CloudDeps {
  cfg: CloudConfig;
  ledger: Ledger;
  catalog: CloudModel[];
  fetch?: typeof fetch;
}

type Env = { Variables: { userId: string; token: string } };

const bearer = (c: Context) => (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

const clientIp = (c: Context, trustProxy: boolean) => {
  if (trustProxy) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
};

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const createCloudApp = (deps: CloudDeps) => {
  const { cfg, ledger, catalog } = deps;
  const app = new Hono<Env>();
  const failedLogins = new Map<string, { n: number; until: number }>();

  app.use('/v1/*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], exposeHeaders: ['X-Cutroom-Credits'] }));
  app.use('/v1/*', bodyLimit({ maxSize: 32 * 1024 * 1024, onError: (c) => c.json({ error: { message: 'Request too large', code: 'too_large' } }, 413) }));

  app.onError((err, c) => {
    if (err instanceof CloudError) return c.json({ error: { message: err.message, code: err.code } }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: { message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), code: 'bad_request' } }, 400);
    console.error('[cloud]', err);
    return c.json({ error: { message: 'Something went wrong on Cutroom Cloud', code: 'server_error' } }, 500);
  });

  const auth = async (c: Context<Env>, next: () => Promise<void>) => {
    const token = bearer(c);
    const userId = token ? ledger.userByToken(token) : null;
    if (!userId) return c.json({ error: { message: 'Sign in to Cutroom AI again (the sign-in expired or was revoked)', code: 'unauthorized' } }, 401);
    c.set('userId', userId);
    c.set('token', token);
    await next();
  };

  const admin = async (c: Context<Env>, next: () => Promise<void>) => {
    if (!cfg.adminToken || !same(bearer(c), cfg.adminToken)) return c.json({ error: { message: 'Admin only', code: 'forbidden' } }, 403);
    await next();
  };

  app.get('/v1/health', (c) => c.json({ ok: true, models: catalog.length, upstream: new URL(cfg.upstreamUrl).host }));

  app.get('/v1/models', (c) =>
    c.json({
      object: 'list',
      data: catalog.map((m) => ({ id: m.id, object: 'model', owned_by: 'cutroom', name: m.name, tier: m.tier, vision: m.vision, note: m.note, price: m.price })),
    }),
  );

  app.get('/v1/plans', (c) => {
    const plans = plansOf(cfg);
    return c.json({
      creditUsd: cfg.creditUsd,
      markup: cfg.markup,
      signupCredits: cfg.signupCredits,
      plans: Object.values(plans),
      products: PRODUCTS.map((p) => ({ ...p, checkoutUrl: cfg.checkoutUrls[p.id] ?? null })),
      contactUrl: cfg.contactUrl || null,
    });
  });

  // -- accounts ---------------------------------------------------------------

  const Credentials = z.object({ email: z.string().max(200), password: z.string().min(1).max(200), device: z.string().max(80).optional() });

  app.post('/v1/account/signup', async (c) => {
    const body = Credentials.extend({ name: z.string().max(80).optional(), referral: z.string().max(20).optional() }).parse(await c.req.json());
    return c.json(ledger.signup({ ...body, ip: clientIp(c, cfg.trustProxy) }));
  });

  app.post('/v1/account/login', async (c) => {
    const ip = clientIp(c, cfg.trustProxy);
    const f = failedLogins.get(ip);
    if (f && f.n >= 20 && f.until > Date.now()) return c.json({ error: { message: 'Too many failed sign-ins; try again in a few minutes', code: 'rate_limited' } }, 429);
    const body = Credentials.parse(await c.req.json());
    try {
      const r = ledger.login(body);
      failedLogins.delete(ip);
      return c.json(r);
    } catch (err) {
      if (err instanceof CloudError && err.code === 'bad_login') failedLogins.set(ip, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60_000 });
      throw err;
    }
  });

  app.post('/v1/account/logout', auth, (c) => {
    ledger.revoke(c.get('token'));
    return c.json({ ok: true });
  });

  app.get('/v1/account', auth, (c) => c.json(ledger.account(c.get('userId'))));

  app.get('/v1/account/usage', auth, (c) => c.json(ledger.usage(c.get('userId'), Number(c.req.query('limit')) || 50)));

  // -- the gateway ------------------------------------------------------------

  app.post('/v1/chat/completions', auth, async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return openaiError(400, 'bad_request', 'The body must be JSON');
    }
    return handleChat({ cfg, ledger, catalog, fetch: deps.fetch ?? fetch }, c.get('userId'), body, c.req.raw.signal);
  });

  // -- admin ------------------------------------------------------------------

  app.post('/v1/admin/grant', admin, async (c) => {
    const b = z.object({ email: z.string(), credits: z.number().int(), bucket: z.enum(['bonus', 'extra']).default('extra'), note: z.string().max(200).default('Granted') }).parse(await c.req.json());
    return c.json(ledger.grant(ledger.idByEmail(b.email), b.credits, b.bucket, b.note));
  });

  app.post('/v1/admin/plan', admin, async (c) => {
    const b = z.object({ email: z.string(), plan: z.enum(['free', 'creator']), months: z.number().int().min(1).max(36).default(1) }).parse(await c.req.json());
    return c.json(ledger.setPlan(ledger.idByEmail(b.email), b.plan, b.months));
  });

  app.post('/v1/admin/purchase', admin, async (c) => {
    const b = z.object({ email: z.string(), product: z.string(), ref: z.string().max(200).optional() }).parse(await c.req.json());
    return c.json(ledger.purchase(ledger.idByEmail(b.email), b.product, b.ref));
  });

  app.get('/v1/admin/users', admin, (c) => c.json(ledger.listUsers(c.req.query('q') ?? '', Number(c.req.query('limit')) || 50)));

  app.get('/v1/admin/stats', admin, (c) => c.json(ledger.stats()));

  return app;
};

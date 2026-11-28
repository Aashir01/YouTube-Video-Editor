import { describe, expect, it } from 'vitest';
import { createCloudApp } from './app';
import { DEFAULT_MODELS, type CloudModel } from './catalog';
import { loadCloudConfig } from './config';
import { creditsFor, estimateInputTokens } from './gateway';
import { addMonths, Ledger } from './ledger';

const cfg = { ...loadCloudConfig({}), signupCredits: 300, freeMonthlyCredits: 50, creatorMonthlyCredits: 2000, markup: 1.15, creditUsd: 0.001, adminToken: 'admin-secret', upstreamKey: 'k', upstreamUrl: 'http://upstream.test/v1', signupsPerIpPerDay: 3 };

const clock = (start = Date.UTC(2026, 0, 31, 10)) => {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v) };
};

describe('addMonths', () => {
  it('keeps the day, clamped to the end of shorter months', () => {
    expect(new Date(addMonths(Date.UTC(2026, 0, 31), 1)).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(new Date(addMonths(Date.UTC(2026, 0, 15), 13)).toISOString().slice(0, 10)).toBe('2027-02-15');
  });
});

describe('ledger', () => {
  it('gives signup credits and spends the monthly bucket first, then gifts, then bought credits', () => {
    const l = new Ledger(':memory:', cfg);
    const { token, account } = l.signup({ email: ' Ada@Example.com ', password: 'longenough' });
    expect(account.credits).toEqual({ total: 350, monthly: 50, bonus: 300, extra: 0 });
    expect(l.userByToken(token)).toBe(account.id);
    l.grant(account.id, 100);
    const after = l.charge(account.id, 80.2, { model: 'auto' });
    expect(after.credits).toEqual({ total: 369, monthly: 0, bonus: 269, extra: 100 });
    expect(l.charge(account.id, 400, {}).credits).toEqual({ total: -31, monthly: -31, bonus: 0, extra: 0 });
    expect(() => l.signup({ email: 'ada@example.com', password: 'longenough' })).toThrow(/exists already/);
    expect(() => l.login({ email: 'ada@example.com', password: 'wrong-password' })).toThrow(/Wrong email/);
    expect(l.login({ email: 'ADA@example.com', password: 'longenough' }).account.id).toBe(account.id);
  });

  it('resets monthly credits each month and ends plans when they run out', () => {
    const c = clock();
    const l = new Ledger(':memory:', cfg, c.now);
    const { account } = l.signup({ email: 'b@example.com', password: 'longenough' });
    l.charge(account.id, 40, {});
    const creator = l.purchase(account.id, 'creator_month').account;
    expect(creator.plan).toBe('creator');
    expect(creator.credits.monthly).toBe(2000);
    expect(creator.premium).toBe(true);
    l.charge(account.id, 1500, {});
    // a month on: fresh allowance (no rollover), plan over: back to the free allowance
    c.set(addMonths(c.now(), 1) + 1000);
    const later = l.account(account.id);
    expect(later.plan).toBe('free');
    expect(later.credits.monthly).toBe(50);
    expect(later.premium).toBe(false);
    // the ledger explains every change
    const { entries } = l.usage(account.id);
    expect(entries.map((e) => e.kind).reverse()).toEqual(['signup', 'charge', 'plan', 'charge', 'monthly']);
    expect(entries[0]!.balance).toBe(later.credits.total);
  });

  it('extends a running plan and applies a payment once', () => {
    const c = clock(Date.UTC(2026, 2, 1));
    const l = new Ledger(':memory:', cfg, c.now);
    const { account } = l.signup({ email: 'c@example.com', password: 'longenough' });
    l.purchase(account.id, 'creator_quarter', 'pay_1');
    expect(l.purchase(account.id, 'creator_quarter', 'pay_1').duplicate).toBe(true);
    const a = l.purchase(account.id, 'creator_month', 'pay_2').account;
    expect(new Date(a.planUntil!).toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(l.purchase(account.id, 'pack_5').account.credits.extra).toBe(4000);
    // taking credits away empties the monthly allowance first, then gifts, then bought credits
    expect(l.grant(account.id, -5000).credits).toEqual({ total: 1300, monthly: 0, bonus: 0, extra: 1300 });
  });

  it('limits signups per network', () => {
    const l = new Ledger(':memory:', cfg);
    for (let i = 0; i < 3; i++) l.signup({ email: `n${i}@example.com`, password: 'longenough', ip: '1.2.3.4' });
    expect(() => l.signup({ email: 'n9@example.com', password: 'longenough', ip: '1.2.3.4' })).toThrow(/Too many new accounts/);
  });
});

describe('pricing', () => {
  it('turns upstream cost into credits with the markup, rounding up', () => {
    const m = DEFAULT_MODELS[0]!;
    expect(creditsFor(cfg, m, 0.001)).toBe(2);
    expect(creditsFor(cfg, m, 0.01)).toBe(12);
    expect(creditsFor(cfg, { ...m, markup: 2 }, 0.01)).toBe(23);
  });
  it('estimates prompt size, counting images', () => {
    expect(estimateInputTokens({ messages: [{ role: 'user', content: 'x'.repeat(400) }] })).toBe(100);
    expect(estimateInputTokens({ messages: [{ role: 'user', content: [{ type: 'text', text: 'abcd' }, { type: 'image_url' }] }] })).toBe(1501);
  });
});

// a scripted upstream: streams two chunks and a usage chunk with OpenRouter's cost
const fakeUpstream = (seen: Record<string, unknown>[], opts: { cost?: number } = {}): typeof fetch =>
  (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    seen.push(body);
    const usage = { prompt_tokens: 1000, completion_tokens: 200, ...(opts.cost !== undefined ? { cost: opts.cost } : {}) };
    if (!body.stream) return new Response(JSON.stringify({ id: 'gen-1', model: body.model, choices: [{ message: { role: 'assistant', content: 'hi' } }], usage }), { headers: { 'Content-Type': 'application/json' } });
    const lines = [{ choices: [{ delta: { content: 'he' } }], model: 'google/gemini-2.5-flash' }, { choices: [{ delta: { content: 'llo' }, finish_reason: 'stop' }] }, { choices: [], usage }];
    const text = ': OPENROUTER PROCESSING\n\n' + lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as never;

const setup = (opts: { cost?: number; catalog?: CloudModel[] } = {}) => {
  const ledger = new Ledger(':memory:', cfg);
  const seen: Record<string, unknown>[] = [];
  const app = createCloudApp({ cfg, ledger, catalog: opts.catalog ?? DEFAULT_MODELS, fetch: fakeUpstream(seen, opts) });
  const call = (path: string, body?: unknown, token?: string) =>
    app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ledger, seen, call };
};

describe('gateway', () => {
  it('streams through, routes "auto" with fallbacks and charges the reported cost', async () => {
    const { call, seen } = setup({ cost: 0.0042 });
    const { token } = (await (await call('/v1/account/signup', { email: 'g@example.com', password: 'longenough' })).json()) as { token: string };
    const res = await call('/v1/chat/completions', { model: 'auto', stream: true, messages: [{ role: 'user', content: 'Hello' }] }, token);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"llo"');
    expect(seen[0]).toMatchObject({ model: 'deepseek/deepseek-v3.2', models: DEFAULT_MODELS[0]!.route, usage: { include: true }, stream_options: { include_usage: true } });
    const account = (await (await call('/v1/account', undefined, token)).json()) as { credits: { total: number } };
    expect(account.credits.total).toBe(350 - 5); // 0.0042 * 1.15 / 0.001 = 4.83 -> 5
    const usage = (await (await call('/v1/account/usage', undefined, token)).json()) as { entries: { model: string; inputTokens: number; costUsd: number }[]; period: { spent: number; requests: number } };
    expect(usage.entries[0]).toMatchObject({ model: 'auto → google/gemini-2.5-flash', inputTokens: 1000, costUsd: 0.0042 });
    expect(usage.period).toMatchObject({ spent: 5, requests: 1 });
  });

  it('sends requests with images to the vision route', async () => {
    const { call, seen } = setup({ cost: 0.001 });
    const { token } = (await (await call('/v1/account/signup', { email: 'v@example.com', password: 'longenough' })).json()) as { token: string };
    await call('/v1/chat/completions', { model: 'auto', messages: [{ role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }] }, token);
    expect(seen[0]).toMatchObject({ model: 'google/gemini-2.5-flash', models: DEFAULT_MODELS[0]!.visionRoute });
  });

  it('prices by tokens when the upstream reports no cost', async () => {
    const { call } = setup();
    const { token } = (await (await call('/v1/account/signup', { email: 'h@example.com', password: 'longenough' })).json()) as { token: string };
    const res = await call('/v1/chat/completions', { model: 'auto-fast', messages: [{ role: 'user', content: 'Hello' }] }, token);
    expect(res.status).toBe(200);
    // (1000 * 0.1 + 200 * 0.4) / 1e6 = 0.00018 USD -> 0.207 credits -> 1
    expect(res.headers.get('x-cutroom-credits')).toBe('349');
  });

  it('refuses without a token, unknown models, Pro models on the free plan and empty balances', async () => {
    const { call, ledger } = setup({ cost: 0.001 });
    const msg = { messages: [{ role: 'user', content: 'Hi' }] };
    expect((await call('/v1/chat/completions', { model: 'auto', ...msg })).status).toBe(401);
    const { token, account } = (await (await call('/v1/account/signup', { email: 'i@example.com', password: 'longenough' })).json()) as { token: string; account: { id: string } };
    expect((await call('/v1/chat/completions', { model: 'nope', ...msg }, token)).status).toBe(400);
    const pro = await call('/v1/chat/completions', { model: 'anthropic/claude-sonnet-4.5', ...msg }, token);
    expect(pro.status).toBe(403);
    expect(((await pro.json()) as { error: { code: string } }).error.code).toBe('pro_model');
    ledger.grant(account.id, -350);
    const broke = await call('/v1/chat/completions', { model: 'auto', ...msg }, token);
    expect(broke.status).toBe(402);
    expect(((await broke.json()) as { error: { message: string } }).error.message).toMatch(/out of Cutroom AI credits/);
    // a credit pack brings it back and unlocks Pro models
    ledger.purchase(account.id, 'pack_5');
    expect((await call('/v1/chat/completions', { model: 'anthropic/claude-sonnet-4.5', ...msg }, token)).status).toBe(200);
  });

  it('keeps admin endpoints behind the admin token', async () => {
    const { call } = setup();
    await call('/v1/account/signup', { email: 'j@example.com', password: 'longenough' });
    expect((await call('/v1/admin/grant', { email: 'j@example.com', credits: 10 })).status).toBe(403);
    const r = await call('/v1/admin/purchase', { email: 'j@example.com', product: 'creator_year' }, 'admin-secret');
    expect(((await r.json()) as { account: { plan: string } }).account.plan).toBe('creator');
    const models = (await (await call('/v1/models')).json()) as { data: { id: string; tier: string }[] };
    expect(models.data.find((m) => m.id === 'auto')?.tier).toBe('standard');
  });
});

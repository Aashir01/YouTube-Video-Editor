import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedSettings, type Studios } from './apps';
import { loadHubConfig } from './config';
import { createHub } from './server';
import { Sessions } from './sessions';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-hub-test-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sessions', () => {
  it('keeps the account and token server-side, behind a random id', () => {
    let now = 1_000_000;
    const s = new Sessions(':memory:', () => now);
    const id = s.create({ userId: 'u_1', email: 'a@example.com', token: 'crk_one' });
    expect(id.length).toBeGreaterThan(30);
    expect(s.get(id)).toMatchObject({ userId: 'u_1', token: 'crk_one' });
    expect(s.get('guess')).toBeNull();
    now += 1000;
    s.create({ userId: 'u_1', email: 'a@example.com', token: 'crk_two' });
    expect(s.latestToken('u_1')).toBe('crk_two');
    s.delete(id);
    expect(s.get(id)).toBeNull();
    const old = s.create({ userId: 'u_2', email: 'b@example.com', token: 'crk_b' });
    now += 31 * 86_400_000;
    expect(s.get(old)).toBeNull();
  });
});

describe('studio settings', () => {
  it('signs the studio in to Cutroom AI and keeps what the person chose', async () => {
    const dir = path.join(tmp, 'seed');
    const cfg = { ...loadHubConfig({}), renderConcurrency: 2, youtubeApiKey: 'yt-shared' };
    await seedSettings(dir, { token: 'crk_a', email: 'a@example.com', plan: 'free' }, cfg);
    let s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    expect(s.cloud).toMatchObject({ token: 'crk_a', plan: 'free', url: '' });
    expect(s.llm.main).toEqual({ providerId: 'cutroom', model: 'auto' });
    expect(s.render.concurrency).toBe(2);
    expect(s.keys.youtube).toBe('yt-shared');
    // later starts: a new token, the person's own model choice and MCP servers off
    s.llm.main = { providerId: 'mine', model: 'x' };
    s.mcpServers = { evil: { command: 'rm' } };
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s));
    await seedSettings(dir, { token: 'crk_b', email: 'a@example.com', plan: 'creator' }, cfg);
    s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    expect(s.cloud.token).toBe('crk_b');
    expect(s.llm.main).toEqual({ providerId: 'mine', model: 'x' });
    expect(s.mcpServers).toEqual({});
  });
});

describe('the website', () => {
  // a stand-in studio that echoes what it got, and streams events
  let studio: http.Server;
  let hub: http.Server;
  let base = '';
  const seen: { url?: string; cookie?: string; xff?: string }[] = [];
  const started: string[] = [];

  beforeAll(async () => {
    studio = http.createServer((req, res) => {
      seen.push({ url: req.url, cookie: req.headers.cookie, xff: String(req.headers['x-forwarded-for'] ?? '') });
      if (req.url === '/api/projects/p/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"type":"hello"}\n\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ studio: true, url: req.url }));
    });
    await new Promise<void>((r) => studio.listen(0, '127.0.0.1', r));
    const port = (studio.address() as { port: number }).port;
    const fakeStudios = { running: new Map(), get: async (userId: string) => (started.push(userId), { userId, port, streams: 0, lastSeen: 0 }) } as unknown as Studios;
    const cloud = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? '{}'));
      if (url.endsWith('/account/signup') || url.endsWith('/account/login')) {
        if (body.password !== 'correct horse') return new Response(JSON.stringify({ error: { message: 'Wrong email or password' } }), { status: 401 });
        return new Response(JSON.stringify({ token: 'crk_tok', account: { id: 'u_abc', email: body.email } }));
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const { server } = createHub({ cfg: { ...loadHubConfig({}), data: tmp }, sessions: new Sessions(':memory:'), studios: fakeStudios, fetch: cloud });
    hub = server;
    await new Promise<void>((r) => hub.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(hub.address() as { port: number }).port}`;
  });
  afterAll(() => {
    hub.close();
    studio.close();
  });

  const form = (o: Record<string, string>) => ({ method: 'POST', redirect: 'manual' as const, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });

  it('sends visitors to sign up, and keeps the studio behind sign-in', async () => {
    const home = await fetch(`${base}/`, { redirect: 'manual' });
    expect(home.status).toBe(303);
    expect(home.headers.get('location')).toBe('/signup');
    expect(await (await fetch(`${base}/signup`)).text()).toMatch(/Create account and get free credits/);
    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
    expect(started).toEqual([]);
  });

  it('shows the error on a wrong password', async () => {
    const r = await fetch(`${base}/login`, form({ email: 'a@example.com', password: 'nope' }));
    expect(r.status).toBe(400);
    expect(await r.text()).toMatch(/Wrong email or password/);
  });

  it('signs in with an HttpOnly cookie and passes requests to the studio, without the cookie', async () => {
    const r = await fetch(`${base}/login`, form({ email: 'a@example.com', password: 'correct horse', next: '/?project=p1' }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/?project=p1');
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^cutroom_session=[\w-]{40,}; Path=\/; HttpOnly; SameSite=Lax/);
    const c = cookie.split(';')[0]!;
    const api = await (await fetch(`${base}/api/projects?x=1`, { headers: { cookie: c } })).json();
    expect(api).toEqual({ studio: true, url: '/api/projects?x=1' });
    expect(started).toEqual(['u_abc']);
    expect(seen.at(-1)!.cookie).toBeUndefined();
    expect(seen.at(-1)!.xff).toBe('127.0.0.1');

    // live events stream through
    const ev = await fetch(`${base}/api/projects/p/events`, { headers: { cookie: c } });
    const reader = ev.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toMatch(/hello/);
    await reader.cancel();

    // another site can't post into the studio
    expect((await fetch(`${base}/api/projects`, { method: 'POST', headers: { cookie: c, origin: 'https://evil.example' } })).status).toBe(403);

    // never redirect to another site after signing in
    const r2 = await fetch(`${base}/login`, form({ email: 'a@example.com', password: 'correct horse', next: '//evil.example' }));
    expect(r2.headers.get('location')).toBe('/');

    // sign out
    const out = await fetch(`${base}/logout`, { headers: { cookie: c }, redirect: 'manual' });
    expect(out.headers.get('location')).toBe('/login');
    expect((await fetch(`${base}/api/projects`, { headers: { cookie: c } })).status).toBe(401);
  });
});

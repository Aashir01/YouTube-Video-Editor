// The Cutroom website: sign up on the landing page, land in your own studio already signed in to
// Cutroom AI, use AI credits through it, upload within the storage quota; a second person sees
// none of the first one's work; the website's safety limits hold; sign out.
const fs = require('fs');
const path = require('path');
const { check, launch, media, OUT, DATA } = require('../lib.cjs');

const HUB = process.env.CUTROOM_E2E_HUB;
const inPage = (page, url, init = {}) =>
  page.evaluate(
    async ([u, i]) => {
      const r = await fetch(u, i);
      const text = await r.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: r.status, body };
    },
    [url, init],
  );
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const signUp = async (page, email) => {
  await page.goto(HUB, { waitUntil: 'load' });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('website password 1');
  await page.getByRole('button', { name: 'Create account and get free credits' }).click();
  await page.getByText('What are we').waitFor({ timeout: 120000 });
};

(async () => {
  const { browser, page, shot, finish, errors } = await launch('hosted');
  // requests this suite makes fail on purpose log a console error each: expect exactly those
  const expectFailures = async (n, fn) => {
    const before = errors.length;
    await fn();
    const extra = errors.splice(before);
    check(extra.length <= n && extra.every((e) => /Failed to load resource/.test(e)), `only the expected refusals were logged (${extra.length})`);
  };

  // 1) a visitor lands on the sign-up page
  await page.goto(HUB, { waitUntil: 'load' });
  check(new URL(page.url()).pathname === '/signup' && (await page.getByText('Edit YouTube videos with an').isVisible()), 'visitors land on the sign-up page');
  await shot('01-landing');
  const t0 = Date.now();
  await signUp(page, 'web-a@example.com');
  check(true, `after signing up the studio opens (${((Date.now() - t0) / 1000).toFixed(1)}s, a fresh studio started)`);

  // 2) already signed in to Cutroom AI, with the welcome credits
  await page.getByTestId('credit-meter').waitFor({ timeout: 20000 });
  check((await page.getByTestId('credit-meter').getAttribute('data-credits')) === '350', 'the studio is signed in to Cutroom AI with 350 credits');
  const sys = await inPage(page, '/api/system');
  check(sys.body.hosted === true && sys.body.dataDir === '' && sys.body.llm?.providerId === 'cutroom', 'it runs in website mode (no server paths shown), the Director on Cutroom AI');
  await shot('02-studio');

  // 3) AI through the website, billed in credits
  const test = await inPage(page, '/api/settings/test-llm', json({ providerId: 'cutroom', model: 'auto-fast' }));
  check(test.body.ok === true, `an AI request goes through Cutroom AI ("${test.body.reply}")`);
  const cloud = await inPage(page, '/api/cloud');
  check(cloud.body.account?.credits.total < 350, `and costs credits (${cloud.body.account?.credits.total} left)`);

  // 4) a project with media: upload, served with ranges
  const proj = await inPage(page, '/api/projects', json({ name: 'Website project' }));
  const pid = proj.body.id;
  const up = await page.evaluate(
    async ([id, name, b64]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append('file', new Blob([bytes]), name);
      const r = await fetch(`/api/projects/${id}/assets`, { method: 'POST', body: fd });
      return { status: r.status, body: await r.json() };
    },
    [pid, 'photo.png', fs.readFileSync(media('photo.png')).toString('base64')],
  );
  const asset = up.body.assets?.[0];
  check(up.status === 200 && asset, 'uploading works through the website');
  const ranged = await page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { Range: 'bytes=0-9' } });
    return { status: r.status, size: (await r.arrayBuffer()).byteLength };
  }, `/media/${pid}/${encodeURIComponent(asset.file)}`);
  check(ranged.status === 206 && ranged.size === 10, 'media is served with ranges (video seeking works)');
  const onDisk = fs.readdirSync(path.join(DATA, 'web', 'users')).find((u) => fs.existsSync(path.join(DATA, 'web', 'users', u, 'data', 'projects', pid)));
  check(Boolean(onDisk), "the project is stored in this person's own folder");

  // 4b) render on the server (the render bundle goes to the shared cache), 4K stays a desktop feature
  await inPage(page, `/api/projects/${pid}/ops`, json({ ops: [{ op: 'addClip', trackId: 'Main', clip: { id: 'bg', type: 'scene', template: 'title-card', start: 0, duration: 2, props: { title: 'Web' } } }] }));
  const rec = await inPage(page, `/api/projects/${pid}/render`, json({ preset: 'draft' }));
  let done = null;
  for (let i = 0; i < 180 && !done; i++) {
    await page.waitForTimeout(1000);
    const p = (await inPage(page, `/api/projects/${pid}`)).body.project;
    done = p.renders.find((r) => r.id === rec.body.id && ['done', 'error'].includes(r.status)) ?? null;
  }
  check(done?.status === 'done', `a video renders on the website (${done?.status}${done?.error ? `: ${done.error}` : ''})`);
  check(fs.readdirSync(path.join(DATA, 'web', 'shared-cache')).some((d) => d.startsWith('bundle-')), 'the render bundle is shared between studios');
  await expectFailures(1, async () => {
    const k4 = await inPage(page, `/api/projects/${pid}/render`, json({ preset: '4k' }));
    check(k4.status >= 400 && /desktop app/.test(JSON.stringify(k4.body)), '4K renders are left to the desktop app');
  });

  // 5) the website's limits
  await expectFailures(3, async () => {
  const big = await page.evaluate(async (id) => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(35 * 1024 * 1024)]), 'big.bin');
    const r = await fetch(`/api/projects/${id}/assets`, { method: 'POST', body: fd });
    return { status: r.status, text: await r.text() };
  }, pid);
  check(big.status >= 400 && /storage is full/.test(big.text), 'uploads stop at the storage quota');
  const ssrf = await inPage(page, `/api/projects/${pid}/assets/import-url`, json({ url: `${new URL(HUB).origin}/hub/health` }));
  check(ssrf.status >= 400 && /private network/.test(JSON.stringify(ssrf.body)), 'imports from the server’s own network are refused');
  await inPage(page, '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcpServers: { x: { command: 'touch', args: ['/tmp/pwned'] } } }) });
  const settings = await inPage(page, '/api/settings');
  check(Object.keys(settings.body.saved.mcpServers).length === 0, 'MCP servers (which run programs) can’t be added');
  check((await inPage(page, '/mcp', json({}))).status !== 200, 'and the MCP endpoint is off');
  });
  await page.evaluate(() => window.cutroom.store.getState().openSettings('cloud'));
  await page.getByTestId('storage').waitFor({ timeout: 10000 });
  check(/^Storage: [\d.]+ (MB|GB) of 30 MB$/.test(await page.getByTestId('storage').innerText()), `settings show the storage used (${await page.getByTestId('storage').innerText()})`);
  check(!(await page.getByRole('button', { name: 'MCP & integrations' }).isVisible()), 'and no MCP settings');
  const director = page.locator('select').filter({ has: page.locator('option', { hasText: 'Cutroom Auto' }) }).first();
  await director.waitFor({ timeout: 10000 });
  check((await director.inputValue()) === 'auto', 'the Director runs on Cutroom Auto, shown in the model picker');
  await shot('03-settings');
  await page.keyboard.press('Escape');

  // 6) a second person sees nothing of the first one's
  const other = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page2 = await other.newPage();
  await signUp(page2, 'web-b@example.com');
  const list2 = await inPage(page2, '/api/projects');
  check(Array.isArray(list2.body) && !list2.body.some((p) => p.id === pid), "another account doesn't see the first one's projects");
  const peek = await inPage(page2, `/api/projects/${pid}`);
  check(peek.status >= 400, "nor open them by id");
  const health = await (await fetch(`${HUB}/hub/health`)).json();
  check(health.studios === 2, 'each person has their own studio running');
  await other.close();

  // 7) sign out
  await page.goto(`${HUB}/logout`);
  await page.getByRole('button', { name: 'Sign in' }).waitFor({ timeout: 10000 });
  await expectFailures(1, async () => check((await inPage(page, '/api/projects')).status === 401, 'after signing out the studio is closed to this browser'));
  await page.getByLabel('Email').fill('web-a@example.com');
  await page.getByLabel('Password').fill('website password 1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('What are we').waitFor({ timeout: 60000 });
  const back = await inPage(page, '/api/projects');
  check(back.body.some((p) => p.id === pid), 'signing in again brings back the projects');

  fs.mkdirSync(OUT, { recursive: true });
  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});

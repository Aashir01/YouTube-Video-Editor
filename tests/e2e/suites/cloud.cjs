// Cutroom AI: create an account in Settings (free credits), run the Director on it (each AI request
// billed by what it cost), run out of credits, get topped up (a manual payment through the admin
// API), sign out and back in.
const { BASE, api, post, put, ops, check, launch, waitFor, LLM } = require('../lib.cjs');

const CLOUD = process.env.CUTROOM_E2E_CLOUD;
const ADMIN = process.env.CUTROOM_E2E_ADMIN;
const admin = async (p, body) => {
  const r = await fetch(`${CLOUD}/v1/admin/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`admin ${p}: ${r.status} ${await r.text()}`);
  return r.json();
};
const EMAIL = 'creator@example.com';
const PASSWORD = 'correct horse battery';
// what one scripted request costs: 1200 + 80 tokens at the fake's prices, times the markup, rounded up
const PER_REQUEST = Math.ceil(((1200 * 2e-6 + 80 * 8e-6) * 1.15) / 0.001 - 1e-9);

(async () => {
  // another AI is set up already (as most users who switch would have): Cutroom AI is offered, not forced
  const fake = { id: 'fake', type: 'openai-compatible', name: 'Fake LLM', baseUrl: LLM, apiKey: 'test-key', models: ['fake-director'] };
  await put('/api/settings', { llm: { providers: [fake], main: { providerId: 'fake', model: 'fake-director' }, fast: { providerId: 'fake', model: 'fake-director' } } });
  const pid = (await post('/api/projects', { name: 'Cloud e2e', format: 'long' })).id;
  await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'bg', type: 'scene', template: 'title-card', start: 0, duration: 8, props: { title: 'Coffee' } } }]);

  const { page, shot, finish } = await launch('cloud');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="bg"]').waitFor({ timeout: 20000 });
  const meter = page.getByTestId('credit-meter');
  const credits = async () => Number(await meter.getAttribute('data-credits'));
  const refresh = () => page.evaluate(() => window.cutroom.store.getState().refreshCloud());

  // 1) create an account in Settings → Cutroom AI
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'No API key? Use Cutroom AI' }).click();
  await page.getByLabel('Name (optional)').fill('Test Creator');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account and get free credits' }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: /Welcome to Cutroom AI: 350 free credits/ }).waitFor({ timeout: 20000 });
  check((await page.getByTestId('cloud-credits').innerText()) === '350', 'a new account starts with 350 credits (300 welcome + 50 this month)');
  check(await page.getByText('Free plan').isVisible(), 'on the Free plan');
  await shot('01-signed-up');
  let settings = await api('/api/settings');
  check(settings.saved.llm.main.providerId === 'fake', 'signing in does not take over an AI the user set up');

  // 2) use it for the Director
  await page.getByRole('button', { name: 'Use Cutroom AI', exact: true }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: 'The Director now runs on Cutroom AI' }).waitFor({ timeout: 10000 });
  settings = await api('/api/settings');
  const prov = settings.effective.llm.providers.find((p) => p.id === 'cutroom');
  check(settings.saved.llm.main.model === 'auto' && settings.saved.llm.fast.model === 'auto-fast' && settings.saved.llm.main.providerId === 'cutroom', 'the Director runs on Cutroom Auto, small jobs on Cutroom Fast');
  check(prov && prov.baseUrl === `${CLOUD}/v1` && prov.apiKey.startsWith('••••') && settings.saved.cloud.token === '••••' && prov.visionModels.includes('auto'), 'Cutroom AI shows up as a provider (token masked, knows which models see images)');
  const test = await post('/api/settings/test-llm', { providerId: 'cutroom', model: 'auto-fast' });
  check(test.ok && test.reply === 'Fake summary', `the provider answers through the gateway ("${test.reply}")`);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await refresh();
  await meter.waitFor({ timeout: 10000 });
  check((await credits()) === 350 - PER_REQUEST, `the top bar shows the credits left after the test (${await credits()})`);

  // 3) a Director run, billed request by request
  await page.getByRole('button', { name: /^Director/ }).click();
  const composer = page.getByPlaceholder(/Describe what you want/);
  await composer.click();
  await composer.fill('Make a short intro title about coffee');
  await page.keyboard.press('Enter');
  await page.getByText('Which tone should the title have?').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^Bold/ }).first().click();
  await page.getByRole('button', { name: /Send answers/ }).click();
  await page.getByText(/All done: the title is on the Graphics track/).waitFor({ timeout: 30000 });
  // the test request and the run's four: the last is charged when its stream ends, just after the text shows
  const usage = await waitFor(async () => {
    const u = await api('/api/cloud/usage');
    return u.entries.filter((e) => e.kind === 'charge').length >= 5 ? u : null;
  }, 10000, 300);
  const charges = (usage?.entries ?? []).filter((e) => e.kind === 'charge');
  check(charges.length >= 5 && charges.every((e) => e.delta === -PER_REQUEST && e.inputTokens === 1200 && e.outputTokens === 80 && Math.abs(e.costUsd - 0.00304) < 1e-9), `each AI request is charged its cost: ${charges.length} requests at ${PER_REQUEST} credits ($0.00304 upstream each)`);
  check(charges.every((e) => /^auto(-fast)? → /.test(e.model ?? '')), `the ledger names the model (${charges[0]?.model})`);
  const left = await waitFor(async () => ((await credits()) === 350 - PER_REQUEST * charges.length ? credits() : null), 10000, 300);
  check(left === 350 - PER_REQUEST * charges.length, `the meter follows the run (${await credits()} left)`);
  await shot('02-after-run');

  // 4) out of credits: the Director says so, the meter turns red
  await admin('grant', { email: EMAIL, credits: -100000, note: 'e2e: use it all' });
  await refresh();
  await page.getByText('Out of credits').waitFor({ timeout: 10000 });
  await composer.click();
  await composer.fill('Now add a subtitle');
  await page.keyboard.press('Enter');
  await page.getByText(/out of Cutroom AI credits/).first().waitFor({ timeout: 30000 });
  check(true, 'with no credits left the Director explains how to top up');
  await shot('03-out-of-credits');

  // 5) a manual payment (until checkout links exist): Creator plan, 2,000 credits a month
  await admin('purchase', { email: EMAIL, product: 'creator_month', ref: 'e2e-payment-1' });
  const again = await admin('purchase', { email: EMAIL, product: 'creator_month', ref: 'e2e-payment-1' });
  check(again.duplicate === true, 'the same payment reported twice is applied once');
  await refresh();
  await page.waitForFunction(() => document.querySelector('[data-testid="credit-meter"]')?.getAttribute('data-credits') === '2000', null, { timeout: 10000 });
  check(true, 'the Creator plan brings 2,000 credits');
  await page.evaluate(() => window.cutroom.store.getState().openSettings('cloud'));
  await page.getByText('Creator plan').waitFor({ timeout: 10000 });
  check(await page.getByTestId('cloud-usage').getByText(/Bought: Creator, 1 month/).isVisible(), 'recent use lists the purchase');
  check(await page.getByRole('link', { name: /Ask for this/ }).first().isVisible(), 'plans link to the top-up contact while checkout is not set up');
  await shot('04-creator');

  // 6) sign out (the Director goes back to the user's own AI), then sign in again
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('tab', { name: 'Sign in' }).waitFor({ timeout: 10000 });
  settings = await api('/api/settings');
  check(settings.saved.llm.main?.providerId === 'fake' && settings.saved.llm.fast?.providerId === 'fake' && !settings.effective.llm.providers.some((p) => p.id === 'cutroom'), "signing out removes Cutroom AI and gives the Director back the user's own provider");
  await page.getByRole('tab', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('wrong password');
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Wrong email or password').waitFor({ timeout: 10000 });
  await page.getByLabel('Password').fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await page.getByTestId('cloud-credits').waitFor({ timeout: 10000 });
  check((await page.getByTestId('cloud-credits').innerText()) === '2,000', 'signed back in, the account and its credits are there');

  // leave the scripted model in charge for anything after this suite
  await post('/api/cloud/logout');
  await put('/api/settings', { llm: { providers: [fake], main: { providerId: 'fake', model: 'fake-director' }, fast: { providerId: 'fake', model: 'fake-director' } } });
  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});

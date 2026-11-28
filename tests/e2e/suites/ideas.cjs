// Idea radar: search a niche on YouTube (a scripted Data API stands in), rank the videos by how far
// they beat their channel's average, show what their titles share, and turn one into a brief.
const fs = require('fs');
const { BASE, post, put, check, launch, mcpClient, LLM_LOG } = require('../lib.cjs');

const apiCalls = () =>
  fs
    .readFileSync(LLM_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('YTAPI '))
    .map((l) => JSON.parse(l.slice(6)));

(async () => {
  // no key and no channel yet
  await put('/api/settings', { keys: { youtube: '' }, youtube: { clientId: '', clientSecret: '', refreshToken: '', channelTitle: '' } });
  const { page, shot, finish } = await launch('ideas');
  await page.goto(BASE, { waitUntil: 'load' });
  const radar = page.getByTestId('idea-radar');
  await radar.waitFor({ timeout: 20000 });

  // 1) without a key it says how to get one
  await radar.getByLabel('Niche').fill('ai tools');
  await radar.getByRole('button', { name: 'Find ideas' }).click();
  await radar.getByRole('button', { name: 'Add the key' }).waitFor({ timeout: 15000 });
  check(true, 'without a YouTube key the radar explains how to add one');

  // 2) with a Data API key: outliers first
  await put('/api/settings', { keys: { youtube: 'e2e-yt-key' } });
  const before = apiCalls().length;
  await radar.locator('select').first().selectOption('PK');
  await radar.getByRole('button', { name: 'Find ideas' }).click();
  await radar.locator('[data-idea]').first().waitFor({ timeout: 15000 });
  const ids = await radar.locator('[data-idea]').evaluateAll((els) => els.map((e) => e.getAttribute('data-idea')));
  check(ids.join() === 'vid1000,vidNobody,vidHonest,vidBest,vidMic,vidStudio', `ranked by how far each beat its channel (${ids.join(', ')})`);
  check(await radar.locator('[data-idea="vid1000"]').getByText('150×').isVisible(), "a small channel's hit shows as 150× its average");
  check(await radar.locator('[data-idea="vidBest"]').getByText('5×').isVisible(), "a big channel's 500K views is only 5× for it");
  check(await page.getByTestId('idea-patterns').getByText('ai tools').isVisible(), 'the phrase the outliers share is pointed out');
  const calls = apiCalls().slice(before);
  const search = calls.find((c) => c.what === 'search');
  check(search && search.params.key === 'e2e-yt-key' && search.params.regionCode === 'PK' && search.params.q === 'ai tools' && search.params.order === 'viewCount', 'it searches the niche in the chosen country with the key');
  check(calls.some((c) => c.what === 'videos') && calls.some((c) => c.what === 'channels'), 'and looks up the videos and their channels');
  await page.getByTestId('idea-patterns').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot('01-ideas');

  // 3) cached for a day: the same search costs no quota
  const n = apiCalls().length;
  await radar.getByRole('button', { name: 'Find ideas' }).click();
  await page.waitForTimeout(1500);
  check(apiCalls().length === n, 'the same search again comes from the cache');

  // 4) Shorts only
  await radar.getByRole('button', { name: 'Shorts', exact: true }).click();
  await radar.getByRole('button', { name: 'Find ideas' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-idea]').length === 2, null, { timeout: 15000 });
  const shorts = await radar.locator('[data-idea]').evaluateAll((els) => els.map((e) => e.getAttribute('data-idea')));
  check(shorts.join() === 'vidNobody,vidMic', `Shorts only (${shorts.join(', ')})`);

  // 5) use an idea: the brief goes to the prompt box
  await radar.locator('[data-idea="vidNobody"]').getByRole('button', { name: 'Use this idea' }).click();
  const box = page.locator('textarea').first();
  await page.waitForTimeout(600);
  const brief = await box.inputValue();
  check(/"AI tools nobody talks about\?" by Mid Channel got 400K views, 20× that channel's average/.test(brief) && /original Short/.test(brief), 'the idea becomes a brief for an original Short');
  check(await box.evaluate((el) => el === document.activeElement), 'and the prompt box is ready');

  // 6) the Director's tool
  const call = await mcpClient();
  await call('select_project', { projectId: (await post('/api/projects', { name: 'Ideas' })).id });
  const r = await call('find_ideas', { query: 'ai tools', region: 'PK' });
  check(!r.isError && /^1\. 150× "How I made \$1000 with AI tools in 7 days"/m.test(r.text) && /"ai tools" \(4\)/.test(r.text), 'find_ideas gives the Director the same ranking and patterns');

  await put('/api/settings', { keys: { youtube: '' } });
  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});

// Retention coach: score the hook, find where viewers would leave, and fix each in one click
// (slow start, no motion, no words on screen, long pause, filler words, silent ending); the
// Director gets the same report and can apply fixes.
const { BASE, api, post, put, upload, waitReady, waitFor, ops, getProject, clips, check, launch, media, mcpClient, LLM } = require('../lib.cjs');

const SENTENCES = [
  'So I was thinking about some things lately.',
  'Today we are talking about how to grow a small channel from zero.',
  'I tried a lot of things over the last three years of making videos.',
  'Here is the secret that changed everything for my channel last year.',
  'You need to post the same kind of video um every single week on schedule.',
  'Viewers come back when they know exactly what they will get from you.',
  'That consistency built trust and the algorithm noticed it very quickly.',
  'Within six months my views tripled without spending a single dollar.',
  // a long pause comes before this one
  'Let me show you the numbers from my own analytics dashboard right now.',
  'These charts cover every upload I made since the start of the year.',
  'The biggest mistake new creators make is chasing every trend they see.',
  'Instead pick one topic you love and go deeper than anyone else does.',
  'So that is everything I learned and I hope it helps your channel too.',
];
const WORDS = [];
let t = 2.5; // a slow start
SENTENCES.forEach((s, i) => {
  if (i === 8) t += 6;
  for (const w of s.split(' ')) {
    WORDS.push({ text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.3) * 1000) / 1000 });
    t += 0.35;
  }
  t += 0.5;
});

(async () => {
  await put('/api/settings', {
    llm: {
      providers: [{ id: 'fake', type: 'openai-compatible', name: 'Fake LLM', baseUrl: LLM, apiKey: 'test-key', models: ['fake-director'] }],
      main: { providerId: 'fake', model: 'fake-director' },
      fast: { providerId: 'fake', model: 'fake-director' },
    },
  });
  const pid = (await post('/api/projects', { name: 'Coach me', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk-long.mp4'))).id);
  await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'talk', type: 'video', assetId: video.id, start: 0, duration: 100 } }]);
  await put(`/api/projects/${pid}/assets/${video.id}/transcript`, { words: WORDS });

  const { page, shot, finish } = await launch('coach');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="talk"]').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  const score = async () => Number(await page.getByTestId('retention-score').innerText());
  const hook = async () => Number((await page.getByTestId('hook-score').innerText()).split('/')[0]);
  const ok = (id) => page.locator(`[data-check="${id}"]`).getAttribute('data-ok');
  await page.getByTestId('retention-score').waitFor({ timeout: 15000 });
  const [score0, hook0] = [await score(), await hook()];
  check(hook0 <= 3, `a slow, flat opening scores low (${hook0}/10)`);
  check((await ok('talk-now')) === 'false' && (await page.getByText('2.5s before the first word').isVisible()), 'the 2.5 s before the first word is flagged');
  check((await ok('hook-line')) === 'false', 'so is an opening line that promises nothing');
  check(await page.locator('[data-issue="pause"]').getByText(/^6\.\ds pause$/).isVisible(), 'the long pause is found');
  check(await page.locator('[data-issue="filler"]').getByText('1 filler word').isVisible(), 'the filler word too');
  check(await page.locator('[data-issue="ending"]').getByText(/after the last word/).isVisible(), 'and the silence at the end');
  check((await page.locator('[data-issue="static"]').count()) > 0, 'and the shots held too long');
  await shot('01-report');

  const fix = async (name, label) => {
    await page.getByRole('button', { name, exact: true }).first().click();
    await page.locator('[data-sonner-toast]').filter({ hasText: `Fixed: ${label ?? name}` }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
  };

  // 1) the hook, one click each
  await fix('Cut the slow start');
  let p = await getProject(pid);
  const main = clips(p).filter((c) => c.track === 'Main').sort((a, b) => a.start - b.start)[0];
  check(main.start === 0 && Math.abs(main.trimStart - 2.35) < 0.02, `the slow start is cut (the footage now starts at ${main.trimStart}s)`);
  check((await ok('talk-now')) === 'true', 'and the check passes');
  await fix('Punch in at 1s');
  await fix('Add the hook as a title');
  p = await getProject(pid);
  check(clips(p).some((c) => c.type === 'text' && c.start === 0 && /^So I was thinking/.test(c.text)), 'the opening line is on screen as a title');
  check(clips(p).some((c) => c.type === 'video' && c.zooms.some((z) => z.at <= 1.3)), 'a punch-in in the first seconds');
  const hook1 = await hook();
  check(hook1 >= hook0 + 4, `the hook score goes up (${hook0} → ${hook1}/10)`);

  // 2) dead spots
  const before = (await getProject(pid)).tracks.find((x) => x.name === 'Main').clips.reduce((n, c) => n + c.duration, 0);
  await fix('Cut the pause');
  await fix('Remove it');
  await fix('Trim the end');
  p = await getProject(pid);
  const after = p.tracks.find((x) => x.name === 'Main').clips.reduce((n, c) => n + c.duration, 0);
  check(before - after > 15, `the pause, the filler and the silent ending are cut (${before.toFixed(1)}s → ${after.toFixed(1)}s)`);
  check((await page.locator('[data-issue="pause"], [data-issue="filler"]').count()) === 0, 'and they are gone from the report');
  await page.getByRole('button', { name: /^Punch in on all \d+ long shots$/ }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: /Fixed: Punch in on all/ }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  const score1 = await score();
  check(score1 > score0 + 20, `the retention score goes up (${score0} → ${score1})`);
  await shot('02-fixed');

  // 3) every fix is one undo step
  await page.locator('body').click({ position: { x: 800, y: 300 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  check((await page.locator('[data-issue="static"]').count()) > 0, 'one Ctrl+Z brings back the long shots');

  // 4) the Director's tool reads the same report and applies fixes
  const call = await mcpClient();
  await call('select_project', { projectId: pid });
  const r = await call('review_retention', { apply: ['long-shots'] });
  check(!r.isError && /Applied: Punch in on all/.test(r.text) && /Retention score \d+\/100/.test(r.text) && /Hook \(first 15s\)/.test(r.text), 'review_retention reports and fixes the long shots');

  // 5) what needs judgment goes to the Director
  await page.getByRole('button', { name: 'Ask the Director for a stronger hook' }).click();
  await page.getByText(/doesn't hook viewers/).first().waitFor({ timeout: 15000 });
  check(true, 'a weak hook line is handed to the Director with the context');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});

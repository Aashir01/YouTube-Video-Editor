// Shorts autopilot: from found moments, make every Short, render it and upload it to YouTube
// scheduled one a day, best first (a scripted YouTube stands in for Google); stop and retry a run.
const fs = require('fs');
const { BASE, api, post, put, upload, waitReady, waitFor, ops, getProject, check, launch, media, mcpClient, LLM, LLM_LOG } = require('../lib.cjs');

const SENTENCES = [
  'Welcome back to the channel everyone and thanks for being here today.',
  'Today we are talking about how to grow a small channel from zero.',
  'I tried a lot of things over the last three years of making videos.',
  'Here is the secret that changed everything for my channel last year.',
  'You need to post the same kind of video every single week on schedule.',
  'Viewers come back when they know exactly what they will get from you.',
  'That consistency built trust and the algorithm noticed it very quickly.',
  'Within six months my views tripled without spending a single dollar.',
  'Let me show you the numbers from my own analytics dashboard right now.',
  'These charts cover every upload I made since the start of the year.',
  'Some videos did great and some did not do well at all to be honest.',
  'The biggest mistake new creators make is chasing every trend they see.',
  'Trends bring random viewers who never come back to watch the next one.',
  'Instead pick one topic you love and go deeper than anyone else does.',
  'Your audience will follow you because you are the expert on that topic.',
  'It takes longer at first but the growth lasts for years after that.',
  'So that is everything I learned and I hope it helps your channel too.',
  'Thanks for watching and I will see you in the next video very soon.',
];
const WORDS = [];
let t = 0.5;
for (const s of SENTENCES) {
  for (const w of s.split(' ')) {
    WORDS.push({ text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.3) * 1000) / 1000 });
    t += 0.35;
  }
  t += 0.5;
}
const uploads = () =>
  fs
    .readFileSync(LLM_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('YT '))
    .map((l) => JSON.parse(l.slice(3)));

(async () => {
  await put('/api/settings', {
    llm: {
      providers: [{ id: 'fake', type: 'openai-compatible', name: 'Fake LLM', baseUrl: LLM, apiKey: 'test-key', models: ['fake-director'] }],
      main: { providerId: 'fake', model: 'fake-director' },
      fast: { providerId: 'fake', model: 'fake-director' },
    },
    youtube: { clientId: 'e2e-client', clientSecret: 'e2e-secret', refreshToken: 'e2e-refresh', channelTitle: 'Test Channel' },
  });
  const pid = (await post('/api/projects', { name: 'Grow a channel (autopilot)', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk-long.mp4'))).id);
  await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'talk', type: 'video', assetId: video.id, start: 0, duration: 100 } }]);
  await put(`/api/projects/${pid}/assets/${video.id}/transcript`, { words: WORDS });
  const found = await post(`/api/projects/${pid}/moments`, { count: 2 });
  check(found.state.moments.length === 2, `two moments to post (${found.state.moments.map((m) => m.title).join(', ')})`);
  const before = uploads().length;

  const { page, shot, finish } = await launch('autopilot');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="talk"]').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Shorts', exact: true }).click();
  const card = page.getByTestId('autopilot');
  await card.waitFor({ timeout: 10000 });

  // 1) schedule both, one a day from tomorrow at 5 pm (local time)
  check(await card.getByText('Upload to YouTube (Test Channel)').isVisible(), 'with YouTube connected, the autopilot offers to schedule uploads');
  const first = new Date();
  first.setDate(first.getDate() + 1);
  first.setHours(17, 0, 0, 0);
  const p2 = (n) => String(n).padStart(2, '0');
  await card.getByLabel('First one goes public').fill(`${first.getFullYear()}-${p2(first.getMonth() + 1)}-${p2(first.getDate())}T17:00`);
  await card.getByRole('button', { name: 'day', exact: true }).click();
  await shot('01-setup');
  await card.getByRole('button', { name: 'Schedule 2 Shorts' }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: /Autopilot started: 2 Shorts, one every day/ }).waitFor({ timeout: 10000 });
  await card.locator('[data-status="rendering"]').first().waitFor({ timeout: 60000 });
  await shot('02-running');

  const state = await waitFor(async () => {
    const s = await api(`/api/projects/${pid}/autopilot`);
    return s.state?.status === 'done' ? s.state : null;
  }, 15 * 60_000, 2000);
  check(state && state.items.every((i) => i.status === 'scheduled'), `both Shorts made, rendered and scheduled (${state?.items.map((i) => `${i.status}${i.error ? `: ${i.error}` : ''}`).join(', ')})`);
  const [a, b] = state?.items ?? [];
  check(a?.title.startsWith('The secret nobody shares') && b?.title.startsWith('The biggest mistake'), 'the best Short goes first');
  check(a && new Date(a.publishAt).getTime() === first.getTime() && new Date(b.publishAt).getTime() - new Date(a.publishAt).getTime() === 24 * 3600_000, `one a day from the chosen time (${a?.publishAt}, ${b?.publishAt})`);

  // 2) what YouTube received
  const sent = uploads().slice(before);
  const videos = sent.filter((u) => u.kind === 'video');
  check(videos.length === 2 && videos.every((v) => v.status.privacyStatus === 'private' && v.bytes > 50_000), `two videos uploaded as private until their time (${videos.map((v) => `${Math.round(v.bytes / 1000)} kB`).join(', ')})`);
  check(videos.map((v) => v.status.publishAt).join() === state.items.map((i) => i.publishAt).join(), 'each with its publish time');
  check(videos[0]?.snippet.title === a.title && /Here is the secret/.test(videos[0]?.snippet.description) && /#Shorts/.test(videos[0]?.snippet.description), `titled, with the hook and #Shorts ("${videos[0]?.snippet.title}")`);
  check(sent.filter((u) => u.kind === 'captions').length === 2, 'captions uploaded with each');
  const shorts = await Promise.all(state.items.map((i) => getProject(i.shortId)));
  check(shorts.every((s, i) => s.canvas.height > s.canvas.width && s.youtube.uploadedVideoId === state.items[i].videoId && s.renders.some((r) => r.status === 'done')), 'each Short is its own 9:16 project with its render and YouTube id');
  await card.locator('[data-status="scheduled"]').nth(1).waitFor({ timeout: 10000 });
  check((await card.getByRole('link', { name: /YouTube/ }).count()) === 2, 'the card links to both videos');
  await shot('03-scheduled');

  // 3) the Director's tool: a render-only run, stopped, then the rest is offered again
  const call = await mcpClient();
  await call('select_project', { projectId: pid });
  const r = await call('shorts_autopilot', { upload: false });
  check(!r.isError && /rendering only/.test(r.text), 'shorts_autopilot starts a render-only run');
  const stop = await call('shorts_autopilot', { mode: 'stop' });
  check(/Stopping/.test(stop.text), 'and stops it');
  const stopped = await waitFor(async () => {
    const s = await api(`/api/projects/${pid}/autopilot`);
    return s.state?.status === 'stopped' ? s.state : null;
  }, 120_000, 1000);
  check(stopped && stopped.items.some((i) => i.status === 'cancelled'), `the stopped run leaves the rest for later (${stopped?.items.map((i) => i.status).join(', ')})`);
  await card.getByRole('button', { name: 'Retry the rest' }).waitFor({ timeout: 10000 });
  check(true, 'the card offers to run the rest again');

  await put('/api/settings', { youtube: { clientId: '', clientSecret: '', refreshToken: '', channelTitle: '' } });
  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});

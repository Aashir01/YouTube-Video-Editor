// Find Shorts: the AI picks moments from the transcript; play them, make Shorts, notice later edits.
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
// 0.3 s words, 0.05 s apart, half a second between sentences
const WORDS = [];
const BOUNDS = [];
let t = 0.5;
for (const s of SENTENCES) {
  const first = WORDS.length;
  for (const w of s.split(' ')) {
    WORDS.push({ text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.3) * 1000) / 1000 });
    t += 0.35;
  }
  BOUNDS.push([WORDS[first].start, WORDS[WORDS.length - 1].end]);
  t += 0.5;
}
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

(async () => {
  await put('/api/settings', {
    llm: {
      providers: [{ id: 'fake', type: 'openai-compatible', name: 'Fake LLM', baseUrl: LLM, apiKey: 'test-key', models: ['fake-director'] }],
      main: { providerId: 'fake', model: 'fake-director' },
      fast: { providerId: 'fake', model: 'fake-director' },
    },
  });
  const pid = (await post('/api/projects', { name: 'Grow a channel', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk-long.mp4'))).id);
  await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'talk', type: 'video', assetId: video.id, start: 0, duration: 100 } }]);

  const { page, shot, finish } = await launch('moments');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="talk"]').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Shorts', exact: true }).click();

  // 1) without a transcript there is nothing to read
  check(await page.getByText('Finding Shorts needs a transcript').isVisible(), 'without a transcript the tab asks for one');
  check(await page.getByRole('button', { name: /^Find Shorts$/ }).isDisabled(), 'and Find Shorts waits for it');
  await put(`/api/projects/${pid}/assets/${video.id}/transcript`, { words: WORDS });
  await page.getByText('Finding Shorts needs a transcript').waitFor({ state: 'detached', timeout: 15000 });

  // 2) find them: the AI's picks come back snapped to sentences, overlaps and bad picks dropped
  await page.getByPlaceholder(/Look for/).fill('practical tips');
  await page.getByRole('button', { name: /^Find Shorts$/ }).click();
  await page.locator('[data-moment]').first().waitFor({ timeout: 30000 });
  const cards = await page.locator('[data-moment]').count();
  check(cards === 2, `the AI's 4 picks become 2 moments (an overlap and an out-of-range pick are dropped): ${cards}`);
  check(await page.getByText('The secret nobody shares (practical tips)').isVisible(), 'the best moment first, and the "look for" text reached the AI');
  check(await page.getByText('9/10').isVisible() && (await page.getByText('7/10').isVisible()), 'each moment shows its score');
  const { state } = await api(`/api/projects/${pid}/moments`);
  const [m1, m2] = state.moments;
  check(near(m1.start, BOUNDS[3][0] - 0.15) && near(m1.end, BOUNDS[7][1] + 0.275), `the first moment runs from sentence 4 to 8 with a little air (${m1.start}–${m1.end})`);
  check(m1.hook === SENTENCES[3], 'its opening line is the hook sentence');
  check(near(m2.start, BOUNDS[11][0] - 0.15), 'the second starts on "The biggest mistake…"');
  const prompt = fs.readFileSync(LLM_LOG, 'utf8');
  check(/\[3\] \d\d:\d\d\.\d–\d\d:\d\d\.\d Here is the secret/.test(prompt) && prompt.includes('What the creator wants: practical tips'), 'the AI got numbered, timed sentences and the focus');
  await shot('01-moments');

  // 3) play one: the in/out range is set to it and the preview plays it
  await page.getByRole('button', { name: 'Play The secret nobody shares (practical tips)' }).click();
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => {
    const s = window.cutroom.state();
    return { range: s.range, playing: s.playing, time: s.time, loop: s.loopRange };
  });
  check(st.range && near(st.range[0], m1.start, 0.001) && near(st.range[1], m1.end, 0.001) && st.loop, 'Play sets the in/out range to the moment');
  check(st.playing && st.time >= m1.start - 0.05 && st.time < m1.end, `and plays it (${st.time.toFixed(2)}s)`);
  await page.keyboard.press('Space');

  // 4) make a Short from it: a new 9:16, captioned project named after the moment
  await page.getByRole('button', { name: 'Make a Short: The secret nobody shares (practical tips)' }).click();
  await page.getByRole('button', { name: 'Open the Short' }).waitFor({ timeout: 90000 });
  const after = (await api(`/api/projects/${pid}/moments`)).state;
  const short = await getProject(after.moments[0].shortId);
  const len = short.tracks.flatMap((tr) => tr.clips).reduce((n, c) => Math.max(n, c.start + c.duration), 0);
  check(short.name === 'The secret nobody shares (practical tips)' && short.canvas.width === 1080 && short.canvas.height === 1920, `the Short is a 9:16 project named after the moment (${short.canvas.width}×${short.canvas.height})`);
  check(near(len, m1.end - m1.start, 0.1), `it is as long as the moment (${len.toFixed(2)}s)`);
  check(short.tracks.some((tr) => tr.clips.some((c) => c.type === 'captions')), 'and captioned');
  await shot('02-short-made');

  // 5) after an edit that moves the words, the list says it is out of date and refuses stale times
  await ops(pid, [{ op: 'rippleDelete', from: 0, to: 2 }], 'Cut the start');
  await page.getByText(/edited since these moments were found/).waitFor({ timeout: 15000 });
  check(await page.getByRole('button', { name: 'Make a Short: The biggest mistake (practical tips)' }).isDisabled(), 'an edit that moves the words marks the moments out of date');
  const stale = await fetch(`${BASE}/api/projects/${pid}/moments/${m2.id}/short`, { method: 'POST' });
  check(stale.status === 400 && /edited since/.test((await stale.json()).error), 'and the server refuses to cut stale times');
  await page.getByRole('button', { name: 'Find Shorts again' }).click();
  await page.getByText(/edited since these moments were found/).waitFor({ state: 'detached', timeout: 30000 });
  const fresh = (await api(`/api/projects/${pid}/moments`)).state;
  check(near(fresh.moments[0].start, BOUNDS[3][0] - 2 - 0.15), `finding again follows the edit (${fresh.moments[0].start}s)`);
  check(await page.getByRole('button', { name: /Make all 2 Shorts/ }).isVisible(), '"Make all" offers every new moment');

  // 6) the Director's find_shorts (here over MCP) shows up in the open tab
  const call = await mcpClient();
  await call('select_project', { projectId: pid });
  const r = await call('find_shorts', { count: 2, minSeconds: 15, maxSeconds: 30 });
  check(!r.isError && /Found 2 moments/.test(r.text) && /range \[\d+(\.\d+)?, \d+(\.\d+)?\]/.test(r.text), 'find_shorts lists ranked moments with their ranges');
  const viaTool = (await api(`/api/projects/${pid}/moments`)).state;
  check(viaTool.options.maxSec === 30 && viaTool.createdAt !== fresh.createdAt, 'and saves them');
  await page.getByText('The secret nobody shares', { exact: true }).waitFor({ timeout: 10000 });
  check(true, 'the open Shorts tab updates live');
  await shot('03-from-the-director');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});

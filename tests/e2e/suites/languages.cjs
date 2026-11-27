// Subtitles in other languages: translate, download, show in the captions, keep in sync after edits,
// write them with renders, and make a dubbed version (the scripted model translates and "speaks").
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
const requests = () =>
  fs
    .readFileSync(LLM_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('REQ '))
    .map((l) => JSON.parse(l.slice(4)));
const translationRequests = () => requests().filter((r) => typeof r.lastUser === 'string' && r.lastUser.includes('Translate each numbered subtitle line'));
const numbered = (prompt) => (prompt.match(/^\d+\. /gm) ?? []).length;

(async () => {
  await put('/api/settings', {
    llm: {
      providers: [{ id: 'fake', type: 'openai-compatible', name: 'Fake LLM', baseUrl: LLM, apiKey: 'test-key', models: ['fake-director'] }],
      main: { providerId: 'fake', model: 'fake-director' },
      fast: { providerId: 'fake', model: 'fake-director' },
    },
    // voices for the dubbed version come from the scripted model's /audio/speech
    keys: { openai: 'test-key' },
    speech: { tts: 'openai', autoTranscribe: false },
  });
  const pid = (await post('/api/projects', { name: 'Grow a channel', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk-long.mp4'))).id);
  await put(`/api/projects/${pid}/assets/${video.id}/transcript`, { words: WORDS });
  await ops(pid, [
    { op: 'addClip', trackId: 'Main', clip: { id: 'talk', type: 'video', assetId: video.id, start: 0, duration: 40 } },
    { op: 'addClip', trackId: 'Captions', clip: { id: 'cap', type: 'captions', mode: 'auto', start: 0, duration: 40 } },
    { op: 'setYoutube', patch: { title: 'How to grow a small channel', description: 'Everything I learned in three years.' } },
  ]);

  const { page, shot, finish } = await launch('languages');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="talk"]').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /^Export$/ }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();

  // 1) add Spanish: every sentence and the YouTube title/description get translated
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Add a language…' }) }).selectOption('es');
  await shot('00-before-add');
  await page.getByRole('button', { name: 'Add and translate' }).click();
  const es = page.locator('[data-language="es"]');
  await es.getByText('Up to date').waitFor({ timeout: 30000 });
  let tr = await api(`/api/projects/${pid}/translations`);
  const table = tr.state.table.es;
  check(Object.keys(table).length === SENTENCES.length && table[SENTENCES[3]] === `[es] ${SENTENCES[3]}`, `every sentence translated (${Object.keys(table).length} of ${SENTENCES.length})`);
  check(tr.state.meta?.es?.title === '[es] How to grow a small channel', `the YouTube title too ("${tr.state.meta?.es?.title}")`);
  await shot('01-languages');

  // 2) the subtitle file of the current edit
  const srt = await (await fetch(`${BASE}/api/projects/${pid}/subtitles/es.srt`)).text();
  check(/^1\n00:00:00,500 --> /.test(srt) && srt.includes('[es] Welcome back'), 'the Spanish SRT starts with the first sentence, on time');

  // 3) show it in the captions: the preview shows the translation
  await es.getByRole('button', { name: 'Show in captions' }).click();
  await page.waitForTimeout(500);
  check((await getProject(pid)).tracks.flatMap((x) => x.clips).find((c) => c.id === 'cap')?.language === 'es', 'the captions clip shows Spanish');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.cutroom.seek(1));
  await page.waitForTimeout(800);
  const shown = await page.locator('[data-clip-kind="captions"]').first().textContent();
  check(/\[es\]/.test(shown ?? ''), `the preview captions are the translation ("${(shown ?? '').trim()}")`);
  await shot('02-captions-in-spanish');

  // 4) an edit changes one sentence: only that one is translated again
  const before = translationRequests().length;
  await ops(pid, [{ op: 'rippleDelete', from: 21, to: 22 }], 'Cut a few words');
  await page.getByRole('button', { name: /^Export$/ }).click();
  await page.getByRole('button', { name: 'Languages', exact: true }).click();
  await es.getByRole('button', { name: 'Translate 1 new sentence' }).click();
  await es.getByText('Up to date').waitFor({ timeout: 30000 });
  const sent = translationRequests().slice(before);
  check(sent.length === 1 && numbered(sent[0].lastUser) === 1, `after the edit only the changed sentence went to the AI (${sent.map((r) => numbered(r.lastUser)).join(', ')} line)`);

  // 5) renders write a subtitle file per language
  const render = await post(`/api/projects/${pid}/render`, { preset: 'draft', range: [0, 6] });
  const done = await waitFor(async () => (await getProject(pid)).renders.find((r) => r.id === render.id && (r.status === 'done' || r.status === 'error')), 240000, 1500);
  check(done?.status === 'done' && done.subtitles?.includes('es'), `the render lists its Spanish subtitles (${done?.status}, ${JSON.stringify(done?.subtitles)})`);
  const renderSrt = await (await fetch(`${BASE}/renders/${pid}/${done.file.replace(/\.mp4$/, '.es.srt')}`)).text();
  check(renderSrt.includes('[es] Welcome back'), 'and writes it next to the video');

  // 6) a dubbed version: a new project, each line voiced where it was said
  await es.getByRole('button', { name: 'Dubbed version…' }).click();
  await es.getByRole('button', { name: 'Make the Spanish version' }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Dubbed version ready' }).first().waitFor({ timeout: 120000 });
  const list = await api('/api/projects');
  const dubId = list.find((x) => x.name === 'Grow a channel (Spanish)')?.id;
  const dub = await getProject(dubId);
  const dubTrack = dub.tracks.find((x) => x.name === 'Dub (Spanish)');
  const voices = dubTrack?.clips ?? [];
  check(voices.length >= 6 && Math.abs(voices[0].start - 0.5) < 0.01, `the dub has ${voices.length} voiced lines, the first where the first sentence was said`);
  check(voices.every((c, i) => i === 0 || c.start >= voices[i - 1].start + voices[i - 1].duration - 0.001), 'the lines never overlap');
  const original = dub.tracks.flatMap((x) => x.clips).find((c) => c.type === 'video');
  check(Math.abs(original.volume - 0.12) < 0.01, 'the original voice is lowered under the dub');
  const dubCaptions = dub.tracks.flatMap((x) => x.clips).find((c) => c.type === 'captions');
  check(dubCaptions?.mode === 'manual' && dubCaptions.words[0]?.text === '[es]', 'its captions are the Spanish subtitles');
  check(dub.youtube.title === '[es] How to grow a small channel' && dub.brief.language === 'es', 'and its YouTube title is translated');
  const tts = fs.readFileSync(LLM_LOG, 'utf8').split('\n').filter((l) => l.startsWith('TTS ')).length;
  check(tts === voices.length, `one voice request per line (${tts})`);
  await shot('03-dub-made');

  // 7) the Director (here over MCP) adds a language; the open tab updates; then remove it
  const call = await mcpClient();
  await call('select_project', { projectId: pid });
  const r = await call('translate_subtitles', { languages: ['pt'], metadata: false });
  check(!r.isError && /Subtitles are ready in Portuguese/.test(r.text), 'translate_subtitles adds Portuguese');
  await page.locator('[data-language="pt"]').getByText('Up to date').waitFor({ timeout: 10000 });
  check(true, 'the open Languages tab shows it live');
  await page.getByRole('button', { name: 'Remove Portuguese' }).click();
  await page.locator('[data-language="pt"]').waitFor({ state: 'detached', timeout: 10000 });
  tr = await api(`/api/projects/${pid}/translations`);
  check(tr.state.languages.join(',') === 'es' && !tr.state.table.pt, 'removing a language drops its subtitles');

  await put('/api/settings', { keys: { openai: '' }, speech: { tts: 'auto', autoTranscribe: false } });
  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});

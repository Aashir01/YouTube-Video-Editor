// Full agent session against the scripted fake LLM: plan, question card, edits, final reply.
const fs = require('fs');
const path = require('path');
const { BASE, api, post, put, ops, getProject, clips, check, launch, LLM, LLM_LOG } = require('../lib.cjs');

(async () => {
  await put('/api/settings', {
    llm: {
      providers: [{ id: 'fake', type: 'openai-compatible', name: 'Fake LLM', baseUrl: LLM, apiKey: 'test-key', models: ['fake-director'] }],
      main: { providerId: 'fake', model: 'fake-director' },
      fast: { providerId: 'fake', model: 'fake-director' },
    },
  });
  const tools = await api('/api/agent/tools');
  check(tools.length >= 42 && tools.some((t) => t.name === 'enhance_audio') && tools.some((t) => t.name === 'create_short'), `agent tools registered (${tools.length}), including enhance_audio and create_short`);

  const pid = (await post('/api/projects', { name: 'Agent e2e', format: 'long' })).id;
  await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'bg', type: 'scene', template: 'title-card', start: 0, duration: 8, props: { title: 'Coffee' } } }]);

  const { page, shot, finish } = await launch('agent');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="bg"]').waitFor({ timeout: 20000 });
  await page.evaluate(() => window.cutroom.store.setState({ range: [1, 4] }));
  await page.getByRole('button', { name: /^Director/ }).click();
  const composer = page.getByPlaceholder(/Describe what you want/);
  await composer.click();
  await composer.fill('Make a short intro title about coffee');
  await page.keyboard.press('Enter');

  await page.getByText('Which tone should the title have?').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
  await shot('01-question');
  await page.getByRole('button', { name: /^Calm/ }).first().click();
  await page.getByRole('button', { name: /Send answers/ }).click();
  await page.getByText(/All done: the title is on the Graphics track/).waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await shot('02-done');

  const p = await getProject(pid);
  const t = clips(p).find((c) => c.type === 'text');
  check(t && t.text === 'Calm title from the agent' && t.track === 'Graphics', `agent added the title using the answer: "${t?.text}" on ${t?.track}`);
  check(p.markers.some((m) => m.label === 'Agent: check the title'), 'agent left a review marker');
  const body = await page.locator('body').innerText();
  check(/Timeline check OK/.test(body), 'agent read the timeline back (get_timeline saw the title)');
  check(/Ask about the tone/.test(body) && /Check the timeline/.test(body), 'plan checklist shown');

  const logText = fs.readFileSync(LLM_LOG, 'utf8');
  check(/In\/out range: 00:01\.00–00:04\.00 \(3\.00s\)/.test(logText), 'editor context sent the in/out range to the model');
  // undo the agent's edit from the UI in one step
  await page.locator('body').click({ position: { x: 5, y: 450 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  const p2 = await getProject(pid);
  check(!clips(p2).some((c) => c.type === 'text'), "one Ctrl+Z undoes the agent's batch edit");
  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});

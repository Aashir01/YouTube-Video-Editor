#!/usr/bin/env node
// End-to-end tests in a real browser: starts Cutroom on a temporary data folder next to a scripted
// AI model, runs the suites one after another and prints a summary.
//
//   npm run test:e2e                     all suites
//   npm run test:e2e -- canvas shorts    some suites
//   npm run test:e2e -- --keep           keep the temporary data folder for inspection
//
// Needs FFmpeg (for the fixtures) and Playwright's Chromium (`npx playwright install chromium`).
// Set CUTROOM_E2E_CHROME to use another Chrome/Chromium binary.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const ALL = ['canvas', 'timeline', 'transcript', 'record', 'palette', 'shorts', 'moments', 'languages', 'agent', 'keyframes', 'reframe', 'tracking', 'background', 'footage', 'multicam', 'proxies', 'cloud'];
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const picked = args.filter((a) => !a.startsWith('--'));
const unknown = picked.filter((s) => !ALL.includes(s));
if (unknown.length) {
  console.error(`Unknown suite(s): ${unknown.join(', ')}. Suites: ${ALL.join(', ')}`);
  process.exit(2);
}
const suites = picked.length ? picked : ALL;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const waitHealthy = async (url, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

// 1) fixtures
const fixtures = path.join(here, '.fixtures');
if (spawnSync(process.execPath, [path.join(here, 'fixtures.mjs'), fixtures], { stdio: 'inherit' }).status !== 0) process.exit(1);

// 2) a throwaway data folder: no automatic transcription (it would download speech models)
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-e2e-'));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ speech: { autoTranscribe: false } }, null, 2));
const out = path.join(here, '.out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 3) the scripted model, Cutroom Cloud (accounts and credits, billing the scripted model) and the app
const [port, llmPort, cloudPort] = [await freePort(), await freePort(), await freePort()];
const cloudBase = `http://127.0.0.1:${cloudPort}`;
const ADMIN = 'e2e-admin-token';
const base = `http://127.0.0.1:${port}`;
const llmLog = path.join(out, 'fake-llm.log');
const children = [];
const llm = spawn(process.execPath, [path.join(here, 'fake-llm.cjs')], { env: { ...process.env, FAKE_LLM_PORT: String(llmPort), FAKE_LLM_LOG: llmLog }, stdio: 'ignore' });
children.push(llm);
const cloudLog = fs.openSync(path.join(out, 'cloud.log'), 'a');
const cloud = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', path.join(root, 'src', 'cloud', 'main.ts')], {
  cwd: root,
  env: { ...process.env, CLOUD_PORT: String(cloudPort), CLOUD_HOST: '127.0.0.1', CLOUD_DB: path.join(data, 'cloud', 'cloud.db'), OPENROUTER_BASE_URL: `http://127.0.0.1:${llmPort}/v1`, OPENROUTER_API_KEY: 'fake-upstream-key', ADMIN_TOKEN: ADMIN, CONTACT_URL: 'https://example.com/top-up' },
  stdio: ['ignore', cloudLog, cloudLog],
});
children.push(cloud);
const serverLog = fs.openSync(path.join(out, 'server.log'), 'a');
const server = spawn(process.execPath, [path.join(root, 'bin', 'director.mjs'), 'start', '--port', String(port), '--no-open'], {
  cwd: root,
  // OpenAI voices (and any other OpenAI SDK call) go to the scripted model too, never to the real API
  env: { ...process.env, DIRECTOR_DATA_DIR: data, OPENAI_BASE_URL: `http://127.0.0.1:${llmPort}/v1`, CUTROOM_CLOUD_URL: cloudBase },
  stdio: ['ignore', serverLog, serverLog],
});
children.push(server);
const stop = () => {
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
};
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});

let exitCode = 0;
try {
  console.log(`Starting Cutroom on ${base} (data: ${data})…`);
  if (!(await waitHealthy(`${base}/api/health`, 180_000))) throw new Error(`The app did not start; see ${path.join(out, 'server.log')}`);
  if (!(await waitHealthy(`${cloudBase}/v1/health`, 60_000))) throw new Error(`Cutroom Cloud did not start; see ${path.join(out, 'cloud.log')}`);

  // 4) the suites, one after another
  const results = [];
  for (const name of suites) {
    console.log(`\n━━ ${name} ━━`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(here, 'suites', `${name}.cjs`)], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20 * 60_000,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        CUTROOM_E2E_BASE: base,
        CUTROOM_E2E_FIXTURES: fixtures,
        CUTROOM_E2E_OUT: path.join(out, name),
        CUTROOM_E2E_DATA: data,
        CUTROOM_E2E_LLM: `http://127.0.0.1:${llmPort}/v1`,
        CUTROOM_E2E_LLM_LOG: llmLog,
        CUTROOM_E2E_CLOUD: cloudBase,
        CUTROOM_E2E_ADMIN: ADMIN,
      },
    });
    process.stdout.write(r.stdout ?? '');
    const passed = (r.stdout?.match(/^PASS:/gm) ?? []).length;
    const failed = (r.stdout?.match(/^FAIL:/gm) ?? []).length;
    results.push({ name, ok: r.status === 0 && failed === 0, passed, failed, secs: Math.round((Date.now() - t0) / 1000) });
  }

  // 5) summary
  console.log('\n━━ summary ━━');
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(11)} ${String(r.passed).padStart(3)} passed${r.failed ? `, ${r.failed} failed` : ''}  (${r.secs}s)`);
  const total = results.reduce((n, r) => n + r.passed, 0);
  const bad = results.filter((r) => !r.ok);
  console.log(bad.length ? `\n${bad.length} suite(s) failed. Screenshots and logs: ${out}` : `\nAll ${results.length} suites passed (${total} checks). Screenshots: ${out}`);
  exitCode = bad.length ? 1 : 0;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  stop();
  if (keep) console.log(`Kept the data folder: ${data}`);
  else fs.rmSync(data, { recursive: true, force: true });
}
process.exit(exitCode);

// Shared helpers for the end-to-end suites. Paths and ports come from the runner (tests/e2e/run.mjs).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.env.CUTROOM_E2E_BASE || 'http://127.0.0.1:3333';
/** fixture media (see fixtures.mjs) */
const FIX = process.env.CUTROOM_E2E_FIXTURES || path.join(__dirname, '.fixtures');
/** the server's data folder (DIRECTOR_DATA_DIR) */
const DATA = process.env.CUTROOM_E2E_DATA || '';
/** screenshots and logs of this suite */
const OUT = process.env.CUTROOM_E2E_OUT || path.join(__dirname, '.out', 'adhoc');
/** the scripted OpenAI-compatible model (fake-llm.cjs) */
const LLM = process.env.CUTROOM_E2E_LLM || 'http://127.0.0.1:4590/v1';
const LLM_LOG = process.env.CUTROOM_E2E_LLM_LOG || path.join(__dirname, '.out', 'fake-llm.log');
const ROOT = path.resolve(__dirname, '..', '..');

const api = async (p, init = {}) => {
  const res = await fetch(BASE + p, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return body;
};
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body ?? {}) });
const put = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body ?? {}) });

const upload = async (pid, file) => {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const res = await fetch(`${BASE}/api/projects/${pid}/assets`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload failed ${res.status}`);
  return (await res.json()).assets[0];
};

const waitReady = async (pid, assetId, ms = 90000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { project } = await api(`/api/projects/${pid}`);
    const a = project.assets.find((x) => x.id === assetId);
    if (a && a.status !== 'processing') return a;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('asset not ready');
};

const waitFor = async (fn, ms = 120000, every = 700) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  return null;
};

const ops = (pid, list, label) => post(`/api/projects/${pid}/ops`, { ops: list, label });
const getProject = async (pid) => (await api(`/api/projects/${pid}`)).project;
const clips = (p) => p.tracks.flatMap((t) => t.clips.map((c) => ({ ...c, track: t.name })));
const media = (name) => path.join(FIX, name);

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

const loadPlaywright = () => {
  for (const id of ['playwright', 'playwright-core']) {
    try {
      return require(id);
    } catch {
      /* next */
    }
  }
  throw new Error('The browser tests need Playwright: run `npm install`, then `npx playwright install chromium`.');
};

/** A Chromium page with fake camera/microphone, collecting console errors. */
const launch = async (name) => {
  const outDir = path.join(OUT, name);
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    ...(process.env.CUTROOM_E2E_CHROME ? { executablePath: process.env.CUTROOM_E2E_CHROME } : {}),
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['microphone', 'camera'] });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  const shot = async (n) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, `${n}.png`) });
  };
  const finish = async () => {
    console.log('--- console errors/warnings ---');
    for (const e of errors) console.log(e);
    check(errors.length === 0, `no browser console errors (${errors.length})`);
    await browser.close();
    console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASSED');
    process.exitCode = failures ? 1 : 0;
  };
  return { browser, page, shot, finish, errors };
};

/** Finish a suite that has no browser part. */
const done = () => {
  console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASSED');
  process.exitCode = failures ? 1 : 0;
};

/** Minimal MCP client over Streamable HTTP: call(name, args) -> { isError, text, images }. */
const mcpClient = async () => {
  const H = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const init = await fetch(`${BASE}/mcp`, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } }) });
  const sid = init.headers.get('mcp-session-id');
  await init.text();
  const h2 = { ...H, 'mcp-session-id': sid, 'mcp-protocol-version': '2025-06-18' };
  await fetch(`${BASE}/mcp`, { method: 'POST', headers: h2, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  let id = 10;
  return async (name, args) => {
    const r = await fetch(`${BASE}/mcp`, { method: 'POST', headers: h2, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
    const raw = await r.text();
    const m = /data: (\{.*\})/.exec(raw);
    const res = JSON.parse(m ? m[1] : raw).result;
    return { isError: Boolean(res.isError), text: (res.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n'), images: (res.content ?? []).filter((x) => x.type === 'image') };
  };
};

const ffmpegBin = () => process.env.FFMPEG_PATH || 'ffmpeg';

/** RGB of one pixel of an image file (x, y as fractions), read with FFmpeg. */
const pixel = (file, fx, fy) => {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
  const [w, h] = probe.split(',').map(Number);
  const x = Math.min(w - 1, Math.round(fx * w));
  const y = Math.min(h - 1, Math.round(fy * h));
  const buf = execFileSync(ffmpegBin(), ['-v', 'error', '-i', file, '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  return [buf[0], buf[1], buf[2]];
};

/** Faces found by the app's own detector in image files (checks what the renderer produced). */
const facesIn = (files, size) => {
  const raw = execFileSync(process.execPath, ['--import', 'tsx', path.join(__dirname, 'detect-faces.ts'), JSON.stringify({ files, size })], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(raw.split('RESULT')[1]);
};

module.exports = { BASE, FIX, DATA, OUT, LLM, LLM_LOG, ROOT, api, post, put, upload, waitReady, waitFor, ops, getProject, clips, media, check, launch, done, mcpClient, pixel, facesIn };

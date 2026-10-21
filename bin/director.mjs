#!/usr/bin/env node
// Director Studio CLI: start | dev | mcp | build | doctor | help
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'start';
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 19)) {
  console.error(`Director Studio needs Node.js 20.19+ (you have ${process.versions.node}). Install the LTS from https://nodejs.org`);
  process.exit(1);
}

register();
const importTs = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const newestMtime = (dir) => {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
};

const ensureWebBuild = () => {
  const index = path.join(root, 'dist', 'web', 'index.html');
  const stale = !fs.existsSync(index) || newestMtime(path.join(root, 'src', 'web')) > fs.statSync(index).mtimeMs || newestMtime(path.join(root, 'src', 'remotion')) > fs.statSync(index).mtimeMs;
  if (!stale) return;
  console.log('Building the editor UI (first run or after an update)…');
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('UI build failed.');
    process.exit(1);
  }
};

const help = () => {
  console.log(`Director Studio — agentic YouTube video editor

Usage: director <command> [options]

  start            Build the UI if needed and start the studio (default)
                   --port 3333  --host 127.0.0.1  --no-open
  dev              Start with hot reload (for development)
  mcp              Run as an MCP server over stdio (for Claude Desktop/Code, Cursor)
  build            Build the editor UI
  doctor           Check FFmpeg, browser, AI providers and optional local models
  help             Show this help

MCP (HTTP): while the studio runs, connect any MCP client to http://localhost:3333/mcp
  claude mcp add --transport http director-studio http://localhost:3333/mcp`);
};

switch (cmd) {
  case 'start': {
    ensureWebBuild();
    const { startServer } = await importTs('src/server/main.ts');
    await startServer({ port: opt('--port') ? Number(opt('--port')) : undefined, host: opt('--host'), open: !flag('--no-open') });
    break;
  }
  case 'dev': {
    const { startServer } = await importTs('src/server/main.ts');
    await startServer({ dev: true, port: opt('--port') ? Number(opt('--port')) : undefined, open: flag('--open') });
    break;
  }
  case 'mcp': {
    const { runStdio } = await importTs('src/server/mcp/stdio.ts');
    await runStdio(opt('--port') ? Number(opt('--port')) : undefined);
    break;
  }
  case 'build':
    ensureWebBuild();
    break;
  case 'doctor': {
    const { runDoctor } = await importTs('src/server/doctor.ts');
    process.exitCode = await runDoctor();
    break;
  }
  default:
    help();
}

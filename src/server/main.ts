import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getRequestListener } from '@hono/node-server';
import type { ViteDevServer } from 'vite';
import { APP_ROOT, DATA_DIR } from './config';
import { createApp } from './app';
import { setServerOrigin, warmup } from './render/render';
import { ffInfo } from './media/ffmpeg';
import { installAgentRoutes } from './routes/agent';
import { installMcpRoutes } from './mcp/http';
import { installYouTubeRoutes } from './routes/youtube';
import { mcpManager } from './mcp/client';

export interface StartOptions {
  dev?: boolean;
  port?: number;
  host?: string;
  open?: boolean;
  quiet?: boolean;
}

const BACKEND_PREFIXES = ['/api', '/media', '/renders', '/mcp'];

const openBrowser = (url: string) => {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* no browser available (e.g. headless server) */
  }
};

const listen = (server: http.Server, port: number, host: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE' && port < 65000) resolve(listen(server, port + 1, host));
      else reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

export const startServer = async (opts: StartOptions = {}) => {
  const dev = opts.dev ?? false;
  const host = opts.host ?? process.env.HOST ?? '127.0.0.1';
  const app = createApp({
    dev,
    extraRoutes: (a) => {
      installAgentRoutes(a);
      installMcpRoutes(a);
      installYouTubeRoutes(a);
    },
  });
  const honoListener = getRequestListener(app.fetch);
  let vite: ViteDevServer | undefined;
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (vite && !BACKEND_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`))) {
      vite.middlewares(req, res, () => void honoListener(req, res));
      return;
    }
    void honoListener(req, res);
  });
  server.requestTimeout = 0; // long uploads/renders
  server.headersTimeout = 120_000;
  if (dev) {
    const { createServer } = await import('vite');
    vite = await createServer({
      configFile: path.join(APP_ROOT, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
  }
  const port = await listen(server, opts.port ?? Number(process.env.PORT ?? 3333), host);
  const origin = `http://127.0.0.1:${port}`;
  setServerOrigin(origin);
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host === '127.0.0.1' ? 'localhost' : host}:${port}`;
  if (!opts.quiet) {
    const f = ffInfo();
    console.log(`\n  🎬 Cutroom is running → ${url}\n`);
    console.log(`     MCP endpoint: ${url}/mcp`);
    console.log(`     Data folder:  ${DATA_DIR}`);
    console.log(`     FFmpeg:       ${f.available ? `${f.source}${f.full ? '' : ' (bundled build: scene detection/denoise disabled)'}` : 'NOT FOUND'}\n`);
  }
  if (!process.env.DIRECTOR_NO_WARMUP) warmup();
  void mcpManager.sync();
  if (opts.open) openBrowser(url);
  return { server, port, url, close: () => new Promise<void>((r) => server.close(() => r())) };
};

// Run directly: `tsx src/server/main.ts [--dev] [--port 3333] [--open]`
const isDirect = process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, '') === path.resolve(import.meta.filename).replace(/\.ts$/, '');
if (isDirect) {
  const argv = process.argv.slice(2);
  const portIdx = argv.indexOf('--port');
  startServer({
    dev: argv.includes('--dev'),
    port: portIdx >= 0 ? Number(argv[portIdx + 1]) : undefined,
    host: argv.includes('--host') ? argv[argv.indexOf('--host') + 1] : undefined,
    open: argv.includes('--open'),
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

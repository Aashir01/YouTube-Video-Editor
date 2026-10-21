import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { APP_ROOT } from './config';
import { api, media } from './routes/api';

export interface AppOptions {
  dev: boolean;
  extraRoutes?: (app: Hono) => void;
}

export const createApp = (opts: AppOptions): Hono => {
  const app = new Hono();
  app.route('/api', api);
  app.route('/', media);
  opts.extraRoutes?.(app);
  if (!opts.dev) {
    const webRoot = path.join(APP_ROOT, 'dist', 'web');
    const rel = path.relative(process.cwd(), webRoot) || '.';
    app.use('/*', serveStatic({ root: rel }));
    // SPA fallback
    app.get('*', (c) => {
      const index = path.join(webRoot, 'index.html');
      if (!fs.existsSync(index)) return c.text('The editor UI has not been built yet. Run `npm run build` (or `npm start`, which builds it for you).', 503);
      return c.html(fs.readFileSync(index, 'utf8'));
    });
  }
  return app;
};

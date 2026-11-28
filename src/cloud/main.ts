/**
 * Cutroom Cloud: accounts, credits and the AI gateway, as its own server (npm run cloud).
 * Needs Node 22.5+ (built-in SQLite). Settings: see config.ts.
 */
import { serve } from '@hono/node-server';
import { loadCatalog } from './catalog';
import { loadCloudConfig } from './config';
import { createCloudApp } from './app';
import { Ledger } from './ledger';

const cfg = loadCloudConfig();
const catalog = loadCatalog(cfg.modelsFile);
const ledger = new Ledger(cfg.db, cfg);
const app = createCloudApp({ cfg, ledger, catalog });

if (!cfg.upstreamKey) console.warn('[cloud] OPENROUTER_API_KEY is not set: AI requests will fail until it is');
if (!cfg.adminToken) console.warn('[cloud] ADMIN_TOKEN is not set: the admin endpoints (grants, plans, manual payments) are off');

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
  console.log(`Cutroom Cloud on http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${info.port} (${catalog.length} models, upstream ${new URL(cfg.upstreamUrl).host}, db ${cfg.db})`);
});

const stop = () => {
  server.close();
  ledger.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

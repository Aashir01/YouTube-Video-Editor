/**
 * The Cutroom website (npm run hub): sign-in, and one private studio per person.
 * Needs Node 22.5+ and a running Cutroom Cloud (CLOUD_URL). Settings: see config.ts.
 */
import path from 'node:path';
import { loadHubConfig } from './config';
import { createHub } from './server';
import { Sessions } from './sessions';

const cfg = loadHubConfig();
const sessions = new Sessions(path.join(cfg.data, 'sessions.db'));
const { server, studios } = createHub({ cfg, sessions });
studios.startReaper();

server.listen(cfg.port, cfg.host, () => {
  console.log(`Cutroom website on http://${cfg.host}:${cfg.port} (Cloud ${cfg.cloudUrl}, data ${cfg.data}, up to ${cfg.maxApps} studios)`);
});

const stop = async () => {
  await studios.stopAll();
  server.close();
  sessions.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

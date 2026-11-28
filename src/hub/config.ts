/**
 * The Cutroom website (web hub) settings, from the environment or .env.hub next to the app.
 *
 *   HUB_PORT, HUB_HOST          where the hub listens (default 127.0.0.1:8080, behind Caddy)
 *   HUB_DATA                    users' folders, sessions and shared caches (default data/web)
 *   CLOUD_URL                   Cutroom Cloud for sign-in and AI (default http://127.0.0.1:8787, same server)
 *   TRUST_PROXY                 read client addresses from X-Forwarded-For (behind Caddy)
 *   HUB_MAX_APPS                most studios running at once (default 40)
 *   HUB_IDLE_MINUTES            stop a studio this long after its last use, unless it is busy (default 20)
 *   STORAGE_FREE_MB             storage on the free plan (default 3000)
 *   STORAGE_CREATOR_MB          storage on Creator (default 30000)
 *   MAX_UPLOAD_MB               largest single upload (default 4096)
 *   RENDER_CONCURRENCY          frames each render works on at once (default 2)
 *   STUDIO_MEMORY_MB            memory each studio's Node process may use (default 3072)
 *   YOUTUBE_API_KEY             optional: a Data API key every studio's idea radar may use
 */
import fs from 'node:fs';
import path from 'node:path';

export const APP_ROOT = path.resolve(import.meta.dirname, '..', '..');

try {
  const envFile = path.join(APP_ROOT, process.env.HUB_ENV_FILE || '.env.hub');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
} catch {
  /* ignore malformed .env.hub */
}

const num = (env: NodeJS.ProcessEnv, name: string, fallback: number) => {
  const v = Number(env[name]);
  return env[name]?.trim() && Number.isFinite(v) ? v : fallback;
};

export interface HubConfig {
  port: number;
  host: string;
  data: string;
  cloudUrl: string;
  trustProxy: boolean;
  maxApps: number;
  idleMinutes: number;
  storageFreeMb: number;
  storageCreatorMb: number;
  maxUploadMb: number;
  renderConcurrency: number;
  youtubeApiKey: string;
  /** how long to wait for a studio to start */
  startTimeoutMs: number;
}

export const loadHubConfig = (env: NodeJS.ProcessEnv = process.env): HubConfig => ({
  port: num(env, 'HUB_PORT', 8080),
  host: env.HUB_HOST || '127.0.0.1',
  data: path.resolve(env.HUB_DATA || path.join(APP_ROOT, 'data', 'web')),
  cloudUrl: (env.CLOUD_URL || 'http://127.0.0.1:8787').replace(/\/+$/, ''),
  trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY ?? ''),
  maxApps: num(env, 'HUB_MAX_APPS', 40),
  idleMinutes: num(env, 'HUB_IDLE_MINUTES', 20),
  storageFreeMb: num(env, 'STORAGE_FREE_MB', 3000),
  storageCreatorMb: num(env, 'STORAGE_CREATOR_MB', 30000),
  maxUploadMb: num(env, 'MAX_UPLOAD_MB', 4096),
  renderConcurrency: num(env, 'RENDER_CONCURRENCY', 2),
  youtubeApiKey: env.YOUTUBE_API_KEY || '',
  startTimeoutMs: num(env, 'HUB_START_TIMEOUT_MS', 90_000),
});

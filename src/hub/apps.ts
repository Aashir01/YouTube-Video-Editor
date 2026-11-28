/**
 * One Cutroom app ("studio") per signed-in person: started on first use with its own data folder
 * and the person's Cutroom AI sign-in, reached only through the hub (it listens on 127.0.0.1),
 * and stopped after a while without use unless it is busy (rendering, an AI run, a job).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { APP_ROOT, type HubConfig } from './config';

export interface Studio {
  userId: string;
  port: number;
  child: ChildProcess;
  lastSeen: number;
  /** open event streams (an open editor tab) */
  streams: number;
  startedAt: number;
}

export class StudioFullError extends Error {}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

/** What a studio gets from the hub's environment: nothing secret, only what it needs to run. */
const PASS_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'FFMPEG_PATH', 'FFPROBE_PATH', 'DIRECTOR_BROWSER', 'REMOTION_BROWSER_EXECUTABLE', 'PLAYWRIGHT_BROWSERS_PATH', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];

export const userDir = (cfg: HubConfig, userId: string) => {
  if (!/^[\w-]{3,64}$/.test(userId)) throw new Error('Bad account id');
  return path.join(cfg.data, 'users', userId);
};

/**
 * Put the person's Cutroom AI sign-in into the studio's settings before it starts (the token
 * stays on the server), and website defaults the first time.
 */
export const seedSettings = async (dataDir: string, account: { token: string; email: string; plan: string }, cfg: HubConfig) => {
  const file = path.join(dataDir, 'settings.json');
  await fsp.mkdir(dataDir, { recursive: true });
  const fresh = !fs.existsSync(file);
  const s = fresh ? {} : (JSON.parse(await fsp.readFile(file, 'utf8').catch(() => '{}')) as Record<string, any>);
  s.cloud = { ...(s.cloud ?? {}), url: '', token: account.token, email: account.email, plan: account.plan };
  s.llm ??= {};
  // Cutroom AI runs the Director unless the person chose another model
  if (!s.llm.main) s.llm.main = { providerId: 'cutroom', model: 'auto' };
  if (!s.llm.fast) s.llm.fast = { providerId: 'cutroom', model: 'auto-fast' };
  if (fresh) s.render = { quality: 'standard', concurrency: cfg.renderConcurrency };
  if (cfg.youtubeApiKey) s.keys = { ...(s.keys ?? {}), youtube: s.keys?.youtube || cfg.youtubeApiKey };
  s.mcpServers = {};
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
};

export class Studios {
  readonly running = new Map<string, Studio>();
  private starting = new Map<string, Promise<Studio>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cfg: HubConfig,
    /** the person's Cloud sign-in when a studio has to start */
    private readonly account: (userId: string) => Promise<{ token: string; email: string; plan: string }>,
  ) {}

  startReaper(everyMs = 60_000) {
    this.timer = setInterval(() => void this.reap(), everyMs);
    this.timer.unref();
  }

  /** The person's studio, started if needed. */
  get(userId: string): Promise<Studio> {
    const s = this.running.get(userId);
    if (s && s.child.exitCode === null) {
      s.lastSeen = Date.now();
      return Promise.resolve(s);
    }
    let p = this.starting.get(userId);
    if (!p) {
      p = this.start(userId).finally(() => this.starting.delete(userId));
      this.starting.set(userId, p);
    }
    return p;
  }

  private async start(userId: string): Promise<Studio> {
    if (this.running.size >= this.cfg.maxApps && !(await this.makeRoom())) throw new StudioFullError('The Cutroom website is busy right now. Try again in a few minutes.');
    const dir = userDir(this.cfg, userId);
    const dataDir = path.join(dir, 'data');
    const account = await this.account(userId);
    await seedSettings(dataDir, account, this.cfg);
    const port = await freePort();
    const env: NodeJS.ProcessEnv = {};
    for (const k of PASS_ENV) if (process.env[k]) env[k] = process.env[k];
    Object.assign(env, {
      NODE_ENV: 'production',
      // one heavy project can't take the whole server's memory
      NODE_OPTIONS: `--max-old-space-size=${Number(process.env.STUDIO_MEMORY_MB) || 3072}`,
      DIRECTOR_DATA_DIR: dataDir,
      CUTROOM_HOSTED: '1',
      CUTROOM_CLOUD_URL: this.cfg.cloudUrl,
      CUTROOM_SHARED_CACHE: path.join(this.cfg.data, 'shared-cache'),
      CUTROOM_STORAGE_LIMIT_MB: String(account.plan === 'free' ? this.cfg.storageFreeMb : this.cfg.storageCreatorMb),
      CUTROOM_MAX_UPLOAD_MB: String(this.cfg.maxUploadMb),
      CUTROOM_RENDER_CONCURRENCY: String(this.cfg.renderConcurrency),
    });
    const log = fs.openSync(path.join(dir, 'studio.log'), 'w');
    const child = spawn(process.execPath, [path.join(APP_ROOT, 'bin', 'director.mjs'), 'start', '--port', String(port), '--host', '127.0.0.1', '--no-open'], { cwd: APP_ROOT, env, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    const studio: Studio = { userId, port, child, lastSeen: Date.now(), streams: 0, startedAt: Date.now() };
    child.on('exit', () => {
      if (this.running.get(userId) === studio) this.running.delete(userId);
    });
    const t0 = Date.now();
    while (Date.now() - t0 < this.cfg.startTimeoutMs) {
      if (child.exitCode !== null) throw new Error(`Your studio could not start (see ${path.join(dir, 'studio.log')})`);
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) {
          this.running.set(userId, studio);
          return studio;
        }
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    child.kill('SIGTERM');
    throw new Error('Your studio took too long to start; try again');
  }

  private async busy(s: Studio) {
    try {
      const r = (await (await fetch(`http://127.0.0.1:${s.port}/api/hosted/status`, { signal: AbortSignal.timeout(5000) })).json()) as { busy?: boolean };
      return Boolean(r.busy);
    } catch {
      return false;
    }
  }

  stop(userId: string) {
    const s = this.running.get(userId);
    if (!s) return false;
    this.running.delete(userId);
    s.child.kill('SIGTERM');
    return true;
  }

  /** Stop the studio unused the longest that is not busy (to start another). */
  private async makeRoom() {
    const idle = [...this.running.values()].filter((s) => s.streams === 0).sort((a, b) => a.lastSeen - b.lastSeen);
    for (const s of idle) if (!(await this.busy(s))) return this.stop(s.userId);
    return false;
  }

  /** Stop studios nobody has used for a while (an open tab counts as use) unless they are working. */
  async reap() {
    const cutoff = Date.now() - this.cfg.idleMinutes * 60_000;
    for (const s of [...this.running.values()]) {
      if (s.streams > 0) s.lastSeen = Date.now();
      else if (s.lastSeen < cutoff && !(await this.busy(s))) this.stop(s.userId);
    }
  }

  async stopAll() {
    if (this.timer) clearInterval(this.timer);
    for (const id of [...this.running.keys()]) this.stop(id);
  }
}

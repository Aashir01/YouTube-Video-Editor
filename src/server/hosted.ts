/**
 * Hosted mode (CUTROOM_HOSTED=1): this app serves one person of the Cutroom website, started by
 * the web hub (src/hub) with its own data folder. What a local install may do but a shared server
 * must not:
 * - no MCP: no external MCP servers (they start programs) and no /mcp endpoint
 * - server-side fetches of user-given URLs may not reach private networks (the hub, other users'
 *   apps, the cloud provider's metadata service)
 * - a storage quota (CUTROOM_STORAGE_LIMIT_MB) and an upload size limit
 * - renders are capped in size and parallel work (the CPU is shared)
 */
import dns from 'node:dns/promises';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { DATA_DIR } from './config';

const flag = (v: string | undefined) => /^(1|true|yes)$/i.test(v ?? '');

export const HOSTED = flag(process.env.CUTROOM_HOSTED);
export const STORAGE_LIMIT_MB = Number(process.env.CUTROOM_STORAGE_LIMIT_MB) || 0;
export const RENDER_CONCURRENCY_LIMIT = Number(process.env.CUTROOM_RENDER_CONCURRENCY) || 2;
/** where "Sign out" goes on the website */
export const LOGOUT_URL = '/logout';

// ---------------------------------------------------------------------------
// Private networks
// ---------------------------------------------------------------------------

const v4Private = (ip: string) => {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
};

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved addresses. */
export const isPrivateAddress = (ip: string): boolean => {
  if (net.isIPv4(ip)) return v4Private(ip);
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return v4Private(mapped[1]!);
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
};

/** Refuse URLs that are not http(s) or that point at a private network (hosted mode only). */
export const assertPublicUrl = async (raw: string, lookup: (host: string) => Promise<{ address: string }[]> = (h) => dns.lookup(h, { all: true })) => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid web address: ${raw}`);
  }
  if (!HOSTED && !flag(process.env.CUTROOM_FORCE_URL_GUARD)) return url;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https addresses can be fetched');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host).catch(() => []);
  if (!addresses.length) throw new Error(`Could not find ${host}`);
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error(`${host} is on a private network and can't be fetched from the Cutroom website`);
  return url;
};

/** fetch() that checks every redirect hop with assertPublicUrl (hosted mode); plain fetch locally. */
export const safeFetch = async (raw: string, init: RequestInit = {}): Promise<Response> => {
  let url = raw;
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: 'manual' });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) return res;
    await res.body?.cancel().catch(() => undefined);
    url = new URL(next, url).toString();
  }
  throw new Error('Too many redirects');
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const sizeOf = async (dir: string): Promise<number> => {
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await sizeOf(p);
    else if (e.isFile()) total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
};

let usage: { at: number; bytes: number } | null = null;

/** Bytes this user's data folder takes (cached for half a minute). */
export const storageUsed = async (fresh = false) => {
  if (!fresh && usage && Date.now() - usage.at < 30_000) return usage.bytes;
  usage = { at: Date.now(), bytes: await sizeOf(DATA_DIR) };
  return usage.bytes;
};

export const storageInfo = async () => ({ usedMb: Math.round((await storageUsed()) / 1e6), limitMb: STORAGE_LIMIT_MB || null });

/** Throw when `incoming` more bytes would go over the quota. */
export const assertStorage = async (incoming = 0) => {
  if (!STORAGE_LIMIT_MB) return;
  const used = await storageUsed(true);
  if (used + incoming > STORAGE_LIMIT_MB * 1e6) {
    const size = (mb: number) => (mb < 1000 ? `${Math.round(mb)} MB` : `${(mb / 1000).toFixed(1)} GB`);
    throw new Error(`Your Cutroom storage is full (${size(used / 1e6)} of ${size(STORAGE_LIMIT_MB)}). Delete old projects or renders, or upgrade for more space.`);
  }
};

/**
 * Cutroom Cloud settings, from the environment or a .env.cloud next to the app (kept apart from the
 * app's own .env, so the operator's upstream key never becomes the app's provider by accident).
 *
 *   CLOUD_PORT                 port to listen on (default 8787)
 *   CLOUD_HOST                 interface (default 0.0.0.0)
 *   CLOUD_DB                   SQLite file (default data/cloud/cloud.db)
 *   OPENROUTER_API_KEY         the upstream key all AI requests are paid with
 *   OPENROUTER_BASE_URL        upstream (default https://openrouter.ai/api/v1)
 *   ADMIN_TOKEN                bearer token for /v1/admin/* (grants, plans, manual payments)
 *   CLOUD_MODELS               a JSON file that replaces the built-in model catalog
 *   CREDIT_USD                 what one credit is worth in upstream cost (default 0.001)
 *   CLOUD_MARKUP               multiplier over upstream cost (default 1.15: fees and free credits)
 *   SIGNUP_CREDITS             one-time gift for new accounts (default 300)
 *   FREE_MONTHLY_CREDITS       free plan's monthly top-up (default 50)
 *   CREATOR_MONTHLY_CREDITS    Creator plan's monthly credits (default 2000)
 *   SIGNUPS_PER_IP_PER_DAY     abuse limit (default 3)
 *   REFERRAL_INVITEE_CREDITS   extra gift for signing up with an invite code (default 100)
 *   REFERRAL_ACTIVE_CREDITS    for the inviter, once the friend has used REFERRAL_ACTIVE_AFTER credits (default 300 after 100)
 *   REFERRAL_PURCHASE_CREDITS  for the inviter, when the friend first buys something (default 1000)
 *   REFERRAL_MONTHLY_CAP       most activity rewards an inviter gets a month (default 10)
 *   CHECKOUT_URL_<PRODUCT>     payment link per product, e.g. CHECKOUT_URL_CREATOR_MONTH
 *   TRUST_PROXY                set when behind a reverse proxy (client IPs from X-Forwarded-For)
 *   CONTACT_URL                where to ask for a manual top-up (WhatsApp, email) until checkout links exist
 */
import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(import.meta.dirname, '..', '..');

try {
  const envFile = path.join(APP_ROOT, process.env.CLOUD_ENV_FILE || '.env.cloud');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
} catch {
  /* ignore malformed .env */
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name]?.trim() ? v : fallback;
};

export interface CloudConfig {
  port: number;
  host: string;
  db: string;
  upstreamUrl: string;
  upstreamKey: string;
  adminToken: string;
  modelsFile?: string;
  creditUsd: number;
  markup: number;
  signupCredits: number;
  freeMonthlyCredits: number;
  creatorMonthlyCredits: number;
  signupsPerIpPerDay: number;
  referral: { invitee: number; active: number; activeAfter: number; purchase: number; monthlyCap: number };
  /** read the client address from X-Forwarded-For (behind a reverse proxy) */
  trustProxy: boolean;
  /** most AI requests one account may have running at once */
  maxConcurrent: number;
  checkoutUrls: Record<string, string>;
  contactUrl: string;
}

export const loadCloudConfig = (env: NodeJS.ProcessEnv = process.env): CloudConfig => ({
  port: num('CLOUD_PORT', 8787),
  host: env.CLOUD_HOST || '0.0.0.0',
  db: env.CLOUD_DB || path.join(APP_ROOT, 'data', 'cloud', 'cloud.db'),
  upstreamUrl: (env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
  upstreamKey: env.OPENROUTER_API_KEY || '',
  adminToken: env.ADMIN_TOKEN || '',
  modelsFile: env.CLOUD_MODELS || undefined,
  creditUsd: num('CREDIT_USD', 0.001),
  markup: num('CLOUD_MARKUP', 1.15),
  signupCredits: num('SIGNUP_CREDITS', 300),
  freeMonthlyCredits: num('FREE_MONTHLY_CREDITS', 50),
  creatorMonthlyCredits: num('CREATOR_MONTHLY_CREDITS', 2000),
  signupsPerIpPerDay: num('SIGNUPS_PER_IP_PER_DAY', 3),
  referral: {
    invitee: num('REFERRAL_INVITEE_CREDITS', 100),
    active: num('REFERRAL_ACTIVE_CREDITS', 300),
    activeAfter: num('REFERRAL_ACTIVE_AFTER', 100),
    purchase: num('REFERRAL_PURCHASE_CREDITS', 1000),
    monthlyCap: num('REFERRAL_MONTHLY_CAP', 10),
  },
  maxConcurrent: num('CLOUD_MAX_CONCURRENT', 4),
  trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY ?? ''),
  checkoutUrls: Object.fromEntries(
    Object.entries(env)
      .filter(([k, v]) => k.startsWith('CHECKOUT_URL_') && v)
      .map(([k, v]) => [k.slice('CHECKOUT_URL_'.length).toLowerCase(), v!]),
  ),
  contactUrl: env.CONTACT_URL || '',
});

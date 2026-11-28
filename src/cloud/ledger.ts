/**
 * Accounts and credits, in one SQLite file. Every change to a balance is a ledger row (what, why,
 * which model, tokens and upstream cost), so the balance can always be explained.
 *
 * Credits sit in three buckets, spent in this order:
 * - monthly: the plan's allowance, reset at the start of each monthly period (no rollover)
 * - bonus: gifts (signup, referrals), never expire, standard models only on the free plan
 * - extra: bought packs and admin grants, never expire, unlock Pro models
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CloudConfig } from './config';
import { plansOf, productById, type PlanId } from './plans';

export type Bucket = 'monthly' | 'bonus' | 'extra';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  plan_until: number | null;
  period_start: number;
  monthly: number;
  bonus: number;
  extra: number;
  created_at: number;
  referral_code: string;
  referred_by: string | null;
  disabled: number;
  rewarded_active: number;
  rewarded_purchase: number;
}

export interface Account {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  planName: string;
  /** when a paid plan ends (ms), null on the free plan */
  planUntil: number | null;
  /** when the monthly credits reset next (ms) */
  renewsAt: number;
  monthlyAllowance: number;
  credits: { total: number; monthly: number; bonus: number; extra: number };
  /** may use Pro (premium) models */
  premium: boolean;
  referralCode: string;
  referrals: { invited: number; active: number; earned: number };
  createdAt: number;
}

export interface UsageEntry {
  at: number;
  delta: number;
  kind: string;
  note: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  balance: number;
}

export class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const DAY = 86_400_000;

/** The same day `n` months later (clamped to the month's last day), in UTC. */
export const addMonths = (ms: number, n: number) => {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
};

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64url')}$${hash.toString('base64url')}`;
};

const checkPassword = (password: string, stored: string) => {
  const [scheme, n, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), want.length, { N: Number(n), r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
};

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pass TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_until INTEGER,
  period_start INTEGER NOT NULL,
  monthly INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0,
  extra INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  signup_ip TEXT,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  -- the inviter was rewarded for this account's activity / first purchase
  rewarded_active INTEGER NOT NULL DEFAULT 0,
  rewarded_purchase INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  at INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  monthly_delta INTEGER NOT NULL DEFAULT 0,
  bonus_delta INTEGER NOT NULL DEFAULT 0,
  extra_delta INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  balance INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, at);
CREATE TABLE IF NOT EXISTS purchases (
  ref TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product TEXT NOT NULL,
  at INTEGER NOT NULL
);
`;

export class Ledger {
  readonly db: DatabaseSync;
  private readonly plans;

  constructor(
    file: string,
    private readonly cfg: CloudConfig,
    private readonly now: () => number = Date.now,
  ) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    const cols = new Set((this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name));
    for (const c of ['rewarded_active', 'rewarded_purchase']) if (!cols.has(c)) this.db.exec(`ALTER TABLE users ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`);
    this.plans = plansOf(cfg);
  }

  close() {
    this.db.close();
  }

  private depth = 0;

  /** Run in one transaction (nested calls join the outer one). */
  private tx<T>(fn: () => T): T {
    if (this.depth) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }

  private row(id: string) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
  }

  private write(u: UserRow, change: { monthly?: number; bonus?: number; extra?: number }, entry: { kind: string; note?: string; model?: string; inputTokens?: number; outputTokens?: number; costUsd?: number }) {
    const m = change.monthly ?? 0;
    const b = change.bonus ?? 0;
    const e = change.extra ?? 0;
    u.monthly += m;
    u.bonus += b;
    u.extra += e;
    this.db.prepare('UPDATE users SET monthly = ?, bonus = ?, extra = ?, plan = ?, plan_until = ?, period_start = ? WHERE id = ?').run(u.monthly, u.bonus, u.extra, u.plan, u.plan_until, u.period_start, u.id);
    this.db
      .prepare('INSERT INTO ledger (user_id, at, delta, monthly_delta, bonus_delta, extra_delta, kind, note, model, input_tokens, output_tokens, cost_usd, balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(u.id, this.now(), m + b + e, m, b, e, entry.kind, entry.note ?? '', entry.model ?? null, entry.inputTokens ?? null, entry.outputTokens ?? null, entry.costUsd ?? null, u.monthly + u.bonus + u.extra);
  }

  /** Roll the monthly period forward and end expired plans (lazily, whenever the account is used). */
  private refreshRow(u: UserRow): UserRow {
    const now = this.now();
    let changed = false;
    if (u.plan !== 'free' && u.plan_until !== null && u.plan_until <= now) {
      u.plan = 'free';
      u.plan_until = null;
      changed = true;
    }
    let start = u.period_start;
    while (addMonths(start, 1) <= now) start = addMonths(start, 1);
    if (start !== u.period_start || changed) {
      u.period_start = start;
      const allowance = this.plans[u.plan].monthlyCredits;
      this.write(u, { monthly: allowance - u.monthly }, { kind: 'monthly', note: `${this.plans[u.plan].name} plan: monthly credits` });
    }
    return u;
  }

  private fresh(id: string): UserRow {
    return this.tx(() => {
      const u = this.row(id);
      if (!u) throw new CloudError(404, 'not_found', 'No such account');
      return this.refreshRow(u);
    });
  }

  private newToken(userId: string, device: string) {
    const token = `crk_${crypto.randomBytes(24).toString('base64url')}`;
    this.db.prepare('INSERT INTO tokens (hash, user_id, device, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)').run(sha256(token), userId, device.slice(0, 80), this.now(), this.now());
    return token;
  }

  signupsFrom(ip: string) {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE signup_ip = ? AND created_at > ?').get(ip, this.now() - DAY) as { n: number }).n);
  }

  signup(input: { email: string; password: string; name?: string; device?: string; ip?: string; referral?: string }) {
    const email = normalizeEmail(input.email);
    if (!EMAIL.test(email)) throw new CloudError(400, 'bad_email', 'Enter a valid email address');
    if (input.password.length < 8) throw new CloudError(400, 'weak_password', 'Use a password of at least 8 characters');
    if (input.ip && this.signupsFrom(input.ip) >= this.cfg.signupsPerIpPerDay) throw new CloudError(429, 'too_many_signups', 'Too many new accounts from this network today; try again tomorrow or sign in');
    const pass = hashPassword(input.password);
    return this.tx(() => {
      if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new CloudError(409, 'email_taken', 'An account with this email exists already; sign in instead');
      const referrer = input.referral ? (this.db.prepare('SELECT id FROM users WHERE referral_code = ?').get(input.referral.trim().toUpperCase()) as { id: string } | undefined) : undefined;
      const id = `u_${crypto.randomBytes(9).toString('base64url')}`;
      const now = this.now();
      let code = '';
      do code = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
      while (this.db.prepare('SELECT 1 FROM users WHERE referral_code = ?').get(code));
      this.db
        .prepare('INSERT INTO users (id, email, name, pass, plan, period_start, created_at, signup_ip, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, email, (input.name ?? '').trim().slice(0, 80), pass, 'free', now, now, input.ip ?? null, code, referrer?.id ?? null);
      const u = this.row(id)!;
      const invited = referrer ? this.cfg.referral.invitee : 0;
      this.write(u, { monthly: this.plans.free.monthlyCredits, bonus: this.cfg.signupCredits + invited }, { kind: 'signup', note: invited ? `Welcome credits (+${invited} for joining with an invite)` : 'Welcome credits' });
      return { token: this.newToken(id, input.device ?? ''), account: this.toAccount(u) };
    });
  }

  login(input: { email: string; password: string; device?: string }) {
    const u = this.db.prepare('SELECT id, pass, disabled FROM users WHERE email = ?').get(normalizeEmail(input.email)) as { id: string; pass: string; disabled: number } | undefined;
    if (!u || !checkPassword(input.password, u.pass)) throw new CloudError(401, 'bad_login', 'Wrong email or password');
    if (u.disabled) throw new CloudError(403, 'disabled', 'This account is disabled');
    const token = this.newToken(u.id, input.device ?? '');
    return { token, account: this.account(u.id) };
  }

  /** The account a token belongs to (null when unknown or revoked). */
  userByToken(token: string): string | null {
    if (!token.startsWith('crk_')) return null;
    const hash = sha256(token);
    const t = this.db.prepare('SELECT t.user_id AS id, t.last_used_at AS used, u.disabled AS disabled FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?').get(hash) as { id: string; used: number; disabled: number } | undefined;
    if (!t || t.disabled) return null;
    if (this.now() - t.used > 60_000) this.db.prepare('UPDATE tokens SET last_used_at = ? WHERE hash = ?').run(this.now(), hash);
    return t.id;
  }

  revoke(token: string) {
    this.db.prepare('DELETE FROM tokens WHERE hash = ?').run(sha256(token));
  }

  idByEmail(email: string) {
    const u = this.db.prepare('SELECT id FROM users WHERE email = ?').get(normalizeEmail(email)) as { id: string } | undefined;
    if (!u) throw new CloudError(404, 'not_found', `No account for ${email}`);
    return u.id;
  }

  private toAccount(u: UserRow): Account {
    const plan = this.plans[u.plan];
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      plan: u.plan,
      planName: plan.name,
      planUntil: u.plan_until,
      renewsAt: addMonths(u.period_start, 1),
      monthlyAllowance: plan.monthlyCredits,
      credits: { total: u.monthly + u.bonus + u.extra, monthly: u.monthly, bonus: u.bonus, extra: u.extra },
      premium: plan.premium || u.extra > 0,
      referralCode: u.referral_code,
      referrals: this.referralStats(u.id),
      createdAt: u.created_at,
    };
  }

  private referralStats(id: string) {
    const r = this.db.prepare('SELECT COUNT(*) AS invited, COALESCE(SUM(rewarded_active), 0) AS active FROM users WHERE referred_by = ?').get(id) as { invited: number; active: number };
    const e = this.db.prepare("SELECT COALESCE(SUM(delta), 0) AS earned FROM ledger WHERE user_id = ? AND kind = 'referral'").get(id) as { earned: number };
    return { invited: Number(r.invited), active: Number(r.active), earned: Number(e.earned) };
  }

  /**
   * Reward whoever invited this account: once when it has really used the AI (so made-up accounts
   * earn nothing; capped per month) and once on its first purchase.
   */
  private rewardReferrer(u: UserRow, event: 'active' | 'purchase') {
    if (!u.referred_by) return;
    const col = event === 'active' ? 'rewarded_active' : 'rewarded_purchase';
    if (u[col]) return;
    const referrer = this.row(u.referred_by);
    if (!referrer || referrer.disabled) return;
    if (event === 'active') {
      const spent = Number((this.db.prepare("SELECT COALESCE(-SUM(delta), 0) AS n FROM ledger WHERE user_id = ? AND kind = 'charge'").get(u.id) as { n: number }).n);
      if (spent < this.cfg.referral.activeAfter) return;
      const thisMonth = Number((this.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND kind = 'referral' AND note LIKE 'Invite used%' AND at > ?").get(referrer.id, this.now() - 30 * DAY) as { n: number }).n);
      if (thisMonth >= this.cfg.referral.monthlyCap) return;
    }
    this.db.prepare(`UPDATE users SET ${col} = 1 WHERE id = ?`).run(u.id);
    u[col] = 1;
    this.refreshRow(referrer);
    const amount = event === 'active' ? this.cfg.referral.active : this.cfg.referral.purchase;
    if (amount > 0) this.write(referrer, { bonus: amount }, { kind: 'referral', note: event === 'active' ? `Invite used Cutroom AI: ${u.email.replace(/^(.).*(@.*)$/, '$1…$2')}` : `Invite bought a plan or credits: ${u.email.replace(/^(.).*(@.*)$/, '$1…$2')}` });
  }

  account(id: string): Account {
    return this.toAccount(this.fresh(id));
  }

  /**
   * Take credits for AI use: the monthly allowance first, then gifts, then bought credits. A request
   * that costs more than is left takes the rest from the monthly bucket (forgiven at the next reset).
   */
  charge(id: string, credits: number, meta: { note?: string; model?: string; inputTokens?: number; outputTokens?: number; costUsd?: number }) {
    const amount = Math.max(0, Math.ceil(credits));
    return this.tx(() => {
      const u = this.row(id);
      if (!u) throw new CloudError(404, 'not_found', 'No such account');
      this.refreshRow(u);
      let left = amount;
      const take = (have: number) => {
        const n = Math.min(Math.max(0, have), left);
        left -= n;
        return n;
      };
      const monthly = take(u.monthly);
      const bonus = take(u.bonus);
      const extra = take(u.extra);
      this.write(u, { monthly: -(monthly + left), bonus: -bonus, extra: -extra }, { kind: 'charge', note: meta.note ?? 'AI', model: meta.model, inputTokens: meta.inputTokens, outputTokens: meta.outputTokens, costUsd: meta.costUsd });
      this.rewardReferrer(u, 'active');
      return this.toAccount(u);
    });
  }

  /** Add (or with a negative amount, take away) credits by hand. */
  grant(id: string, credits: number, bucket: 'bonus' | 'extra' = 'extra', note = 'Granted', kind = 'grant') {
    return this.tx(() => {
      const u = this.row(id);
      if (!u) throw new CloudError(404, 'not_found', 'No such account');
      this.refreshRow(u);
      let n = Math.round(credits);
      if (n < 0) {
        // take from what is there, newest kind of credit last
        const change = { monthly: 0, bonus: 0, extra: 0 };
        for (const b of ['monthly', 'bonus', 'extra'] as const) {
          const t = Math.min(Math.max(0, u[b]), -n);
          change[b] -= t;
          n += t;
        }
        this.write(u, change, { kind, note });
      } else this.write(u, { [bucket]: n }, { kind, note });
      return this.toAccount(u);
    });
  }

  /** Put an account on a plan; a paid plan for `months` more (from its end when it is running). */
  setPlan(id: string, plan: PlanId, months = 1, note?: string) {
    return this.tx(() => {
      const u = this.row(id);
      if (!u) throw new CloudError(404, 'not_found', 'No such account');
      this.refreshRow(u);
      const now = this.now();
      if (plan === 'free') {
        u.plan = 'free';
        u.plan_until = null;
      } else if (u.plan === plan && u.plan_until && u.plan_until > now) {
        u.plan_until = addMonths(u.plan_until, months);
        this.write(u, {}, { kind: 'plan', note: note ?? `${this.plans[plan].name} plan extended` });
        return this.toAccount(u);
      } else {
        u.plan = plan;
        u.plan_until = addMonths(now, months);
      }
      // a new plan starts a fresh monthly period
      u.period_start = now;
      this.write(u, { monthly: this.plans[u.plan].monthlyCredits - u.monthly }, { kind: 'plan', note: note ?? `${this.plans[u.plan].name} plan` });
      return this.toAccount(u);
    });
  }

  /** Apply something bought. With a payment reference it happens once, however often it is reported. */
  purchase(id: string, productId: string, ref?: string) {
    const product = productById(productId);
    if (!product) throw new CloudError(400, 'bad_product', `Unknown product ${productId}`);
    return this.tx(() => {
      if (ref) {
        if (this.db.prepare('SELECT 1 FROM purchases WHERE ref = ?').get(ref)) return { account: this.account(id), duplicate: true };
        this.db.prepare('INSERT INTO purchases (ref, user_id, product, at) VALUES (?, ?, ?, ?)').run(ref, id, product.id, this.now());
      }
      let account = product.kind === 'plan' ? this.setPlan(id, 'creator', product.months ?? 1, `Bought: ${product.name}`) : this.grant(id, product.credits ?? 0, 'extra', `Bought: ${product.name}`, 'purchase');
      const u = this.row(id);
      if (u?.referred_by && !u.rewarded_purchase) {
        this.rewardReferrer(u, 'purchase');
        account = this.toAccount(u);
      }
      return { account, duplicate: false };
    });
  }

  usage(id: string, limit = 50): { entries: UsageEntry[]; period: { since: number; spent: number; requests: number; costUsd: number } } {
    const u = this.fresh(id);
    const entries = (
      this.db.prepare('SELECT at, delta, kind, note, model, input_tokens, output_tokens, cost_usd, balance FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(id, Math.min(500, Math.max(1, limit))) as Record<string, unknown>[]
    ).map((r) => ({
      at: Number(r.at),
      delta: Number(r.delta),
      kind: String(r.kind),
      note: String(r.note),
      model: (r.model as string | null) ?? null,
      inputTokens: r.input_tokens === null ? null : Number(r.input_tokens),
      outputTokens: r.output_tokens === null ? null : Number(r.output_tokens),
      costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
      balance: Number(r.balance),
    }));
    const p = this.db.prepare("SELECT COALESCE(-SUM(delta), 0) AS spent, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost FROM ledger WHERE user_id = ? AND kind = 'charge' AND at >= ?").get(id, u.period_start) as { spent: number; n: number; cost: number };
    return { entries, period: { since: u.period_start, spent: Number(p.spent), requests: Number(p.n), costUsd: Number(p.cost) } };
  }

  listUsers(q = '', limit = 50) {
    const rows = this.db.prepare('SELECT id FROM users WHERE email LIKE ? ORDER BY created_at DESC LIMIT ?').all(`%${q.toLowerCase()}%`, Math.min(500, limit)) as { id: string }[];
    return rows.map((r) => this.account(r.id));
  }

  stats(since = this.now() - 30 * DAY) {
    const users = this.db.prepare("SELECT COUNT(*) AS n, SUM(plan != 'free') AS paid FROM users").get() as { n: number; paid: number | null };
    const use = this.db.prepare("SELECT COALESCE(-SUM(delta), 0) AS credits, COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS n, COUNT(DISTINCT user_id) AS active FROM ledger WHERE kind = 'charge' AND at >= ?").get(since) as { credits: number; cost: number; n: number; active: number };
    return { users: Number(users.n), paidUsers: Number(users.paid ?? 0), since, activeUsers: Number(use.active), requests: Number(use.n), creditsSpent: Number(use.credits), upstreamCostUsd: Number(use.cost) };
  }
}

/**
 * Website sessions: the browser holds a random id in an HttpOnly cookie; the server keeps which
 * account it belongs to and that account's Cutroom Cloud token (which never reaches the browser).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Session {
  userId: string;
  email: string;
  token: string;
  createdAt: number;
}

const DAY = 86_400_000;
export const SESSION_DAYS = 30;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export class Sessions {
  private db: DatabaseSync;

  constructor(file: string, private readonly now: () => number = Date.now) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, token TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);`);
  }

  create(s: Omit<Session, 'createdAt'>): string {
    const id = crypto.randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions (id, user_id, email, token, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(sha(id), s.userId, s.email, s.token, this.now(), this.now());
    return id;
  }

  get(id: string | undefined): Session | null {
    if (!id) return null;
    const r = this.db.prepare('SELECT user_id, email, token, created_at, last_seen FROM sessions WHERE id = ?').get(sha(id)) as { user_id: string; email: string; token: string; created_at: number; last_seen: number } | undefined;
    if (!r) return null;
    if (this.now() - r.created_at > SESSION_DAYS * DAY) {
      this.delete(id);
      return null;
    }
    if (this.now() - r.last_seen > 60_000) this.db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(this.now(), sha(id));
    return { userId: r.user_id, email: r.email, token: r.token, createdAt: r.created_at };
  }

  /** The newest Cloud token of an account (for starting its studio). */
  latestToken(userId: string): string | null {
    const r = this.db.prepare('SELECT token FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId) as { token: string } | undefined;
    return r?.token ?? null;
  }

  delete(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sha(id));
  }

  close() {
    this.db.close();
  }
}

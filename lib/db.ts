import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

let db: DatabaseSync | null = null;

/** Ordered schema migrations. Never edit an entry once shipped; append a new one. */
const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, host)
  );
  CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    host TEXT NOT NULL,
    score INTEGER NOT NULL,
    pages INTEGER NOT NULL,
    result TEXT NOT NULL,
    ip TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audits_user_host ON audits(user_id, host, created_at);
  CREATE INDEX IF NOT EXISTS audits_ip ON audits(ip, created_at);
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    plan TEXT NOT NULL,
    period TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // 2: async audits, anonymous cookie id, cron source, account fields, events, locks
  `
  ALTER TABLE audits ADD COLUMN status TEXT NOT NULL DEFAULT 'done';
  ALTER TABLE audits ADD COLUMN error TEXT;
  ALTER TABLE audits ADD COLUMN anon_id TEXT;
  ALTER TABLE audits ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
  CREATE INDEX IF NOT EXISTS audits_anon ON audits(anon_id, created_at);
  ALTER TABLE users ADD COLUMN plan_period TEXT;
  ALTER TABLE users ADD COLUMN domain_changed_at INTEGER;
  ALTER TABLE users ADD COLUMN reminder_stage TEXT;
  ALTER TABLE users ADD COLUMN agency_name TEXT;
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER,
    anon_id TEXT,
    meta TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_name ON events(name, created_at);
  CREATE TABLE IF NOT EXISTS locks (
    name TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts(key, created_at);
  `,
];

function migrate(d: DatabaseSync): void {
  const current = (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    d.exec("BEGIN");
    try {
      d.exec(MIGRATIONS[v]);
      d.exec(`PRAGMA user_version = ${v + 1}`);
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
  }
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = process.env.DATABASE_PATH || "./data/tasaddur.db";
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
  migrate(d);
  // Any audit still "running" after a restart was interrupted.
  d.prepare("UPDATE audits SET status = 'error', error = 'interrupted' WHERE status = 'running' AND created_at < ?").run(Date.now() - 10 * 60_000);
  db = d;
  return d;
}

/** Runs fn inside a transaction (synchronous; node:sqlite is synchronous so this is atomic per process). */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export interface UserRow {
  id: number;
  email: string;
  pass_hash: string;
  plan: string;
  plan_expires_at: number | null;
  plan_period: string | null;
  domain_changed_at: number | null;
  reminder_stage: string | null;
  agency_name: string | null;
  created_at: number;
}

export interface AuditRow {
  id: string;
  user_id: number | null;
  host: string;
  score: number;
  pages: number;
  result: string;
  ip: string | null;
  anon_id: string | null;
  status: "running" | "done" | "error";
  error: string | null;
  source: "user" | "cron";
  created_at: number;
}

export function getUserById(id: number): UserRow | null {
  return (getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
}

export function track(name: string, data: { userId?: number | null; anonId?: string | null; meta?: Record<string, unknown> } = {}): void {
  try {
    getDb()
      .prepare("INSERT INTO events (name, user_id, anon_id, meta, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(name, data.userId ?? null, data.anonId ?? null, data.meta ? JSON.stringify(data.meta) : null, Date.now());
  } catch (e) {
    console.error("[track]", e);
  }
}

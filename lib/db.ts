import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = process.env.DATABASE_PATH || "./data/tasaddur.db";
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
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
  `);
  return db;
}

export interface UserRow {
  id: number;
  email: string;
  pass_hash: string;
  plan: string;
  plan_expires_at: number | null;
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
  created_at: number;
}

import crypto from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { getDb, type UserRow } from "./db";
import { PLANS, type Plan, type PlanId } from "./plans";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_COOKIE = "tsd_session";
const SESSION_DAYS = 30;
const DUMMY_HASH = "scrypt:00000000000000000000000000000000:" + "00".repeat(64);

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return ["scrypt", salt.toString("hex"), hash.toString("hex")].join(":");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/** Spend the same time as a real check, so unknown emails can't be detected by timing. */
export async function dummyVerify(password: string): Promise<false> {
  await verifyPassword(password, DUMMY_HASH);
  return false;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** Simple sliding-window limiter stored in SQLite. Returns true when the key is over the limit. */
export function rateLimited(key: string, max: number, windowMs: number, record = true): boolean {
  const db = getDb();
  const since = Date.now() - windowMs;
  const n = (db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND created_at > ?").get(key, since) as { n: number }).n;
  if (n >= max) return true;
  if (record) db.prepare("INSERT INTO login_attempts (key, created_at) VALUES (?, ?)").run(key, Date.now());
  return false;
}

export async function createSession(userId: number): Promise<void> {
  const db = getDb();
  const jar = await cookies();
  // Rotate: drop any session token the browser already had, and clean expired sessions.
  const old = jar.get(SESSION_COOKIE)?.value;
  if (old) db.prepare("DELETE FROM sessions WHERE token = ?").run(old);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("DELETE FROM login_attempts WHERE created_at < ?").run(Date.now() - 86400_000);
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expires);
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expires),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
  jar.delete(SESSION_COOKIE);
}

export async function getUser(): Promise<UserRow | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = getDb()
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?")
    .get(token, Date.now()) as UserRow | undefined;
  return row ?? null;
}

/** The plan a user is entitled to right now (paid plans fall back to free once expired). */
export function effectivePlan(user: Pick<UserRow, "plan" | "plan_expires_at"> | null): Plan {
  if (!user) return PLANS.free;
  const id = user.plan as PlanId;
  if (id !== "free" && PLANS[id] && (user.plan_expires_at ?? 0) > Date.now()) return PLANS[id];
  return PLANS.free;
}

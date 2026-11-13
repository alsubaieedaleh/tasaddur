import crypto from "node:crypto";
import { getDb, type AuditRow, type UserRow } from "./db";
import { effectivePlan } from "./auth";
import { ANON_AUDITS_PER_DAY } from "./plans";
import { runAudit, type AuditResult } from "./audit/run";

export type AuditError = "invalid_domain" | "limit_anon" | "limit_daily" | "limit_domains";

export function auditsSince(where: { userId?: number; ip?: string }, since: number): number {
  const db = getDb();
  if (where.userId) {
    return (db.prepare("SELECT COUNT(*) AS n FROM audits WHERE user_id = ? AND created_at > ?").get(where.userId, since) as { n: number }).n;
  }
  return (db.prepare("SELECT COUNT(*) AS n FROM audits WHERE user_id IS NULL AND ip = ? AND created_at > ?").get(where.ip ?? "", since) as { n: number }).n;
}

export function userDomains(userId: number): { id: number; host: string; created_at: number }[] {
  return getDb().prepare("SELECT id, host, created_at FROM domains WHERE user_id = ? ORDER BY created_at").all(userId) as {
    id: number;
    host: string;
    created_at: number;
  }[];
}

/** Checks plan limits for a new audit. Returns an error code or null when allowed. */
export function checkAuditAllowed(user: UserRow | null, host: string, ip: string): AuditError | null {
  const dayAgo = Date.now() - 86400_000;
  if (!user) return auditsSince({ ip }, dayAgo) >= ANON_AUDITS_PER_DAY ? "limit_anon" : null;
  const plan = effectivePlan(user);
  if (auditsSince({ userId: user.id }, dayAgo) >= plan.auditsPerDay) return "limit_daily";
  const domains = userDomains(user.id);
  if (!domains.some((d) => d.host === host) && domains.length >= plan.domains) return "limit_domains";
  return null;
}

export function saveAudit(result: AuditResult, userId: number | null, ip: string | null): string {
  const id = crypto.randomBytes(12).toString("base64url");
  const db = getDb();
  db.prepare("INSERT INTO audits (id, user_id, host, score, pages, result, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id,
    userId,
    result.host,
    result.score,
    result.pagesCrawled,
    JSON.stringify(result),
    ip,
    Date.now(),
  );
  if (userId) db.prepare("INSERT OR IGNORE INTO domains (user_id, host, created_at) VALUES (?, ?, ?)").run(userId, result.host, Date.now());
  return id;
}

export async function performAudit(user: UserRow | null, host: string, ip: string): Promise<{ id: string } | { error: AuditError }> {
  const err = checkAuditAllowed(user, host, ip);
  if (err) return { error: err };
  const plan = effectivePlan(user);
  const result = await runAudit(host, { maxPages: plan.pagesPerAudit });
  return { id: saveAudit(result, user?.id ?? null, ip) };
}

export function getAudit(id: string): (AuditRow & { data: AuditResult }) | null {
  const row = getDb().prepare("SELECT * FROM audits WHERE id = ?").get(id) as AuditRow | undefined;
  return row ? { ...row, data: JSON.parse(row.result) as AuditResult } : null;
}

export function auditHistory(userId: number, host: string, limit = 12): { id: string; score: number; created_at: number }[] {
  return getDb()
    .prepare("SELECT id, score, created_at FROM audits WHERE user_id = ? AND host = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, host, limit) as { id: string; score: number; created_at: number }[];
}

/** Links anonymous audits from this IP (last 24h) to a user who just signed up, so their first report is kept. */
export function claimAnonymousAudits(userId: number, ip: string): void {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, host FROM audits WHERE user_id IS NULL AND ip = ? AND created_at > ?")
    .all(ip, Date.now() - 86400_000) as { id: string; host: string }[];
  for (const r of rows) {
    db.prepare("UPDATE audits SET user_id = ? WHERE id = ?").run(userId, r.id);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM domains WHERE user_id = ?").get(userId) as { n: number }).n;
    if (count < 1) db.prepare("INSERT OR IGNORE INTO domains (user_id, host, created_at) VALUES (?, ?, ?)").run(userId, r.host, Date.now());
  }
}

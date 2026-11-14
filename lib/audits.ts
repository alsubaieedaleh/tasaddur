import crypto from "node:crypto";
import { getDb, track, tx, type AuditRow, type UserRow } from "./db";
import { effectivePlan } from "./auth";
import { ANON_AUDITS_PER_DAY, ANON_AUDITS_PER_IP_PER_DAY, DOMAIN_CHANGE_COOLDOWN_DAYS, type Plan } from "./plans";
import { runAudit, type AuditResult } from "./audit/run";

export type AuditError = "invalid_domain" | "limit_anon" | "limit_daily" | "limit_domains" | "in_progress";

const DAY = 86400_000;
/** Audits that count against quotas: user-started, not failed. */
const COUNTED = "source = 'user' AND status IN ('running', 'done')";

export interface Actor {
  user: UserRow | null;
  anonId: string | null;
  ip: string;
}

function count(sql: string, ...args: (string | number)[]): number {
  return (getDb().prepare(sql).get(...args) as { n: number }).n;
}

export function auditsToday(actor: Pick<Actor, "user" | "anonId">): number {
  const since = Date.now() - DAY;
  if (actor.user) return count(`SELECT COUNT(*) AS n FROM audits WHERE user_id = ? AND created_at > ? AND ${COUNTED}`, actor.user.id, since);
  return count(`SELECT COUNT(*) AS n FROM audits WHERE user_id IS NULL AND anon_id = ? AND created_at > ? AND ${COUNTED}`, actor.anonId ?? "", since);
}

export interface DomainRow {
  id: number;
  host: string;
  created_at: number;
}

export function userDomains(userId: number): DomainRow[] {
  return getDb().prepare("SELECT id, host, created_at FROM domains WHERE user_id = ? ORDER BY created_at, id").all(userId) as unknown as DomainRow[];
}

/** Domains the user may audit on their current plan (the oldest N if they were downgraded). */
export function activeDomains(user: UserRow, plan: Plan = effectivePlan(user)): DomainRow[] {
  return userDomains(user.id).slice(0, plan.domains);
}

/** Checks plan limits for a new audit. Synchronous so it can run in the same transaction as the reservation. */
export function checkAuditAllowed(actor: Actor, host: string): AuditError | null {
  const since = Date.now() - DAY;
  const { user, anonId, ip } = actor;
  if (!user) {
    if (count("SELECT COUNT(*) AS n FROM audits WHERE user_id IS NULL AND anon_id = ? AND status = 'running'", anonId ?? "")) return "in_progress";
    if (auditsToday(actor) >= ANON_AUDITS_PER_DAY) return "limit_anon";
    if (count(`SELECT COUNT(*) AS n FROM audits WHERE user_id IS NULL AND ip = ? AND created_at > ? AND ${COUNTED}`, ip, since) >= ANON_AUDITS_PER_IP_PER_DAY) return "limit_anon";
    return null;
  }
  const plan = effectivePlan(user);
  if (count("SELECT COUNT(*) AS n FROM audits WHERE user_id = ? AND status = 'running' AND source = 'user'", user.id) >= 2) return "in_progress";
  if (auditsToday(actor) >= plan.auditsPerDay) return "limit_daily";
  const all = userDomains(user.id);
  const active = all.slice(0, plan.domains);
  if (!active.some((d) => d.host === host) && all.length >= plan.domains) return "limit_domains";
  return null;
}

function newId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

/**
 * Reserves a quota slot and starts the audit in the background. Returns the audit id immediately;
 * the report page shows progress until the row is done.
 */
export function startAudit(actor: Actor, host: string): { id: string } | { error: AuditError } {
  const reserved = tx(() => {
    const err = checkAuditAllowed(actor, host);
    if (err) return { error: err } as const;
    const id = newId();
    getDb()
      .prepare("INSERT INTO audits (id, user_id, host, score, pages, result, ip, anon_id, status, source, created_at) VALUES (?, ?, ?, 0, 0, '{}', ?, ?, 'running', 'user', ?)")
      .run(id, actor.user?.id ?? null, host, actor.ip, actor.user ? null : actor.anonId, Date.now());
    return { id } as const;
  });
  if ("error" in reserved) return reserved;
  const plan = effectivePlan(actor.user);
  track("audit_started", { userId: actor.user?.id, anonId: actor.anonId, meta: { host, plan: plan.id } });
  void execute(reserved.id, host, actor.user?.id ?? null, plan);
  return reserved;
}

async function execute(id: string, host: string, userId: number | null, plan: Plan): Promise<AuditResult> {
  let result: AuditResult;
  try {
    result = await runAudit(host, { maxPages: plan.pagesPerAudit, budgetMs: plan.budgetMs });
  } catch (e) {
    console.error("[audit]", host, e);
    result = { host, origin: `https://${host}`, score: 0, potentialScore: 0, pagesCrawled: 0, durationMs: 0, platform: "other", homepage: { url: "", title: "", ms: 0, status: 0, lang: "", arabic: false }, results: [], error: "internal" };
  }
  finish(id, result, userId);
  return result;
}

function finish(id: string, result: AuditResult, userId: number | null): void {
  const db = getDb();
  db.prepare("UPDATE audits SET status = ?, error = ?, score = ?, pages = ?, result = ? WHERE id = ?").run(
    result.error ? "error" : "done",
    result.error ?? null,
    result.score,
    result.pagesCrawled,
    JSON.stringify(result),
    id,
  );
  // Only a successful audit claims a domain slot.
  if (userId && !result.error) db.prepare("INSERT OR IGNORE INTO domains (user_id, host, created_at) VALUES (?, ?, ?)").run(userId, result.host, Date.now());
}

/** Runs an audit synchronously (used by the cron job). Not counted against the user's daily quota. */
export async function runCronAudit(user: UserRow, host: string, plan: Plan): Promise<{ id: string; result: AuditResult }> {
  const id = newId();
  getDb()
    .prepare("INSERT INTO audits (id, user_id, host, score, pages, result, status, source, created_at) VALUES (?, ?, ?, 0, 0, '{}', 'running', 'cron', ?)")
    .run(id, user.id, host, Date.now());
  const result = await execute(id, host, user.id, plan);
  return { id, result };
}

export type AuditWithData = AuditRow & { data: AuditResult | null };

export function getAudit(id: string): AuditWithData | null {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null;
  const row = getDb().prepare("SELECT * FROM audits WHERE id = ?").get(id) as AuditRow | undefined;
  if (!row) return null;
  let data: AuditResult | null = null;
  if (row.status !== "running") {
    try {
      data = JSON.parse(row.result) as AuditResult;
    } catch {
      data = null;
    }
  }
  return { ...row, data };
}

export function auditHistory(userId: number, host: string, limit = 12): { id: string; score: number; created_at: number }[] {
  return getDb()
    .prepare("SELECT id, score, created_at FROM audits WHERE user_id = ? AND host = ? AND status = 'done' ORDER BY created_at DESC LIMIT ?")
    .all(userId, host, limit) as { id: string; score: number; created_at: number }[];
}

export function previousAudit(audit: AuditRow): AuditWithData | null {
  if (!audit.user_id) return null;
  const row = getDb()
    .prepare("SELECT id FROM audits WHERE user_id = ? AND host = ? AND status = 'done' AND created_at < ? ORDER BY created_at DESC LIMIT 1")
    .get(audit.user_id, audit.host, audit.created_at) as { id: string } | undefined;
  return row ? getAudit(row.id) : null;
}

/** Links this browser's anonymous audits (by cookie, never by IP) to a user who just signed up. */
export function claimAnonymousAudits(userId: number, anonId: string | null): void {
  if (!anonId) return;
  const db = getDb();
  const rows = db
    .prepare("SELECT id, host, status FROM audits WHERE user_id IS NULL AND anon_id = ? AND created_at > ? ORDER BY created_at")
    .all(anonId, Date.now() - 7 * DAY) as { id: string; host: string; status: string }[];
  if (!rows.length) return;
  db.prepare("UPDATE audits SET user_id = ? WHERE user_id IS NULL AND anon_id = ?").run(userId, anonId);
  const first = rows.find((r) => r.status === "done");
  if (first && !userDomains(userId).length) db.prepare("INSERT OR IGNORE INTO domains (user_id, host, created_at) VALUES (?, ?, ?)").run(userId, first.host, Date.now());
}

export type RemoveDomainResult = "removed" | "cooldown" | "not_found";

/** Removes a domain from the account (its reports stay readable). Free accounts may swap once per cooldown. */
export function removeDomain(user: UserRow, domainId: number): RemoveDomainResult {
  const db = getDb();
  const plan = effectivePlan(user);
  if (plan.id === "free" && user.domain_changed_at && Date.now() - user.domain_changed_at < DOMAIN_CHANGE_COOLDOWN_DAYS * DAY) return "cooldown";
  const info = db.prepare("DELETE FROM domains WHERE id = ? AND user_id = ?").run(domainId, user.id);
  if (!info.changes) return "not_found";
  db.prepare("UPDATE users SET domain_changed_at = ? WHERE id = ?").run(Date.now(), user.id);
  return "removed";
}

import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb, type UserRow } from "@/lib/db";
import { effectivePlan } from "@/lib/auth";
import { activeDomains, runCronAudit } from "@/lib/audits";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/request";
import { CHECK_BY_ID } from "@/lib/audit/checks";
import { PLANS, type PlanId } from "@/lib/plans";

export const dynamic = "force-dynamic";

const DAY = 86400_000;
const BATCH = Number(process.env.CRON_BATCH || 20);

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  const got = req.headers.get("authorization") || "";
  const want = `Bearer ${secret}`;
  return !!secret && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function takeLock(name: string, ttlMs: number): boolean {
  const db = getDb();
  const now = Date.now();
  db.prepare("DELETE FROM locks WHERE name = ? AND expires_at < ?").run(name, now);
  return db.prepare("INSERT OR IGNORE INTO locks (name, expires_at) VALUES (?, ?)").run(name, now + ttlMs).changes === 1;
}

function releaseLock(name: string): void {
  getDb().prepare("DELETE FROM locks WHERE name = ?").run(name);
}

const wrap = (body: string) => `<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:1.8">${body}</div>`;

/**
 * Monitoring job. Call it every hour or once a day:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/weekly
 * Each call processes at most CRON_BATCH domains (default 20), so call it more often if you have many customers.
 * - Paid plans: re-audit each domain weekly and email a digest (score and change, top issue).
 * - Free plan: re-audit the homepage monthly and email the result.
 * - Renewal reminders 7 days and 1 day before expiry, and on expiry.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!takeLock("cron", 60 * 60_000)) return NextResponse.json({ skipped: "already_running" });
  try {
    return NextResponse.json(await run());
  } finally {
    releaseLock("cron");
  }
}

async function run() {
  const db = getDb();
  const now = Date.now();
  const users = db.prepare("SELECT * FROM users").all() as unknown as UserRow[];
  let audited = 0;
  let emails = 0;
  let reminders = 0;

  for (const user of users) {
    // Renewal reminders (paid plans only).
    if (user.plan !== "free" && user.plan_expires_at) {
      const left = user.plan_expires_at - now;
      const stage = left <= 0 ? (left > -3 * DAY ? "expired" : null) : left <= DAY ? "1d" : left <= 7 * DAY ? "7d" : null;
      const order = ["7d", "1d", "expired"];
      if (stage && order.indexOf(stage) > order.indexOf(user.reminder_stage ?? "")) {
        const period = user.plan_period === "yearly" ? "yearly" : "monthly";
        const price = PLANS[user.plan as PlanId]?.[period] ?? 79;
        const link = `${appUrl()}/checkout?plan=${user.plan}&period=${period}`;
        const subject = stage === "expired" ? "انتهى اشتراكك في تصدّر: متابعتك الأسبوعية متوقفة" : stage === "1d" ? "اشتراكك في تصدّر ينتهي غداً" : "اشتراكك في تصدّر ينتهي خلال 7 أيام";
        await sendEmail(user.email, subject, wrap(`<p>${subject}.</p><p>جدّد بـ ${price} ريال للاستمرار في المتابعة الأسبوعية وكل الحلول.</p><p><a href="${link}">جدّد الآن</a></p>`));
        db.prepare("UPDATE users SET reminder_stage = ? WHERE id = ?").run(stage, user.id);
        reminders++;
      }
    }
  }

  // Re-audits, oldest first, limited per call.
  const plans = new Map(users.map((u) => [u.id, effectivePlan(u)]));
  const due: { user: UserRow; host: string; last?: { id: string; score: number; result: string } }[] = [];
  for (const user of users) {
    const plan = plans.get(user.id)!;
    const every = plan.monitoring ? 7 * DAY : 30 * DAY;
    for (const { host } of activeDomains(user, plan)) {
      const last = db
        .prepare("SELECT id, score, result, created_at FROM audits WHERE user_id = ? AND host = ? AND status IN ('done', 'running') ORDER BY created_at DESC LIMIT 1")
        .get(user.id, host) as { id: string; score: number; result: string; created_at: number } | undefined;
      if (!last || last.created_at < now - every) due.push({ user, host, last });
    }
  }
  for (const { user, host, last } of due.slice(0, BATCH)) {
    const plan = plans.get(user.id)!;
    const { id, result } = await runCronAudit(user, host, plan);
    audited++;
    if (result.error) continue;
    const delta = last ? result.score - last.score : 0;
    const top = result.results.find((r) => !r.passed && !r.platformControlled);
    const topTitle = top ? CHECK_BY_ID[top.id]?.ar.title.replace(/`/g, "") : null;
    const change = last ? (delta === 0 ? "بدون تغيير" : delta > 0 ? `ارتفع ${delta}` : `انخفض ${-delta}`) : "";
    const subject = `تقييم ${host} ${plan.monitoring ? "هذا الأسبوع" : "هذا الشهر"}: ${result.score}/100${change ? ` (${change})` : ""}`;
    const upsell = plan.monitoring ? "" : `<p>تريد متابعة أسبوعية وفحص حتى 100 صفحة؟ <a href="${appUrl()}/pricing">الخطة الاحترافية</a></p>`;
    await sendEmail(
      user.email,
      subject,
      wrap(`<p>${subject}.</p>${topTitle ? `<p>أهم ما يجب إصلاحه الآن: <b>${topTitle}</b></p>` : "<p>لا توجد مشاكل مهمة، أحسنت!</p>"}<p><a href="${appUrl()}/audit/${id}">اعرض التقرير وما الذي تغيّر</a></p>${upsell}`),
    );
    emails++;
  }
  return { users: users.length, due: due.length, audited, emails, reminders };
}

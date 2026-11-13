import { NextResponse, type NextRequest } from "next/server";
import { getDb, type UserRow } from "@/lib/db";
import { effectivePlan } from "@/lib/auth";
import { runAudit } from "@/lib/audit/run";
import { saveAudit } from "@/lib/audits";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/request";

export const maxDuration = 800;

/**
 * Weekly monitoring for paid plans. Call once a day (e.g. from a cron job):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/weekly
 * Re-audits every paid domain not audited in the last 7 days and emails the owner if the score dropped by 5+ points.
 * Also emails a renewal reminder 3 days before a plan expires.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const now = Date.now();
  const weekAgo = now - 7 * 86400_000;
  const users = db.prepare("SELECT * FROM users WHERE plan != 'free' AND plan_expires_at > ?").all(now) as unknown as UserRow[];
  let audited = 0;
  let alerts = 0;
  let reminders = 0;

  for (const user of users) {
    const plan = effectivePlan(user);
    if (!plan.monitoring) continue;
    const domains = db.prepare("SELECT host FROM domains WHERE user_id = ?").all(user.id) as { host: string }[];
    for (const { host } of domains) {
      const last = db
        .prepare("SELECT id, score, created_at FROM audits WHERE user_id = ? AND host = ? ORDER BY created_at DESC LIMIT 1")
        .get(user.id, host) as { id: string; score: number; created_at: number } | undefined;
      if (last && last.created_at > weekAgo) continue;
      const result = await runAudit(host, { maxPages: plan.pagesPerAudit });
      const id = saveAudit(result, user.id, null);
      audited++;
      if (last && !result.error && result.score <= last.score - 5) {
        alerts++;
        await sendEmail(
          user.email,
          `تنبيه: انخفض تقييم ${host} من ${last.score} إلى ${result.score}`,
          `<div dir="rtl" style="font-family:Tahoma,sans-serif"><p>انخفض تقييم السيو لموقع <b>${host}</b> من ${last.score} إلى ${result.score}.</p><p><a href="${appUrl()}/audit/${id}">اعرض التقرير وما الذي تغيّر</a></p><hr><p dir="ltr">Your SEO score for ${host} dropped from ${last.score} to ${result.score}. <a href="${appUrl()}/audit/${id}">View report</a></p></div>`,
        );
      }
    }
    const exp = user.plan_expires_at ?? 0;
    if (exp - now < 3 * 86400_000 && exp - now > 2 * 86400_000) {
      reminders++;
      await sendEmail(
        user.email,
        "اشتراكك في تصدّر ينتهي خلال 3 أيام",
        `<div dir="rtl" style="font-family:Tahoma,sans-serif"><p>اشتراكك ينتهي قريباً. جدّده للاستمرار في المتابعة الأسبوعية وكل الحلول.</p><p><a href="${appUrl()}/checkout?plan=${user.plan}&period=monthly">جدّد الآن</a></p></div>`,
      );
    }
  }
  return NextResponse.json({ users: users.length, audited, alerts, reminders });
}

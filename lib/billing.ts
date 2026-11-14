import { getDb, getUserById, track, tx } from "./db";
import { isPaidPlan, isPeriod, periodDays, PLANS, priceHalalas, vatOf, type Period, type PlanId } from "./plans";
import { sendEmail } from "./email";
import { appUrl } from "./request";

export interface MoyasarPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string> | null;
}

const DAY = 86400_000;

export async function fetchMoyasarPayment(id: string): Promise<MoyasarPayment | null> {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) return null;
  try {
    const res = await fetch(`${process.env.MOYASAR_API_URL || "https://api.moyasar.com/v1"}/payments/${encodeURIComponent(id)}`, {
      headers: { authorization: "Basic " + Buffer.from(`${key}:`).toString("base64") },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as MoyasarPayment;
  } catch (e) {
    console.error("[moyasar] fetch failed", e);
    return null;
  }
}

export type ActivationResult = "activated" | "already_processed" | "not_paid" | "mismatch";

/**
 * New expiry when buying `plan` for `period` while `current` may still be active.
 * Unused days of the current plan are converted to days of the new plan by monthly price,
 * so upgrading or downgrading never throws away paid time.
 */
export function newExpiry(current: { plan: string; plan_expires_at: number | null }, plan: PlanId, period: Period, now = Date.now()): number {
  let creditMs = 0;
  const exp = current.plan_expires_at ?? 0;
  if (isPaidPlan(current.plan) && exp > now) {
    const remaining = exp - now;
    creditMs = current.plan === plan ? remaining : remaining * (PLANS[current.plan].monthly / PLANS[plan].monthly);
  }
  return now + periodDays(period) * DAY + Math.round(creditMs);
}

/**
 * Activates a plan from a payment that was verified server-side with Moyasar.
 * Idempotent: a payment id is only ever applied once (primary key), also across processes.
 */
export function applyVerifiedPayment(p: MoyasarPayment): ActivationResult {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM payments WHERE id = ?").get(p.id)) return "already_processed";
  if (p.status !== "paid") return "not_paid";
  const plan = p.metadata?.plan ?? "";
  const period = p.metadata?.period ?? "";
  const userId = Number(p.metadata?.user_id);
  if (!isPaidPlan(plan) || !isPeriod(period) || !userId) return "mismatch";
  if (p.currency !== "SAR" || p.amount !== priceHalalas(plan, period)) return "mismatch";
  const user = getUserById(userId);
  if (!user) return "mismatch";

  const now = Date.now();
  const expires = newExpiry(user, plan, period, now);
  try {
    tx(() => {
      db.prepare("INSERT INTO payments (id, user_id, plan, period, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(p.id, userId, plan, period, p.amount, p.status, now);
      db.prepare("UPDATE users SET plan = ?, plan_expires_at = ?, plan_period = ?, reminder_stage = NULL WHERE id = ?").run(plan, expires, period, userId);
    });
  } catch (e) {
    if (String(e).includes("UNIQUE") || String(e).includes("PRIMARY")) return "already_processed";
    throw e;
  }
  track("paid", { userId, meta: { plan, period, amount: p.amount } });
  void sendReceipt(user.email, p.id, plan, period, p.amount / 100, expires);
  return "activated";
}

async function sendReceipt(email: string, paymentId: string, plan: PlanId, period: Period, totalSar: number, expires: number): Promise<void> {
  const vat = vatOf(totalSar);
  const date = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "long", timeZone: "Asia/Riyadh" }).format(new Date(expires));
  const vatNo = process.env.VAT_NUMBER ? `<p>الرقم الضريبي: ${process.env.VAT_NUMBER}</p>` : "";
  await sendEmail(
    email,
    `إيصال الدفع: اشتراك تصدّر ${plan === "pro" ? "الاحترافي" : "أعمال"}`,
    `<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:1.8">
      <h2>شكراً لاشتراكك في تصدّر</h2>
      <p>الخطة: ${plan === "pro" ? "الاحترافي" : "أعمال"} (${period === "weekly" ? "أسبوع" : period === "yearly" ? "سنة" : "شهر"})</p>
      <p>المبلغ: ${totalSar.toFixed(2)} ريال، شامل ضريبة القيمة المضافة 15% (${vat.toFixed(2)} ريال)</p>
      <p>رقم العملية: ${paymentId}</p>${vatNo}
      <p>اشتراكك فعّال حتى ${date}. لا يتجدد تلقائياً.</p>
      <p><a href="${appUrl()}/dashboard">افتح لوحتك وابدأ الفحص الكامل</a></p>
    </div>`,
  );
}

import { getDb, type UserRow } from "./db";
import { isPaidPlan, isPeriod, periodDays, priceHalalas, type Period, type PlanId } from "./plans";

export interface MoyasarPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string> | null;
}

export async function fetchMoyasarPayment(id: string): Promise<MoyasarPayment | null> {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) return null;
  const res = await fetch(`${process.env.MOYASAR_API_URL || "https://api.moyasar.com/v1"}/payments/${encodeURIComponent(id)}`, {
    headers: { authorization: "Basic " + Buffer.from(`${key}:`).toString("base64") },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as MoyasarPayment;
}

export type ActivationResult = "activated" | "already_processed" | "not_paid" | "mismatch";

/**
 * Activates a plan from a payment that was verified server-side with Moyasar.
 * Idempotent: a payment id is only ever applied once.
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
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
  if (!user) return "mismatch";

  const now = Date.now();
  const base = user.plan === plan && (user.plan_expires_at ?? 0) > now ? user.plan_expires_at! : now;
  const expires = base + periodDays(period as Period) * 86400_000;
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO payments (id, user_id, plan, period, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      p.id,
      userId,
      plan,
      period,
      p.amount,
      p.status,
      now,
    );
    db.prepare("UPDATE users SET plan = ?, plan_expires_at = ? WHERE id = ?").run(plan as PlanId, expires, userId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return "activated";
}

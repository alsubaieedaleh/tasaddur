export type PlanId = "free" | "pro" | "business";
export type Period = "weekly" | "monthly" | "yearly";

export interface Plan {
  id: PlanId;
  /** Prices in SAR, VAT (15%) included. weekly = one-time 7-day pass (Pro only). */
  weekly?: number;
  monthly: number;
  yearly: number;
  domains: number;
  pagesPerAudit: number;
  auditsPerDay: number;
  /** How many issues show full fix steps; Infinity = all. */
  fixesShown: number;
  monitoring: boolean;
  pdf: boolean;
  whiteLabel: boolean;
  /** Time budget for one audit in ms. */
  budgetMs: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", monthly: 0, yearly: 0, domains: 1, pagesPerAudit: 1, auditsPerDay: 3, fixesShown: 3, monitoring: false, pdf: false, whiteLabel: false, budgetMs: 30_000 },
  pro: { id: "pro", weekly: 29, monthly: 79, yearly: 790, domains: 3, pagesPerAudit: 100, auditsPerDay: 20, fixesShown: Infinity, monitoring: true, pdf: true, whiteLabel: false, budgetMs: 120_000 },
  business: { id: "business", monthly: 199, yearly: 1990, domains: 15, pagesPerAudit: 500, auditsPerDay: 100, fixesShown: Infinity, monitoring: true, pdf: true, whiteLabel: true, budgetMs: 240_000 },
};

/** Anonymous visitors: audits per browser (cookie) per day, plus a generous per-IP backstop for shared carrier IPs. */
export const ANON_AUDITS_PER_DAY = 1;
export const ANON_AUDITS_PER_IP_PER_DAY = 20;
/** Free users can swap their single domain once per this many days. */
export const DOMAIN_CHANGE_COOLDOWN_DAYS = 7;

export function planPrice(plan: PlanId, period: Period): number | null {
  const p = PLANS[plan];
  if (period === "weekly") return p.weekly ?? null;
  return period === "yearly" ? p.yearly : p.monthly;
}

export function priceHalalas(plan: PlanId, period: Period): number | null {
  const sar = planPrice(plan, period);
  return sar === null ? null : Math.round(sar * 100);
}

export function periodDays(period: Period): number {
  return period === "yearly" ? 365 : period === "weekly" ? 7 : 30;
}

export function isPaidPlan(id: string): id is "pro" | "business" {
  return id === "pro" || id === "business";
}

export function isPeriod(v: string): v is Period {
  return v === "monthly" || v === "yearly" || v === "weekly";
}

/** VAT portion of a VAT-inclusive SAR amount (15%). */
export function vatOf(totalSar: number): number {
  return Math.round((totalSar - totalSar / 1.15) * 100) / 100;
}

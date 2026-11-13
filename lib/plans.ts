export type PlanId = "free" | "pro" | "business";
export type Period = "monthly" | "yearly";

export interface Plan {
  id: PlanId;
  /** Prices in SAR, VAT (15%) included. */
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
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", monthly: 0, yearly: 0, domains: 1, pagesPerAudit: 1, auditsPerDay: 3, fixesShown: 3, monitoring: false, pdf: false, whiteLabel: false },
  pro: { id: "pro", monthly: 79, yearly: 790, domains: 3, pagesPerAudit: 100, auditsPerDay: 20, fixesShown: Infinity, monitoring: true, pdf: true, whiteLabel: false },
  business: { id: "business", monthly: 199, yearly: 1990, domains: 15, pagesPerAudit: 500, auditsPerDay: 100, fixesShown: Infinity, monitoring: true, pdf: true, whiteLabel: true },
};

/** Anonymous visitors get this many audits per IP per day before they must sign up. */
export const ANON_AUDITS_PER_DAY = 1;

export function priceHalalas(plan: PlanId, period: Period): number {
  const p = PLANS[plan];
  return Math.round((period === "yearly" ? p.yearly : p.monthly) * 100);
}

export function periodDays(period: Period): number {
  return period === "yearly" ? 365 : 30;
}

export function isPaidPlan(id: string): id is "pro" | "business" {
  return id === "pro" || id === "business";
}

export function isPeriod(v: string): v is Period {
  return v === "monthly" || v === "yearly";
}

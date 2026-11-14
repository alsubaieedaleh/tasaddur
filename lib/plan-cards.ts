import type { PlanCard, PricingLabels } from "@/components/Pricing";
import type { AuditFormLabels } from "@/components/AuditForm";
import type { Dict } from "./i18n";
import { PLANS, type PlanId } from "./plans";

/** Feature bullets for a plan (pricing cards and checkout summary). */
export function planFeatures(t: Dict, id: PlanId): string[] {
  const p = PLANS[id];
  const features = [
    t.featDomains(p.domains),
    t.featPages(p.pagesPerAudit),
    t.featAudits(p.auditsPerDay),
    Number.isFinite(p.fixesShown) ? t.featFixesTop(p.fixesShown) : t.featFixesAll,
    p.monitoring ? t.featMonitoring : t.featMonthly,
  ];
  if (p.pdf) features.push(t.featPdf);
  if (p.whiteLabel) features.push(t.featWhiteLabel);
  return features;
}

export function planCards(t: Dict): PlanCard[] {
  return (Object.keys(PLANS) as PlanId[]).map((id) => {
    const p = PLANS[id];
    return { id, name: t.planNames[id], desc: t.planDesc[id], monthly: p.monthly, yearly: p.yearly, weekly: p.weekly, yearlyNote: p.yearly ? t.yearlyEquiv(Math.round(p.yearly / 12), p.monthly * 12 - p.yearly) : undefined, weeklyNote: p.weekly ? t.weeklyPass(p.weekly) : undefined, features: planFeatures(t, id), featured: id === "pro" };
  });
}

export function pricingLabels(t: Dict): PricingLabels {
  return {
    monthly: t.monthly,
    yearly: t.yearly,
    perMonth: t.perMonth,
    perYear: t.perYear,
    startFree: t.startFree,
    choose: t.choosePlan,
    current: t.currentPlan,
    free: t.freePrice,
    popular: t.popular,
  };
}

export function auditLabels(t: Dict, paid = false): AuditFormLabels {
  return {
    label: t.domainLabel,
    placeholder: t.domainPlaceholder,
    cta: paid ? t.auditCtaPaid : t.auditCta,
    pending: t.auditing,
    signup: t.signupFree,
    upgrade: t.upgrade,
    changeDomain: t.changeDomain,
  };
}

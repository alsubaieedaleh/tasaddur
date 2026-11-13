import type { PlanCard } from "@/components/Pricing";
import type { Dict } from "./i18n";
import { PLANS, type PlanId } from "./plans";

export function planCards(t: Dict): PlanCard[] {
  return (Object.keys(PLANS) as PlanId[]).map((id) => {
    const p = PLANS[id];
    const features = [
      t.featDomains(p.domains),
      t.featPages(p.pagesPerAudit),
      t.featAudits(p.auditsPerDay),
      Number.isFinite(p.fixesShown) ? t.featFixesTop(p.fixesShown) : t.featFixesAll,
    ];
    if (p.monitoring) features.push(t.featMonitoring);
    if (p.pdf) features.push(t.featPdf);
    if (p.whiteLabel) features.push(t.featWhiteLabel);
    return { id, name: t.planNames[id], desc: t.planDesc[id], monthly: p.monthly, yearly: p.yearly, features, featured: id === "pro" };
  });
}

export function pricingLabels(t: Dict) {
  return {
    monthly: t.monthly,
    yearly: t.yearly,
    perMonth: t.perMonth,
    perYear: t.perYear,
    startFree: t.startFree,
    choose: t.choosePlan,
    current: t.currentPlan,
  };
}

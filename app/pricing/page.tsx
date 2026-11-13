import type { Metadata } from "next";
import Pricing from "@/components/Pricing";
import { getT } from "@/lib/i18n";
import { getUser, effectivePlan } from "@/lib/auth";
import { planCards, pricingLabels } from "@/lib/plan-cards";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t.pricing };
}

export default async function PricingPage() {
  const { t } = await getT();
  const user = await getUser();
  return (
    <section className="section">
      <div className="container">
        <h1 style={{ textAlign: "center" }}>{t.pricingTitle}</h1>
        <p className="lead">{t.pricingSub}</p>
        <Pricing plans={planCards(t)} labels={pricingLabels(t)} loggedIn={!!user} currentPlan={user ? effectivePlan(user).id : undefined} />
        <p className="pay-logos">mada · Apple Pay · STC Pay · Visa · Mastercard</p>
      </div>
    </section>
  );
}

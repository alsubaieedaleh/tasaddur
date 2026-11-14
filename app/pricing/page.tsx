import type { Metadata } from "next";
import Pricing from "@/components/Pricing";
import { getT } from "@/lib/i18n";
import { getUser, effectivePlan } from "@/lib/auth";
import { planCards, pricingLabels } from "@/lib/plan-cards";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: { absolute: t.pricingMetaTitle }, description: t.pricingSub, alternates: { canonical: "/pricing" } };
}

export default async function PricingPage() {
  const { t } = await getT();
  const user = await getUser();
  return (
    <section className="section">
      <div className="container">
        <h1 className="center">{t.pricingTitle}</h1>
        <p className="lead">{t.pricingSub}</p>
        <Pricing plans={planCards(t)} labels={pricingLabels(t)} loggedIn={!!user} currentPlan={user ? effectivePlan(user).id : undefined} />
        <p className="pay-logos">mada · Apple Pay · STC Pay · Visa · Mastercard</p>
        <div className="container narrow mt-32">
          <h2>{t.faqTitle}</h2>
          {t.faq.map(([q, a]) => (
            <details className="faq" key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

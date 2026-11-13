import AuditForm from "@/components/AuditForm";
import Pricing from "@/components/Pricing";
import { getT } from "@/lib/i18n";
import { getUser, effectivePlan } from "@/lib/auth";
import { planCards, pricingLabels } from "@/lib/plan-cards";

export default async function Home() {
  const { t } = await getT();
  const user = await getUser();
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>{t.heroTitle}</h1>
          <p className="sub">{t.heroSub}</p>
          <AuditForm placeholder={t.domainPlaceholder} cta={t.auditCta} pending={t.auditing} signupLabel={t.signup} upgradeLabel={t.upgrade} />
          <p className="hint">{t.noSignup}</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid grid-4">
            {[
              [t.feat1t, t.feat1d],
              [t.feat2t, t.feat2d],
              [t.feat3t, t.feat3d],
              [t.feat4t, t.feat4d],
            ].map(([title, desc]) => (
              <div className="card" key={title}>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container narrow">
          <div className="saudi-box">
            <h2 style={{ textAlign: "start" }}>{t.saudiTitle}</h2>
            <ul>
              {t.saudiItems.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="container">
          <h2>{t.pricingTitle}</h2>
          <p className="lead">{t.pricingSub}</p>
          <Pricing plans={planCards(t)} labels={pricingLabels(t)} loggedIn={!!user} currentPlan={user ? effectivePlan(user).id : undefined} />
          <p className="pay-logos">mada · Apple Pay · STC Pay · Visa · Mastercard</p>
        </div>
      </section>

      <section className="section">
        <div className="container narrow">
          <h2>{t.faqTitle}</h2>
          <div style={{ marginTop: 24 }}>
            {t.faq.map(([q, a]) => (
              <details className="faq" key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

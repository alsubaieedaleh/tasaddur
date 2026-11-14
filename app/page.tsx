import type { Metadata } from "next";
import AuditForm from "@/components/AuditForm";
import Pricing from "@/components/Pricing";
import { getT } from "@/lib/i18n";
import { getUser, effectivePlan } from "@/lib/auth";
import { auditLabels, planCards, pricingLabels } from "@/lib/plan-cards";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const PLATFORMS = ["سلة · Salla", "زد · Zid", "WordPress", "Shopify"];

export default async function Home() {
  const { t } = await getT();
  const user = await getUser();
  const plan = user ? effectivePlan(user) : null;
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>{t.heroTitle}</h1>
          <p className="sub">{t.heroSub}</p>
          <AuditForm labels={auditLabels(t, !!plan && plan.id !== "free")} hideLabel />
          <p className="hint">{t.noSignup}</p>
          <p className="platforms">
            <span>{t.worksWith}:</span>
            {PLATFORMS.map((p) => (
              <span key={p} className="platform" dir="auto">
                {p}
              </span>
            ))}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container narrow">
          <div className="sample card" aria-label={t.sampleTitle}>
            <p className="sample-title">{t.sampleTitle}</p>
            <div className="sample-row">
              <div className="sample-score">
                <strong>62</strong>
                <span>{t.scoreOf}</span>
              </div>
              <ul>
                {t.sampleIssues.map((issue, i) => (
                  <li key={issue}>
                    <span className={`badge ${i === 0 ? "critical" : "important"}`}>{t.severity[i === 0 ? "critical" : "important"]}</span> {issue}
                  </li>
                ))}
              </ul>
            </div>
          </div>
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
            <h2 className="start">{t.saudiTitle}</h2>
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
          <Pricing plans={planCards(t)} labels={pricingLabels(t)} loggedIn={!!user} currentPlan={plan?.id} />
          <p className="pay-logos">mada · Apple Pay · STC Pay · Visa · Mastercard</p>
        </div>
      </section>

      <section className="section">
        <div className="container narrow">
          <h2>{t.faqTitle}</h2>
          <div className="mt-24">
            {t.faq.map(([q, a]) => (
              <details className="faq" key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: t.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}

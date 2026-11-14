import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import MoyasarForm from "@/components/MoyasarForm";
import { getUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { planFeatures } from "@/lib/plan-cards";
import { PLANS, isPaidPlan, isPeriod, planPrice, priceHalalas, vatOf } from "@/lib/plans";
import { appUrl } from "@/lib/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Checkout({ searchParams }: { searchParams: Promise<{ plan?: string; period?: string }> }) {
  const { plan = "", period = "monthly" } = await searchParams;
  if (!isPaidPlan(plan) || !isPeriod(period)) redirect("/pricing");
  const amount = priceHalalas(plan, period);
  const price = planPrice(plan, period);
  if (amount === null || price === null) redirect("/pricing");
  const user = await getUser();
  if (!user) redirect(`/signup?next=${encodeURIComponent(`/checkout?plan=${plan}&period=${period}`)}`);
  const { t, lang } = await getT();
  const key = process.env.MOYASAR_PUBLISHABLE_KEY;
  const label = `${t.planNames[plan]} · ${t.periodNames[period]}`;
  const yearlyPerMonth = Math.round(PLANS[plan].yearly / 12);

  return (
    <div className="container">
      <div className="auth card checkout">
        <h1>{t.checkoutTitle}</h1>
        <p>
          <strong>{label}</strong>
        </p>
        <h2 className="h4">{t.checkoutIncludes}</h2>
        <ul className="check-list">
          {planFeatures(t, plan).map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="total">
          {t.checkoutTotal}: <strong>{price.toLocaleString("en-US")} {t.sar}</strong>{" "}
          <span className="hint">
            ({lang === "ar" ? "منها ضريبة" : "VAT"} {vatOf(price).toFixed(2)})
          </span>
        </p>
        <p className="hint">{t.checkoutNoRenew}</p>
        {period === "monthly" && plan === "pro" && (
          <p>
            <Link href="/checkout?plan=pro&period=yearly">{t.switchToYearly(yearlyPerMonth)}</Link>
          </p>
        )}
        {key ? (
          <MoyasarForm
            amount={amount}
            description={`Tasaddur ${plan} (${period})`}
            publishableKey={key}
            callbackUrl={`${appUrl()}/api/payments/callback`}
            metadata={{ user_id: String(user.id), plan, period }}
            language={lang}
          />
        ) : (
          <div className="error">{t.paymentNotConfigured}</div>
        )}
        <p className="hint mt-12">{t.checkoutSecure}</p>
        <p className="guarantee">{t.checkoutGuarantee}</p>
      </div>
    </div>
  );
}

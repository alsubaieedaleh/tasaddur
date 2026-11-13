import { redirect } from "next/navigation";
import MoyasarForm from "@/components/MoyasarForm";
import { getUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { PLANS, isPaidPlan, isPeriod, priceHalalas } from "@/lib/plans";
import { appUrl } from "@/lib/request";

export const dynamic = "force-dynamic";

export default async function Checkout({ searchParams }: { searchParams: Promise<{ plan?: string; period?: string }> }) {
  const { plan = "", period = "monthly" } = await searchParams;
  if (!isPaidPlan(plan) || !isPeriod(period)) redirect("/pricing");
  const user = await getUser();
  if (!user) redirect(`/signup?next=${encodeURIComponent(`/checkout?plan=${plan}&period=${period}`)}`);
  const { t, lang } = await getT();
  const amount = priceHalalas(plan, period);
  const key = process.env.MOYASAR_PUBLISHABLE_KEY;
  const label = `${t.planNames[plan]} · ${period === "yearly" ? t.yearly : t.monthly}`;
  const price = period === "yearly" ? PLANS[plan].yearly : PLANS[plan].monthly;

  return (
    <div className="container">
      <div className="auth card" style={{ maxWidth: 480 }}>
        <h1>{t.checkoutTitle}</h1>
        <p>
          <strong>{label}</strong>
        </p>
        <p>
          {t.checkoutTotal}: <strong>{price.toLocaleString("en-US")} {t.sar}</strong>
        </p>
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
        <p className="hint" style={{ marginTop: 12 }}>{t.checkoutSecure}</p>
      </div>
    </div>
  );
}

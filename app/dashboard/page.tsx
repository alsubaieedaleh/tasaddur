import Link from "next/link";
import { redirect } from "next/navigation";
import AuditForm from "@/components/AuditForm";
import { effectivePlan, getUser } from "@/lib/auth";
import { auditHistory, auditsSince, userDomains } from "@/lib/audits";
import { formatDate, getT } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ paid?: string; rerun?: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard");
  const { t, lang } = await getT();
  const { paid, rerun } = await searchParams;
  const plan = effectivePlan(user);
  const domains = userDomains(user.id).map((d) => ({ ...d, history: auditHistory(user.id, d.host) }));
  const usedToday = auditsSince({ userId: user.id }, Date.now() - 86400_000);
  const expired = user.plan !== "free" && plan.id === "free";

  return (
    <div className="container">
      {paid === "1" && <div className="notice">{t.paidSuccess}</div>}
      {paid === "0" && <div className="error">{t.paidFailed}</div>}
      <div className="dash-top">
        <div>
          <h1 style={{ marginBottom: 4 }}>{t.dashboard}</h1>
          <div className="meta">
            <span>
              {t.planLabel}: <strong>{t.planNames[plan.id]}</strong>
            </span>
            {plan.id !== "free" && user.plan_expires_at && (
              <span>
                {t.expires}: {formatDate(user.plan_expires_at, lang)}
              </span>
            )}
            <span>{t.usageToday(usedToday, plan.auditsPerDay)}</span>
            <span>{t.domainsUsage(domains.length, plan.domains)}</span>
            <span dir="ltr">{user.email}</span>
          </div>
        </div>
        {plan.id === "free" ? (
          <Link className="btn" href="/pricing">
            {expired ? t.renew : t.upgrade}
          </Link>
        ) : (
          <Link className="btn secondary" href={`/checkout?plan=${plan.id}&period=monthly`}>
            {t.renew}
          </Link>
        )}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t.addDomain}</h3>
        <AuditForm
          placeholder={t.domainPlaceholder}
          cta={t.auditCta}
          pending={t.auditing}
          signupLabel={t.signup}
          upgradeLabel={t.upgrade}
          defaultValue={rerun}
          key={rerun || "new"}
        />
      </div>

      <h2>{t.myDomains}</h2>
      {domains.length === 0 ? (
        <p className="hint">{t.noDomains}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.myDomains}</th>
              <th>{t.lastScore}</th>
              <th className="hide-sm">{t.history}</th>
              <th className="hide-sm">{t.auditedAt}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => {
              const last = d.history[0];
              return (
                <tr key={d.id}>
                  <td className="host">{d.host}</td>
                  <td>{last ? <span className="score-pill">{last.score}</span> : "—"}</td>
                  <td className="hide-sm">
                    <span className="spark" aria-label={d.history.map((h) => h.score).reverse().join(", ")}>
                      {[...d.history].reverse().map((h) => (
                        <i key={h.id} style={{ height: `${Math.max(8, h.score)}%` }} />
                      ))}
                    </span>
                  </td>
                  <td className="hide-sm">{last ? formatDate(last.created_at, lang) : "—"}</td>
                  <td>
                    {last && (
                      <Link className="btn small secondary" href={`/audit/${last.id}`}>
                        {t.viewReport}
                      </Link>
                    )}{" "}
                    <Link className="btn small secondary" href={`/dashboard?rerun=${encodeURIComponent(d.host)}`}>
                      {t.rerun}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

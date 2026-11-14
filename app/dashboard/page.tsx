import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AuditForm from "@/components/AuditForm";
import { removeDomainAction, saveAgencyNameAction } from "@/app/actions";
import { effectivePlan, getUser } from "@/lib/auth";
import { auditHistory, auditsToday, userDomains } from "@/lib/audits";
import { formatDate, getT } from "@/lib/i18n";
import { auditLabels } from "@/lib/plan-cards";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const DAY = 86400_000;

function scoreClass(s: number) {
  return s >= 85 ? "good" : s >= 50 ? "important" : "critical";
}

type Search = { paid?: string; rerun?: string; removed?: string; saved?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard");
  const { t, lang } = await getT();
  const { paid, rerun, removed, saved } = await searchParams;
  const plan = effectivePlan(user);
  const isPaid = plan.id !== "free";
  const domains = userDomains(user.id).map((d, i) => ({ ...d, active: i < plan.domains, history: auditHistory(user.id, d.host) }));
  const usedToday = auditsToday({ user, anonId: null });
  const expired = user.plan !== "free" && !isPaid;
  const expiresSoon = isPaid && !!user.plan_expires_at && user.plan_expires_at - Date.now() < 7 * DAY;
  const period = user.plan_period === "yearly" ? "yearly" : "monthly";
  const firstHost = domains[0]?.host;

  return (
    <div className="container">
      {paid === "1" && isPaid && (
        <div className="notice onboarding">
          <p>
            <strong>{t.paidSuccess(t.planNames[plan.id], user.plan_expires_at ? formatDate(user.plan_expires_at, lang) : "")}</strong>
          </p>
          <p>{t.paidNext}</p>
          {firstHost && (
            <Link className="btn" href={`/dashboard?rerun=${encodeURIComponent(firstHost)}#audit`}>
              {t.fullAuditCta(firstHost)}
            </Link>
          )}
        </div>
      )}
      {paid === "0" && <div className="error" role="alert">{t.paidFailed}</div>}
      {removed === "removed" && <div className="notice">{t.removedOk}</div>}
      {removed === "cooldown" && <div className="error" role="alert">{t.removedCooldown}</div>}
      {saved === "1" && <div className="notice">{t.saved}</div>}

      <div className="dash-top">
        <div>
          <h1 className="mb-4">{t.dashboard}</h1>
          <div className="meta">
            <span>
              {t.planLabel}: <strong>{t.planNames[plan.id]}</strong>
            </span>
            {isPaid && user.plan_expires_at && (
              <span>
                {t.expires}: {formatDate(user.plan_expires_at, lang)}
              </span>
            )}
            <span>{t.usageToday(usedToday, plan.auditsPerDay)}</span>
            <span>{t.domainsUsage(Math.min(domains.length, plan.domains), plan.domains)}</span>
            <span dir="ltr">{user.email}</span>
          </div>
          {!isPaid && <p className="hint">{t.freeSummary}</p>}
        </div>
        <div className="actions">
          {!isPaid && (
            <Link className="btn" href={expired ? `/checkout?plan=${user.plan}&period=${period}` : "/pricing"}>
              {expired ? t.renew : t.upgrade}
            </Link>
          )}
          {expiresSoon && (
            <Link className="btn" href={`/checkout?plan=${plan.id}&period=${period}`}>
              {t.renew}
            </Link>
          )}
          {plan.id === "pro" && (
            <Link className="btn secondary" href="/checkout?plan=business&period=monthly">
              {t.upgradeBusiness}
            </Link>
          )}
        </div>
      </div>

      <div className="card mb-24" id="audit">
        <h2 className="h3">{t.addDomain}</h2>
        <AuditForm labels={auditLabels(t, isPaid)} defaultValue={rerun} key={rerun || "new"} />
      </div>

      <h2 id="domains">{t.myDomains}</h2>
      {domains.length === 0 ? (
        <p className="hint">{t.noDomains}</p>
      ) : (
        <ul className="domain-list">
          {domains.map((d) => {
            const last = d.history[0];
            const before = d.history[1];
            const delta = last && before ? last.score - before.score : null;
            return (
              <li key={d.id} className={`card domain${d.active ? "" : " inactive"}`}>
                <div className="domain-main">
                  <span className="host" dir="ltr">{d.host}</span>
                  {last ? (
                    <span className={`score-pill ${scoreClass(last.score)}`} aria-label={`${t.lastScore}: ${last.score}`}>
                      {last.score}
                    </span>
                  ) : (
                    <span className="score-pill">—</span>
                  )}
                  {delta !== null && delta !== 0 && (
                    <span className={delta > 0 ? "delta good" : "delta bad"} dir="ltr">
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  )}
                  {d.history.length > 1 && (
                    <span className="spark" role="img" aria-label={`${t.history}: ${[...d.history].reverse().map((h) => h.score).join(", ")}`}>
                      {[...d.history].reverse().map((h) => (
                        <i key={h.id} style={{ height: `${Math.max(8, h.score)}%` }} />
                      ))}
                    </span>
                  )}
                </div>
                <div className="domain-meta">{last ? `${t.auditedAt}: ${formatDate(last.created_at, lang)}` : ""}</div>
                <div className="actions">
                  {last && (
                    <Link className="btn small secondary" href={`/audit/${last.id}`}>
                      {t.viewReport}
                    </Link>
                  )}
                  {d.active && (
                    <Link className="btn small secondary" href={`/dashboard?rerun=${encodeURIComponent(d.host)}#audit`}>
                      {t.rerun}
                    </Link>
                  )}
                  <form action={removeDomainAction}>
                    <input type="hidden" name="id" value={d.id} />
                    <button type="submit" className="linkbtn danger" title={t.removeConfirm}>
                      {t.remove}
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {domains.length > 0 && <p className="hint">{t.removeConfirm}</p>}

      {plan.whiteLabel && (
        <div className="card mt-32">
          <h2 className="h3">{t.agencyTitle}</h2>
          <p className="hint">{t.agencyHint}</p>
          <form action={saveAgencyNameAction} className="inline-form">
            <input name="agency" maxLength={80} defaultValue={user.agency_name ?? ""} aria-label={t.agencyTitle} />
            <button className="btn" type="submit">
              {t.save}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

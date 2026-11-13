import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AuditForm from "@/components/AuditForm";
import CopyButton from "@/components/CopyButton";
import PrintButton from "@/components/PrintButton";
import { getAudit } from "@/lib/audits";
import { effectivePlan, getUser } from "@/lib/auth";
import { CHECK_BY_ID, CHECK_NAMES } from "@/lib/audit/checks";
import { getDb, type UserRow } from "@/lib/db";
import { formatDate, getT } from "@/lib/i18n";
import { appUrl } from "@/lib/request";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const audit = getAudit(id);
  return { title: audit ? `${audit.host} · ${audit.score}/100` : "404", robots: { index: false } };
}

function safeDecode(u: string) {
  try {
    return decodeURI(u);
  } catch {
    return u;
  }
}

function scoreColor(s: number) {
  return s >= 85 ? "var(--good)" : s >= 50 ? "var(--important)" : "var(--critical)";
}

function Ring({ score, of }: { score: number; of: string }) {
  const r = 64;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`${score}/100`}>
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
        <circle cx="75" cy="75" r={r} fill="none" stroke={scoreColor(score)} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} />
      </svg>
      <div className="val">
        <div>
          <strong style={{ color: scoreColor(score) }}>{score}</strong>
          <span>{of}</span>
        </div>
      </div>
    </div>
  );
}

export default async function AuditPage({ params }: Params) {
  const { id } = await params;
  const audit = getAudit(id);
  if (!audit) notFound();
  const { t, lang } = await getT();
  const viewer = await getUser();
  const owner = audit.user_id ? (getDb().prepare("SELECT * FROM users WHERE id = ?").get(audit.user_id) as UserRow | undefined) ?? null : null;
  const ownerPlan = effectivePlan(owner);
  const viewerPlan = effectivePlan(viewer);
  const fixesShown = Math.max(ownerPlan.fixesShown, viewerPlan.fixesShown);
  const canPdf = ownerPlan.pdf || viewerPlan.pdf;
  const whiteLabel = ownerPlan.whiteLabel;
  const isOwner = !!viewer && viewer.id === audit.user_id;
  const r = audit.data;

  const issues = r.results.filter((x) => !x.passed);
  const passed = r.results.filter((x) => x.passed);
  const counts = { critical: 0, important: 0, minor: 0 };
  issues.forEach((i) => counts[i.severity]++);
  const reportUrl = `${appUrl()}/audit/${audit.id}`;
  const shareText = t.shareText(audit.host, audit.score);
  const locked = issues.length > fixesShown;

  if (r.error) {
    return (
      <div className="container narrow">
        <div className="report-head">
          <Ring score={0} of={t.scoreOf} />
          <div>
            <h1>{audit.host}</h1>
            <div className="error">{t.errUnreachable}</div>
          </div>
        </div>
        <AuditForm placeholder={t.domainPlaceholder} cta={t.auditCta} pending={t.auditing} signupLabel={t.signup} upgradeLabel={t.upgrade} defaultValue={audit.host} />
      </div>
    );
  }

  return (
    <div className="container narrow">
      {!whiteLabel && <p className="print-only">{t.brand} · {t.tagline}</p>}
      <div className="report-head">
        <Ring score={audit.score} of={t.scoreOf} />
        <div>
          <h1>{audit.host}</h1>
          <div className="meta">
            <span>{t.scoreLabel(audit.score)}</span>
            <span>{t.pagesChecked(audit.pages)}</span>
            <span>
              {t.responseTime}: {r.homepage.ms} {t.ms}
            </span>
            <span>{r.homepage.arabic ? t.arabicSite : t.notArabicSite}</span>
            <span>
              {t.auditedAt}: {formatDate(audit.created_at, lang)}
            </span>
          </div>
          <div className="actions">
            <a className="btn small secondary" target="_blank" rel="noopener" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(appUrl())}`}>
              X · {t.share}
            </a>
            <a className="btn small secondary" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${appUrl()}\n${reportUrl}`)}`}>
              WhatsApp
            </a>
            {canPdf && <PrintButton label={t.downloadPdf} />}
            {isOwner && (
              <Link className="btn small secondary" href={`/dashboard?rerun=${encodeURIComponent(audit.host)}`}>
                {t.rerun}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="summary">
        {(["critical", "important", "minor"] as const).map((s) => (
          <div className="card" key={s}>
            <strong style={{ color: `var(--${s})` }}>{counts[s]}</strong>
            <span className={`badge ${s}`}>{t.severity[s]}</span>
          </div>
        ))}
      </div>

      <h2>{t.issuesFound(issues.length)}</h2>
      {issues.map((res, idx) => {
        const def = CHECK_BY_ID[res.id];
        if (!def) return null;
        const copy = def[lang];
        const open = idx < fixesShown;
        const snippet = def.snippet?.({ host: r.host, origin: r.origin });
        return (
          <details key={res.id} className={`issue ${res.severity}`} open={open && idx < 3}>
            <summary>
              <span className={`badge ${res.severity}`}>{t.severity[res.severity]}</span>
              <span className="title">{copy.title}</span>
              <span className="badge cat">{t.categories[res.category]}</span>
              {res.checkedCount > 1 && (
                <span className="count">
                  {res.affectedCount}/{res.checkedCount}
                </span>
              )}
            </summary>
            <div className="body">
              <h4>{t.whyMatters}</h4>
              <p>{copy.why}</p>
              {open ? (
                <>
                  <h4>{t.howToFix}</h4>
                  <p>{copy.fix}</p>
                  {snippet && (
                    <div className="snippet">
                      <pre>
                        <code>{snippet}</code>
                      </pre>
                      <CopyButton text={snippet} label={t.copy} done={t.copied} />
                    </div>
                  )}
                  {res.affected.length > 0 && res.checkedCount > 1 && (
                    <>
                      <h4>{t.affectedPages}</h4>
                      <ul className="affected">
                        {res.affected.map((u) => (
                          <li key={u}>{safeDecode(u)}</li>
                        ))}
                        {res.affectedCount > res.affected.length && <li>…</li>}
                      </ul>
                    </>
                  )}
                </>
              ) : (
                <div className="locked">
                  <h4>{t.howToFix}</h4>
                  <p className="blur" aria-hidden>
                    ████████ ██████ ████ ██████████ ███ █████ ████████ ██████ ████ ███████
                  </p>
                  <Link href={viewer ? "/checkout?plan=pro&period=monthly" : `/signup?next=${encodeURIComponent("/checkout?plan=pro&period=monthly")}`}>
                    {t.unlock}
                  </Link>
                </div>
              )}
            </div>
          </details>
        );
      })}

      {locked && (
        <div className="upsell">
          <h3>{t.lockedTitle}</h3>
          <p>{viewer ? t.lockedBody : t.lockedSignup}</p>
          <Link className="btn" href={viewer ? "/checkout?plan=pro&period=monthly" : `/signup?next=${encodeURIComponent(`/audit/${audit.id}`)}`}>
            {viewer ? t.unlock : t.signup}
          </Link>
        </div>
      )}

      {passed.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>
            {t.passedChecks} ({passed.length})
          </h2>
          <ul className="passed">
            {passed.map((p) => (
              <li key={p.id}>{CHECK_NAMES[p.id]?.[lang]}</li>
            ))}
          </ul>
        </>
      )}

      <div className="section no-print">
        <h2>{t.newAudit}</h2>
        <AuditForm placeholder={t.domainPlaceholder} cta={t.auditCta} pending={t.auditing} signupLabel={t.signup} upgradeLabel={t.upgrade} />
      </div>
    </div>
  );
}

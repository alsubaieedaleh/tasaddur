import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AuditForm from "@/components/AuditForm";
import AuditPoller from "@/components/AuditPoller";
import CopyButton from "@/components/CopyButton";
import PrintButton from "@/components/PrintButton";
import Rich from "@/components/Rich";
import { getAudit, previousAudit } from "@/lib/audits";
import { effectivePlan, getUser } from "@/lib/auth";
import { CHECK_BY_ID, type Severity } from "@/lib/audit/checks";
import type { CheckResult } from "@/lib/audit/run";
import { getUserById } from "@/lib/db";
import { formatDate, getT, type Dict } from "@/lib/i18n";
import { auditLabels } from "@/lib/plan-cards";
import { appUrl } from "@/lib/request";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const audit = getAudit(id);
  const title = audit ? (audit.status === "done" ? `${audit.host} · ${audit.score}/100` : audit.host) : "404";
  return { title, robots: { index: false, follow: true } };
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

function Ring({ score, of, spinning }: { score: number; of: string; spinning?: boolean }) {
  const r = 64;
  const c = 2 * Math.PI * r;
  return (
    <div className={`ring${spinning ? " spinning" : ""}`} role="img" aria-label={spinning ? undefined : `${score}/100`}>
      <svg width="150" height="150" viewBox="0 0 150 150" aria-hidden>
        <circle cx="75" cy="75" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
        <circle
          cx="75"
          cy="75"
          r={r}
          fill="none"
          stroke={spinning ? "var(--brand)" : scoreColor(score)}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={spinning ? `${c * 0.25} ${c}` : `${(c * score) / 100} ${c}`}
        />
      </svg>
      {!spinning && (
        <div className="val">
          <div>
            <strong style={{ color: scoreColor(score) }}>{score}</strong>
            <span>{of}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function errorMessage(t: Dict, code: string): string {
  if (code === "bot_protected") return t.errBotProtected;
  if (code === "blocked_host") return t.errBlockedHost;
  return t.errUnreachable;
}

const GROUPS: Severity[] = ["critical", "important", "minor"];

export default async function AuditPage({ params }: Params) {
  const { id } = await params;
  const audit = getAudit(id);
  if (!audit) notFound();
  const { t, lang } = await getT();
  const viewer = await getUser();
  const viewerPlan = effectivePlan(viewer);
  const labels = auditLabels(t, viewerPlan.id !== "free");

  if (audit.status === "running") {
    return (
      <div className="container narrow">
        <AuditPoller />
        <div className="report-head" aria-live="polite">
          <Ring score={0} of={t.scoreOf} spinning />
          <div>
            <h1 dir="ltr" className="host-title">{audit.host}</h1>
            <p className="running-title">{t.auditRunningTitle}</p>
            <p className="hint">{t.auditRunningHint}</p>
          </div>
        </div>
      </div>
    );
  }

  const r = audit.data;
  if (!r || r.error || audit.status === "error") {
    return (
      <div className="container narrow">
        {/* No score ring here: the site wasn't audited, so a "0 / 100" would read as a bad score. */}
        <div className="report-error">
          <h1 dir="ltr" className="host-title">{audit.host}</h1>
          <div>
            <div className="error" role="alert">{errorMessage(t, r?.error ?? audit.error ?? "")}</div>
          </div>
        </div>
        <AuditForm labels={labels} defaultValue={audit.host} />
      </div>
    );
  }

  const owner = audit.user_id ? getUserById(audit.user_id) : null;
  const ownerPlan = effectivePlan(owner);
  const fixesShown = Math.max(ownerPlan.fixesShown, viewerPlan.fixesShown);
  const canPdf = ownerPlan.pdf || viewerPlan.pdf;
  const agency = ownerPlan.whiteLabel ? owner?.agency_name : null;
  const isOwner = !!viewer && viewer.id === audit.user_id;
  const platform = r.platform && r.platform !== "other" ? r.platform : null;

  const issues = r.results.filter((x) => !x.passed);
  const passed = r.results.filter((x) => x.passed);
  const scored = issues.filter((x) => !x.platformControlled);
  const counts: Record<Severity, number> = { critical: 0, important: 0, minor: 0 };
  scored.forEach((i) => counts[i.severity]++);
  const lockedCount = Math.max(0, issues.length - fixesShown);
  const lockedCritical = issues.slice(fixesShown).filter((i) => i.severity === "critical" && !i.platformControlled).length;

  // "What changed" against the owner's previous audit of this host.
  const prev = isOwner ? previousAudit(audit) : null;
  let diff: { fixed: number; added: number; delta: number } | null = null;
  if (prev?.data && !prev.data.error) {
    const before = new Set(prev.data.results.filter((x) => !x.passed).map((x) => x.id));
    const now = new Set(issues.map((x) => x.id));
    diff = {
      fixed: [...before].filter((x) => !now.has(x)).length,
      added: [...now].filter((x) => !before.has(x)).length,
      delta: audit.score - prev.score,
    };
  }

  const shareUrl = `${appUrl()}/?ref=share`;
  const shareText = t.shareText(audit.score);
  const unlockHref = "/checkout?plan=pro&period=monthly";
  const signupHref = `/signup?next=${encodeURIComponent(`/audit/${audit.id}`)}`;

  const upsell = (
    <div className="upsell" key="upsell">
      <h3>{t.lockedTitleN(lockedCount, lockedCritical)}</h3>
      <p>{viewer ? t.lockedBodyFree : t.lockedBodyAnon}</p>
      {viewer ? (
        <>
          <Link className="btn" href={unlockHref}>
            {t.unlockAll}
          </Link>
          <p className="alt-links">
            <Link href="/checkout?plan=pro&period=yearly">{t.yearlyAlt}</Link>
            <span aria-hidden> · </span>
            <Link href="/checkout?plan=pro&period=weekly">{t.weeklyPass(29)}</Link>
          </p>
        </>
      ) : (
        <Link className="btn" href={signupHref}>
          {t.saveReport}
        </Link>
      )}
    </div>
  );

  const renderIssue = (res: CheckResult, idx: number) => {
    const def = CHECK_BY_ID[res.id];
    if (!def) return null;
    const copy = def[lang];
    const open = idx < fixesShown;
    const platformFix = platform && def.platformFix?.[platform as "salla" | "zid"]?.[lang];
    const snippet = def.snippet?.({ host: r.host, origin: r.origin });
    return (
      <details key={res.id} className={`issue ${res.severity}`} open={open && idx < 3}>
        <summary>
          <span className={`badge ${res.severity}`}>{t.severity[res.severity]}</span>
          <span className="title">
            <Rich text={copy.title} />
          </span>
          {res.platformControlled && <span className="badge cat">{t.platformControlled}</span>}
          {!open && <span className="badge lock">🔒 {t.lockChip}</span>}
          {res.checkedCount > 1 && (
            <span className="count" dir="ltr">
              {res.affectedCount}/{res.checkedCount}
            </span>
          )}
        </summary>
        <div className="body">
          {res.platformControlled && platform && <p className="note">{t.platformControlledNote(platform)}</p>}
          <h4>{t.whyMatters}</h4>
          <p>
            <Rich text={copy.why} />
          </p>
          {open ? (
            <>
              <h4>{t.howToFix}</h4>
              <p>
                <Rich text={platformFix || copy.fix} />
              </p>
              {snippet && (
                <details className="dev">
                  <summary>{t.forDeveloper}</summary>
                  <div className="snippet">
                    <pre dir="ltr">
                      <code>{snippet}</code>
                    </pre>
                    <CopyButton text={snippet} label={t.copy} done={t.copied} />
                  </div>
                </details>
              )}
              {res.affected.length > 0 && res.checkedCount > 1 && (
                <>
                  <h4>{t.affectedPages}</h4>
                  <ul className="affected" dir="ltr">
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
              <Link href={viewer ? unlockHref : signupHref}>{viewer ? t.unlockOne : t.saveReport}</Link>
            </div>
          )}
        </div>
      </details>
    );
  };

  let idx = 0;
  return (
    <div className="container narrow">
      <p className="print-only print-brand">{agency || `${t.brand} · ${t.tagline}`}</p>
      <div className="report-head">
        <Ring score={audit.score} of={t.scoreOf} />
        <div>
          <h1 dir="ltr" className="host-title">{audit.host}</h1>
          <p className="score-label">{t.scoreLabel(audit.score, counts.critical)}</p>
          {platform && <p className="chip">{t.platformChip(platform)}</p>}
          <p className="start-here">{t.startHere(counts.critical, r.potentialScore)}</p>
          <div className="actions no-print">
            <a className="btn small secondary" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}>
              {t.shareWhatsapp}
            </a>
            <a className="btn small secondary" target="_blank" rel="noopener" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}>
              {t.shareX}
            </a>
            {canPdf && <PrintButton label={t.downloadPdf} />}
            {isOwner && (
              <Link className="btn small secondary" href={`/dashboard?rerun=${encodeURIComponent(audit.host)}`}>
                {t.rerun}
              </Link>
            )}
          </div>
          {isOwner && <p className="hint no-print">{t.sharePrivate}</p>}
        </div>
      </div>

      {diff && (
        <div className="changed card">
          <strong>{t.whatChanged}:</strong> <span>{t.scoreDelta(diff.delta)}</span>
          {diff.fixed > 0 && <span className="good"> · {t.fixedN(diff.fixed)}</span>}
          {diff.added > 0 && <span className="bad"> · {t.newN(diff.added)}</span>}
        </div>
      )}

      <div className="summary">
        {GROUPS.map((s) => (
          <div className="card" key={s}>
            <strong style={{ color: `var(--${s})` }}>{counts[s]}</strong>
            <span className={`badge ${s}`}>{t.severity[s]}</span>
          </div>
        ))}
      </div>

      {r.pagesCrawled <= 1 && <p className="note">{t.homepageOnly}</p>}

      <h2>{t.issuesFound(issues.length)}</h2>
      {GROUPS.map((sev) => {
        const group = issues.filter((x) => x.severity === sev);
        if (!group.length) return null;
        return (
          <section key={sev} className="sev-group">
            <h3 className={`sev-title ${sev}`}>{t.severityGroups[sev]}</h3>
            {group.flatMap((res) => {
              const i = idx++;
              const node = renderIssue(res, i);
              return lockedCount > 0 && i === fixesShown - 1 ? [node, upsell] : [node];
            })}
          </section>
        );
      })}
      {lockedCount > 0 && fixesShown === 0 && upsell}

      {passed.length > 0 && (
        <>
          <h2 className="mt-32">
            {t.passedChecks} ({passed.length})
          </h2>
          <ul className="passed">
            {passed.map((p) => (
              <li key={p.id}>{CHECK_BY_ID[p.id]?.name[lang]}</li>
            ))}
          </ul>
        </>
      )}

      <details className="tech">
        <summary>{t.technicalDetails}</summary>
        <ul>
          <li>{t.pagesChecked(r.pagesCrawled)}</li>
          <li>
            {t.responseTime}: <span dir="ltr">{r.homepage.ms} {t.ms}</span>
          </li>
          <li>{r.homepage.arabic ? t.arabicSite : t.notArabicSite}</li>
          <li>
            {t.auditedAt}: {formatDate(audit.created_at, lang)}
          </li>
        </ul>
      </details>

      <div className="section no-print">
        <h2>{t.newAudit}</h2>
        <AuditForm labels={labels} />
      </div>
    </div>
  );
}

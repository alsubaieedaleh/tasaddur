import { analyzePage, parseRobots, type PageFacts } from "./analyze";
import { CHECKS, SEVERITY_ORDER, SEVERITY_WEIGHT, type Category, type Severity, type SiteFacts } from "./checks";
import { safeFetch } from "./fetcher";

export interface CheckResult {
  id: string;
  category: Category;
  severity: Severity;
  passed: boolean;
  /** Pages that fail a page-level check (capped), empty for site checks. */
  affected: string[];
  affectedCount: number;
  checkedCount: number;
}

export interface AuditResult {
  host: string;
  origin: string;
  score: number;
  pagesCrawled: number;
  durationMs: number;
  homepage: { url: string; title: string; ms: number; status: number; lang: string; arabic: boolean };
  results: CheckResult[];
  error?: string;
}

const SKIP_EXT = /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|mp4|mp3|webm|css|js|json|xml|txt|woff2?|ttf|eot|avif)(\?|$)/i;

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function crawl(home: PageFacts, limit: number, deadline: number): Promise<PageFacts[]> {
  const pages = [home];
  if (limit <= 1) return pages;
  const seen = new Set<string>([normalize(home.url)]);
  let frontier = home.internalLinks;
  while (frontier.length && pages.length < limit && Date.now() < deadline) {
    const batch: string[] = [];
    for (const link of frontier) {
      const key = normalize(link);
      if (seen.has(key) || SKIP_EXT.test(link)) continue;
      seen.add(key);
      batch.push(link);
      if (pages.length + batch.length >= limit) break;
    }
    if (!batch.length) break;
    const fetched = await pool(batch, 6, async (url) => (Date.now() < deadline ? analyzePage(await safeFetch(url, 10000)) : null));
    const next: string[] = [];
    for (const p of fetched) {
      if (!p) continue;
      if (!p.isHtml && p.status === 200) continue; // non-HTML file, ignore
      pages.push(p);
      next.push(...p.internalLinks);
    }
    frontier = next;
  }
  return pages;
}

function normalize(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/$/, "") + x.search).toLowerCase();
  } catch {
    return u;
  }
}

export async function runAudit(host: string, opts: { maxPages: number; timeBudgetMs?: number }): Promise<AuditResult> {
  const started = Date.now();
  const deadline = started + (opts.timeBudgetMs ?? (opts.maxPages > 1 ? 90_000 : 25_000));

  // Prefer HTTPS; fall back to HTTP if HTTPS doesn't answer.
  let homeRes = await safeFetch(`https://${host}/`);
  if (homeRes.status === 0) {
    const httpRes = await safeFetch(`http://${host}/`);
    if (httpRes.status !== 0) homeRes = httpRes;
  }
  if (homeRes.status === 0) {
    return {
      host,
      origin: `https://${host}`,
      score: 0,
      pagesCrawled: 0,
      durationMs: Date.now() - started,
      homepage: { url: `https://${host}/`, title: "", ms: homeRes.ms, status: 0, lang: "", arabic: false },
      results: [],
      error: homeRes.error || "unreachable",
    };
  }

  const origin = new URL(homeRes.finalUrl).origin;
  const https = homeRes.finalUrl.startsWith("https://");
  const [httpRes, robotsRes] = await Promise.all([
    https ? safeFetch(`http://${host}/`, 8000, false) : Promise.resolve(null),
    safeFetch(`${origin}/robots.txt`, 8000),
  ]);
  const robots = parseRobots(robotsRes);
  const sitemapCandidates = robots.sitemaps.length ? robots.sitemaps.slice(0, 2) : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  let sitemapFound = false;
  for (const sm of sitemapCandidates) {
    const r = await safeFetch(sm, 8000);
    if (r.status === 200 && /<(urlset|sitemapindex)/i.test(r.body)) {
      sitemapFound = true;
      break;
    }
  }

  const home = analyzePage(homeRes);
  const pages = await crawl(home, opts.maxPages, deadline);

  const site: SiteFacts = {
    host,
    origin,
    https,
    httpRedirectsToHttps: httpRes ? (httpRes.status === 0 ? null : httpRes.finalUrl.startsWith("https://")) : null,
    home,
    pages,
    robots,
    sitemapFound,
    isArabicSite: home.arabicRatio >= 0.3 || home.lang.startsWith("ar"),
  };

  const results: CheckResult[] = [];
  let penalty = 0;
  let maxPenalty = 0;
  for (const c of CHECKS) {
    const weight = SEVERITY_WEIGHT[c.severity];
    if (c.scope === "site" && c.site) {
      const failed = c.site(site);
      if (failed === null) continue;
      maxPenalty += weight;
      if (failed) penalty += weight;
      results.push({ id: c.id, category: c.category, severity: c.severity, passed: !failed, affected: [], affectedCount: failed ? 1 : 0, checkedCount: 1 });
    } else if (c.page) {
      const applicable = pages.map((p) => ({ p, failed: c.page!(p, site) })).filter((x) => x.failed !== null);
      if (!applicable.length) continue;
      const failing = applicable.filter((x) => x.failed);
      maxPenalty += weight;
      if (failing.length) {
        // Partial penalty by share of affected pages, but at least a quarter of the weight.
        penalty += weight * Math.max(0.25, failing.length / applicable.length);
      }
      results.push({
        id: c.id,
        category: c.category,
        severity: c.severity,
        passed: failing.length === 0,
        affected: failing.slice(0, 25).map((x) => x.p.url),
        affectedCount: failing.length,
        checkedCount: applicable.length,
      });
    }
  }

  const score = maxPenalty ? Math.max(0, Math.min(100, Math.round(100 * (1 - penalty / maxPenalty)))) : 0;
  results.sort((a, b) => Number(a.passed) - Number(b.passed) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    host,
    origin,
    score,
    pagesCrawled: pages.length,
    durationMs: Date.now() - started,
    homepage: { url: home.url, title: home.title, ms: home.ms, status: home.status, lang: home.lang, arabic: site.isArabicSite },
    results,
  };
}

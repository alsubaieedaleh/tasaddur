import { analyzePage, parseRobots, robotsAllows, sameSite, sitemapLocs, type PageFacts, type Platform } from "./analyze";
import { CHECKS, normText, SEVERITY_ORDER, SEVERITY_WEIGHT, type Category, type Severity, type SiteFacts } from "./checks";
import { isBotChallenge, safeFetch } from "./fetcher";

export interface CheckResult {
  id: string;
  category: Category;
  severity: Severity;
  passed: boolean;
  /** True when the store platform controls this setting: shown, but not counted in the score. */
  platformControlled?: boolean;
  /** Pages that fail a page-level check (capped), empty for site checks. */
  affected: string[];
  affectedCount: number;
  checkedCount: number;
}

export interface AuditResult {
  host: string;
  origin: string;
  score: number;
  /** Score if every critical issue were fixed. */
  potentialScore: number;
  pagesCrawled: number;
  durationMs: number;
  platform: Platform;
  homepage: { url: string; title: string; ms: number; status: number; lang: string; arabic: boolean };
  results: CheckResult[];
  error?: string;
}

export const CHECK_COUNT = CHECKS.length;

const SKIP_EXT = /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|mp4|mp3|webm|css|js|json|xml|txt|woff2?|ttf|eot|avif)(\?|$)/i;
/** Utility pages that are legitimately noindex / thin: not worth auditing. */
const SKIP_PATH = /\/(cart|checkout|login|register|signin|signup|account|profile|wishlist|search|auth|my-account|orders|customer)(\/|$)|[?&](sort|order|filter|page|q|ref|utm_[a-z]+)=/i;

// ---- Global concurrency limit: at most N audits run at once; the rest wait their turn. ----
const MAX_CONCURRENT_AUDITS = Number(process.env.MAX_CONCURRENT_AUDITS || 3);
let running = 0;
const waiting: (() => void)[] = [];
async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT_AUDITS) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
}
function release(): void {
  running--;
  waiting.shift()?.();
}

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

function urlKey(u: string): string {
  try {
    const x = new URL(u);
    return x.hostname.toLowerCase().replace(/^www\./, "") + x.pathname.replace(/\/$/, "") + x.search;
  } catch {
    return u;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url: string, siteHost: string): Promise<PageFacts> {
  let res = await safeFetch(url, 10_000);
  if (res.status === 429 || res.status === 503) {
    await sleep(1500);
    res = await safeFetch(url, 10_000);
  }
  return analyzePage(res, siteHost, isBotChallenge(res));
}

async function crawl(home: PageFacts, siteHost: string, seeds: string[], limit: number, deadline: number, allowed: (u: string) => boolean): Promise<PageFacts[]> {
  const pages = [home];
  if (limit <= 1) return pages;
  const seen = new Set<string>([urlKey(home.url)]);
  let frontier = [...seeds, ...home.internalLinks];
  while (frontier.length && pages.length < limit && Date.now() < deadline) {
    const batch: string[] = [];
    for (const link of frontier) {
      const key = urlKey(link);
      if (seen.has(key) || SKIP_EXT.test(link) || SKIP_PATH.test(link) || !allowed(link)) continue;
      seen.add(key);
      batch.push(link);
      if (pages.length + batch.length >= limit) break;
    }
    if (!batch.length) break;
    const fetched = await pool(batch, 3, async (url) => (Date.now() < deadline ? fetchPage(url, siteHost) : null));
    const next: string[] = [];
    for (const p of fetched) {
      if (!p) continue;
      // A link that redirects off-site is not part of this site.
      try {
        if (!sameSite(new URL(p.url).host, siteHost)) continue;
      } catch {
        continue;
      }
      if (!p.isHtml && p.status === 200) continue; // non-HTML file
      pages.push(p);
      next.push(...p.internalLinks);
    }
    frontier = next;
  }
  return pages;
}

function median(nums: number[]): number {
  const s = nums.filter((n) => n > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function failed(host: string, started: number, error: string, ms = 0): AuditResult {
  return {
    host,
    origin: `https://${host}`,
    score: 0,
    potentialScore: 0,
    pagesCrawled: 0,
    durationMs: Date.now() - started,
    platform: "other",
    homepage: { url: `https://${host}/`, title: "", ms, status: 0, lang: "", arabic: false },
    results: [],
    error,
  };
}

export async function runAudit(host: string, opts: { maxPages: number; budgetMs: number }): Promise<AuditResult> {
  await acquire();
  try {
    return await runAuditInner(host, opts);
  } finally {
    release();
  }
}

async function runAuditInner(host: string, opts: { maxPages: number; budgetMs: number }): Promise<AuditResult> {
  const started = Date.now();
  const deadline = started + opts.budgetMs;

  // Prefer HTTPS; fall back to HTTP if HTTPS doesn't answer.
  let homeRes = await safeFetch(`https://${host}/`);
  if (homeRes.status === 0 && homeRes.error !== "blocked_host") {
    const httpRes = await safeFetch(`http://${host}/`);
    if (httpRes.status !== 0) homeRes = httpRes;
  }
  if (homeRes.status === 0) return failed(host, started, homeRes.error === "blocked_host" ? "blocked_host" : "unreachable", homeRes.ms);
  if (isBotChallenge(homeRes)) return failed(host, started, "bot_protected", homeRes.ms);

  const origin = new URL(homeRes.finalUrl).origin;
  const siteHost = new URL(homeRes.finalUrl).host;
  const https = homeRes.finalUrl.startsWith("https://");
  const [httpRes, robotsRes] = await Promise.all([
    https ? safeFetch(`http://${host}/`, 8000, false) : Promise.resolve(null),
    safeFetch(`${origin}/robots.txt`, 8000),
  ]);
  const robots = parseRobots(robotsRes);
  const candidates = robots.sitemaps.length ? robots.sitemaps.slice(0, 2) : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  const sitemapRes = await Promise.all(candidates.map((u) => safeFetch(u, 8000)));
  const sitemap = sitemapRes.find((r) => r.status === 200 && /<(urlset|sitemapindex)/i.test(r.body));
  let seeds: string[] = [];
  if (sitemap) {
    const locs = sitemapLocs(sitemap.body);
    if (/<sitemapindex/i.test(sitemap.body) && locs.length) {
      // Sitemap index: open the first child sitemap (usually products) to get page URLs.
      const child = await safeFetch(locs.find((l) => /product/i.test(l)) || locs[0], 8000);
      seeds = child.status === 200 ? sitemapLocs(child.body) : [];
    } else {
      seeds = locs;
    }
  }
  // Up to half the page budget comes from the sitemap (products and categories), the rest from links.
  seeds = seeds.filter((u) => {
    try {
      return sameSite(new URL(u).host, siteHost);
    } catch {
      return false;
    }
  });
  seeds = seeds.slice(0, Math.floor(opts.maxPages / 2));

  const home = analyzePage(homeRes, siteHost);
  const pages = await crawl(home, siteHost, seeds, opts.maxPages, deadline, (u) => robotsAllows(robots, u));
  const htmlPages = pages.filter((p) => p.isHtml && p.status === 200);
  const titleCounts = new Map<string, number>();
  const descCounts = new Map<string, number>();
  for (const p of htmlPages) {
    if (p.title) titleCounts.set(normText(p.title), (titleCounts.get(normText(p.title)) ?? 0) + 1);
    if (p.metaDescription) descCounts.set(normText(p.metaDescription), (descCounts.get(normText(p.metaDescription)) ?? 0) + 1);
  }

  const site: SiteFacts = {
    host,
    origin,
    https,
    httpRedirectsToHttps: httpRes ? (httpRes.status === 0 ? null : httpRes.finalUrl.startsWith("https://")) : null,
    home,
    homeRedirects: homeRes.redirects.length,
    pages,
    robots,
    sitemapFound: !!sitemap,
    isArabicSite: home.arabicRatio >= 0.3 || home.lang.startsWith("ar"),
    platform: home.platform,
    medianMs: median([home.ms, ...pages.slice(1, 3).map((p) => p.ms)]),
    titleCounts,
    descCounts,
  };
  const hosted = site.platform === "salla" || site.platform === "zid";

  const results: CheckResult[] = [];
  let penalty = 0;
  let maxPenalty = 0;
  let criticalPenalty = 0;
  for (const c of CHECKS) {
    const weight = SEVERITY_WEIGHT[c.severity];
    const excluded = hosted && !!c.platformControlled;
    let res: CheckResult | null = null;
    let pen = 0;
    if (c.scope === "site" && c.site) {
      const f = c.site(site);
      if (f === null) continue;
      pen = f ? weight : 0;
      res = { id: c.id, category: c.category, severity: c.severity, passed: !f, affected: [], affectedCount: f ? 1 : 0, checkedCount: 1 };
    } else if (c.page) {
      const applicable = pages.map((p) => ({ p, f: c.page!(p, site) })).filter((x) => x.f !== null);
      if (!applicable.length) continue;
      const failing = applicable.filter((x) => x.f);
      // Partial penalty by share of affected pages, but at least a quarter of the weight.
      pen = failing.length ? weight * Math.max(0.25, failing.length / applicable.length) : 0;
      res = {
        id: c.id,
        category: c.category,
        severity: c.severity,
        passed: failing.length === 0,
        affected: failing.slice(0, 25).map((x) => x.p.url),
        affectedCount: failing.length,
        checkedCount: applicable.length,
      };
    }
    if (!res) continue;
    if (excluded) res.platformControlled = true;
    else {
      maxPenalty += weight;
      penalty += pen;
      if (c.severity === "critical") criticalPenalty += pen;
    }
    results.push(res);
  }

  const toScore = (p: number) => (maxPenalty ? Math.max(0, Math.min(100, Math.round(100 * (1 - p / maxPenalty)))) : 0);
  let score = toScore(penalty);
  // Blocking problems cap the score: nothing else matters if Google can't see the site.
  if ((ok(home) && home.noindex) || robots.blocksAll || robots.status >= 500 || home.status !== 200) score = Math.min(score, 25);
  if (!https && !hosted) score = Math.min(score, 60);
  const potentialScore = Math.max(score, toScore(penalty - criticalPenalty));

  results.sort(
    (a, b) =>
      Number(a.passed) - Number(b.passed) ||
      Number(!!a.platformControlled) - Number(!!b.platformControlled) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return {
    host,
    origin,
    score,
    potentialScore,
    pagesCrawled: pages.length,
    durationMs: Date.now() - started,
    platform: site.platform,
    homepage: { url: home.url, title: home.title, ms: home.ms, status: home.status, lang: home.lang, arabic: site.isArabicSite },
    results,
  };
}

function ok(p: PageFacts) {
  return p.isHtml && p.status === 200;
}


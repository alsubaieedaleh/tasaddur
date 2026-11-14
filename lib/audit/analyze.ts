import * as cheerio from "cheerio";
import type { FetchResult } from "./fetcher";

export type Platform = "salla" | "zid" | "shopify" | "wordpress" | "other";

export interface Hreflang {
  lang: string;
  href: string;
}

export interface PageFacts {
  url: string;
  status: number;
  ms: number;
  bytes: number;
  isHtml: boolean;
  /** 403/429/503 bot challenge or a timeout: we couldn't see the real page. */
  blocked: boolean;
  compressed: boolean;
  noindex: boolean;
  lang: string;
  dir: string;
  title: string;
  metaDescription: string;
  canonical: string;
  viewport: string;
  h1Count: number;
  imgCount: number;
  imgMissingAlt: number;
  /** Words in the main content (header, nav, footer, forms removed). */
  wordCount: number;
  /** Share of letters that are Arabic, 0..1 */
  arabicRatio: number;
  internalLinks: string[];
  ogTitle: string;
  ogImage: string;
  ogType: string;
  jsonLd: unknown[];
  hreflangs: Hreflang[];
  hasFavicon: boolean;
  linksToEnglishVersion: boolean;
  mixedContent: number;
  platform: Platform;
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;
/** Arabic diacritics (harakat), tatweel and bidi/zero-width marks don't take visible space. */
const INVISIBLE = /[ً-ٰٟـ​-‏‪-‮⁦-⁩]/g;

export function visibleLength(s: string): number {
  return [...s.replace(INVISIBLE, "")].length;
}

export function arabicShare(text: string): number {
  const ar = (text.match(ARABIC) || []).length;
  const la = (text.match(LATIN) || []).length;
  return ar + la === 0 ? 0 : ar / (ar + la);
}

export function hasArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

export function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b);
}

export function detectPlatform(html: string): Platform {
  if (/cdn\.salla\.(sa|network)|salla\.sa\/|window\.salla|salla-/i.test(html)) return "salla";
  if (/zid\.store|zidcdn|media\.zid\.|zid-theme/i.test(html)) return "zid";
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) return "shopify";
  if (/\/wp-content\/|\/wp-includes\/|name="generator" content="WordPress/i.test(html)) return "wordpress";
  return "other";
}

export function emptyFacts(url: string, res?: Partial<FetchResult>): PageFacts {
  return {
    url,
    status: res?.status ?? 0,
    ms: res?.ms ?? 0,
    bytes: res?.bytes ?? 0,
    isHtml: false,
    blocked: false,
    compressed: false,
    noindex: false,
    lang: "",
    dir: "",
    title: "",
    metaDescription: "",
    canonical: "",
    viewport: "",
    h1Count: 0,
    imgCount: 0,
    imgMissingAlt: 0,
    wordCount: 0,
    arabicRatio: 0,
    internalLinks: [],
    ogTitle: "",
    ogImage: "",
    ogType: "",
    jsonLd: [],
    hreflangs: [],
    hasFavicon: false,
    linksToEnglishVersion: false,
    mixedContent: 0,
    platform: "other",
  };
}

/**
 * Parses one fetched page. siteHost is the audited site's host: links are judged "internal"
 * against it, not against wherever a redirect ended up.
 */
export function analyzePage(res: FetchResult, siteHost: string, blocked = false): PageFacts {
  const ctype = res.headers["content-type"] || "";
  const isHtml = !blocked && res.status > 0 && (ctype.includes("html") || (!ctype && /<html/i.test(res.body)));
  const base = emptyFacts(res.finalUrl, res);
  base.isHtml = isHtml;
  base.blocked = blocked;
  base.compressed = !!res.headers["content-encoding"];
  base.noindex = /\b(noindex|none)\b/i.test(res.headers["x-robots-tag"] || "");
  if (!isHtml) return base;

  const $ = cheerio.load(res.body);
  const pageUrl = new URL(res.finalUrl);
  const meta = (name: string) =>
    ($(`meta[name="${name}" i]`).attr("content") || $(`meta[property="${name}" i]`).attr("content") || "").trim();

  base.platform = detectPlatform(res.body.slice(0, 200_000));
  base.lang = ($("html").attr("lang") || "").trim().toLowerCase();
  base.dir = (($("html").attr("dir") || $("body").attr("dir") || "") as string).trim().toLowerCase();
  base.title = ($("head title").first().text() || $("title").first().text()).replace(/\s+/g, " ").trim();
  base.metaDescription = meta("description").replace(/\s+/g, " ");
  base.noindex = base.noindex || /\b(noindex|none)\b/i.test(meta("robots")) || /\b(noindex|none)\b/i.test(meta("googlebot"));
  base.canonical = ($('link[rel="canonical" i]').attr("href") || "").trim();
  base.viewport = meta("viewport");
  base.h1Count = $("h1").length;
  const imgs = $("img").toArray();
  base.imgCount = imgs.length;
  base.imgMissingAlt = imgs.filter((el) => $(el).attr("alt") === undefined).length;
  base.ogTitle = meta("og:title");
  base.ogImage = meta("og:image");
  base.ogType = meta("og:type").toLowerCase();
  base.hasFavicon = $('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]').length > 0;
  if (pageUrl.protocol === "https:") {
    base.mixedContent = $('img[src^="http:"],script[src^="http:"],iframe[src^="http:"],link[rel="stylesheet"][href^="http:"],source[src^="http:"]').length;
  }

  $('script[type="application/ld+json" i]').each((_, el) => {
    try {
      base.jsonLd.push(JSON.parse($(el).contents().text()));
    } catch {
      /* invalid JSON-LD is ignored */
    }
  });

  $('link[rel="alternate" i][hreflang]').each((_, el) => {
    const lang = ($(el).attr("hreflang") || "").trim();
    const href = $(el).attr("href") || "";
    if (lang && href) {
      try {
        base.hreflangs.push({ lang, href: new URL(href, pageUrl).toString() });
      } catch {
        /* ignore bad href */
      }
    }
  });

  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const raw = ($(el).attr("href") || "").trim();
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript|whatsapp|sms):/i.test(raw)) return;
    let u: URL;
    try {
      u = new URL(raw, pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.host, siteHost)) return;
    u.hash = "";
    const txt = $(el).text().trim().toLowerCase();
    if (/^\/en(\/|$)/.test(u.pathname) || u.searchParams.get("lang") === "en" || txt === "english" || txt === "en") base.linksToEnglishVersion = true;
    links.add(u.toString());
  });
  base.internalLinks = [...links];

  // Word count of the main content only: site chrome inflates it and hides thin pages.
  $("script,style,noscript,svg,template,header,nav,footer,aside,form,[role=navigation],[role=banner],[role=contentinfo]").remove();
  const main = $("main, article, [role=main]").first();
  const text = (main.length ? main.text() : $("body").text()).replace(/\s+/g, " ").trim();
  base.wordCount = text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  base.arabicRatio = arabicShare(text + " " + base.title);
  return base;
}

export function isProductPage(p: PageFacts): boolean {
  if (p.ogType === "product" || p.ogType === "og:product") return true;
  try {
    const path = decodeURIComponent(new URL(p.url).pathname);
    return /\/p\d{5,}(\/|$)|\/products?\/[^/]+\/?$/.test(path);
  } catch {
    return false;
  }
}

export interface RobotsInfo {
  status: number;
  exists: boolean;
  blocksAll: boolean;
  /** Disallow rules that apply to us (the * or googlebot group). */
  disallow: string[];
  sitemaps: string[];
}

export function parseRobots(res: FetchResult): RobotsInfo {
  const ctype = res.headers["content-type"] || "";
  const base: RobotsInfo = { status: res.status, exists: false, blocksAll: false, disallow: [], sitemaps: [] };
  if (res.status !== 200 || ctype.includes("html")) return base;
  base.exists = true;
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of res.body.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "sitemap") {
      base.sitemaps.push(val);
      continue;
    }
    if (key === "user-agent") {
      if (!lastWasAgent || !cur) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val) cur.disallow.push(val);
    if (key === "allow" && val) cur.allow.push(val);
  }
  const effective = groups.find((g) => g.agents.some((a) => a.includes("googlebot"))) ?? groups.find((g) => g.agents.includes("*"));
  if (effective) {
    base.disallow = effective.disallow;
    base.blocksAll = effective.disallow.some((v) => /^\/\*?\$?$/.test(v)) && !effective.allow.some((v) => v === "/" || v === "/*");
  }
  return base;
}

export function robotsAllows(robots: RobotsInfo, url: string): boolean {
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    return true;
  }
  return !robots.disallow.some((rule) => {
    const re = new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    return re.test(path);
  });
}

/** Extracts <loc> URLs from a sitemap or sitemap index. */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
}

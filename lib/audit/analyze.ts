import * as cheerio from "cheerio";
import type { FetchResult } from "./fetcher";

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
  noindex: boolean;
  lang: string;
  dir: string;
  title: string;
  metaDescription: string;
  canonical: string;
  viewport: string;
  h1Count: number;
  headingLevels: number[];
  imgCount: number;
  imgMissingAlt: number;
  wordCount: number;
  /** Share of letters that are Arabic, 0..1 */
  arabicRatio: number;
  internalLinks: string[];
  ogTitle: string;
  ogImage: string;
  jsonLd: unknown[];
  hreflangs: Hreflang[];
  hasFavicon: boolean;
  linksToEnglishVersion: boolean;
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;

export function arabicShare(text: string): number {
  const ar = (text.match(ARABIC) || []).length;
  const la = (text.match(LATIN) || []).length;
  return ar + la === 0 ? 0 : ar / (ar + la);
}

export function hasArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.replace(/^www\./, "");
  return strip(a) === strip(b);
}

export function analyzePage(res: FetchResult): PageFacts {
  const ctype = res.headers["content-type"] || "";
  const isHtml = res.status > 0 && (ctype.includes("html") || (!ctype && /<html/i.test(res.body)));
  const base: PageFacts = {
    url: res.finalUrl,
    status: res.status,
    ms: res.ms,
    bytes: res.bytes,
    isHtml,
    noindex: /noindex/i.test(res.headers["x-robots-tag"] || ""),
    lang: "",
    dir: "",
    title: "",
    metaDescription: "",
    canonical: "",
    viewport: "",
    h1Count: 0,
    headingLevels: [],
    imgCount: 0,
    imgMissingAlt: 0,
    wordCount: 0,
    arabicRatio: 0,
    internalLinks: [],
    ogTitle: "",
    ogImage: "",
    jsonLd: [],
    hreflangs: [],
    hasFavicon: false,
    linksToEnglishVersion: false,
  };
  if (!isHtml) return base;

  const $ = cheerio.load(res.body);
  const pageUrl = new URL(res.finalUrl);
  const meta = (name: string) =>
    ($(`meta[name="${name}" i]`).attr("content") || $(`meta[property="${name}" i]`).attr("content") || "").trim();

  base.lang = ($("html").attr("lang") || "").trim().toLowerCase();
  base.dir = (($("html").attr("dir") || $("body").attr("dir") || "") as string).trim().toLowerCase();
  base.title = $("head title").first().text().replace(/\s+/g, " ").trim() || $("title").first().text().replace(/\s+/g, " ").trim();
  base.metaDescription = meta("description").replace(/\s+/g, " ");
  base.noindex = base.noindex || /noindex/i.test(meta("robots")) || /noindex/i.test(meta("googlebot"));
  base.canonical = ($('link[rel="canonical" i]').attr("href") || "").trim();
  base.viewport = meta("viewport");
  base.h1Count = $("h1").length;
  base.headingLevels = $("h1,h2,h3,h4,h5,h6")
    .toArray()
    .map((el) => Number((el as { tagName: string }).tagName.slice(1)));
  const imgs = $("img").toArray();
  base.imgCount = imgs.length;
  base.imgMissingAlt = imgs.filter((el) => $(el).attr("alt") === undefined).length;
  base.ogTitle = meta("og:title");
  base.ogImage = meta("og:image");
  base.hasFavicon = $('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]').length > 0;

  $('script[type="application/ld+json" i]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      base.jsonLd.push(parsed);
    } catch {
      /* invalid JSON-LD is ignored */
    }
  });

  $('link[rel="alternate" i][hreflang]').each((_, el) => {
    const lang = ($(el).attr("hreflang") || "").toLowerCase();
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
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, pageUrl.hostname)) return;
    u.hash = "";
    const txt = $(el).text().trim().toLowerCase();
    if (/^\/en(\/|$)/.test(u.pathname) || u.searchParams.get("lang") === "en" || txt === "english" || txt === "en") {
      base.linksToEnglishVersion = true;
    }
    links.add(u.toString());
  });
  base.internalLinks = [...links];

  $("script,style,noscript,svg,template").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  base.wordCount = text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  base.arabicRatio = arabicShare(text + " " + base.title);
  return base;
}

export interface RobotsInfo {
  exists: boolean;
  blocksAll: boolean;
  sitemaps: string[];
}

export function parseRobots(res: FetchResult): RobotsInfo {
  const ctype = res.headers["content-type"] || "";
  if (res.status !== 200 || ctype.includes("html")) return { exists: false, blocksAll: false, sitemaps: [] };
  const lines = res.body.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  const sitemaps: string[] = [];
  let inStar = false;
  let lastWasAgent = false;
  let blocksAll = false;
  for (const line of lines) {
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "sitemap") {
      sitemaps.push(val);
      continue;
    }
    if (key === "user-agent") {
      inStar = lastWasAgent ? inStar || val === "*" : val === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (inStar && key === "disallow" && val === "/") blocksAll = true;
  }
  return { exists: true, blocksAll, sitemaps };
}

import { hasArabic, isProductPage, visibleLength, type PageFacts, type Platform, type RobotsInfo } from "./analyze";

export type Severity = "critical" | "important" | "minor";
export type Category = "technical" | "onpage" | "mobile" | "saudi";

export interface SiteFacts {
  host: string;
  origin: string;
  https: boolean;
  httpRedirectsToHttps: boolean | null;
  home: PageFacts;
  homeRedirects: number;
  pages: PageFacts[];
  robots: RobotsInfo;
  sitemapFound: boolean;
  isArabicSite: boolean;
  platform: Platform;
  medianMs: number;
  titleCounts: Map<string, number>;
  descCounts: Map<string, number>;
}

/** Copy is plain text; wrap code or Latin tokens in `backticks` so they render isolated left-to-right inside Arabic. */
export interface Copy {
  title: string;
  why: string;
  fix: string;
}

export interface CheckDef {
  id: string;
  category: Category;
  severity: Severity;
  scope: "site" | "page";
  ar: Copy;
  en: Copy;
  /** Short neutral name for the "passed checks" list. */
  name: { ar: string; en: string };
  /** On hosted store platforms (Salla, Zid) the merchant can't change this: excluded from the score. */
  platformControlled?: boolean;
  /** Platform-specific fix steps that replace the generic fix. */
  platformFix?: Partial<Record<"salla" | "zid", { ar: string; en: string }>>;
  snippet?: (site: { host: string; origin: string; url?: string }) => string;
  /** Page checks: return true when the page FAILS, null when not applicable. */
  page?: (p: PageFacts, s: SiteFacts) => boolean | null;
  /** Site checks: return true when the site FAILS, null when not applicable. */
  site?: (s: SiteFacts) => boolean | null;
}

const ok200 = (p: PageFacts) => p.isHtml && p.status === 200;
const isArabicPage = (p: PageFacts) => p.arabicRatio >= 0.3;
export const normText = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function schemaNodes(jsonLd: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      out.push(o);
      if (o["@graph"]) walk(o["@graph"]);
    }
  };
  jsonLd.forEach(walk);
  return out;
}

const typeOf = (n: Record<string, unknown>) => ([] as unknown[]).concat(n["@type"] ?? []).map(String).join(" ");
const SAUDI_PHONE = /(\+|00)?966[\s-]?(5\d{8}|1\d{7})|\b05\d{8}\b/;

export function hasSaudiBusinessData(jsonLd: unknown[]): boolean {
  return schemaNodes(jsonLd)
    .filter((n) => /Organization|LocalBusiness|Store|Restaurant|Dentist|Clinic|Physician|Hotel|AutoRepair|ProfessionalService|Corporation/i.test(typeOf(n)))
    .some((n) => {
      const s = JSON.stringify(n);
      return /"addressCountry"\s*:\s*("(SA|KSA|Saudi Arabia|السعودية|المملكة العربية السعودية)"|\{[^}]*"(SA|Saudi Arabia)")/i.test(s) || SAUDI_PHONE.test(s) || /"areaServed"[^\]}]*(SA|Saudi|السعودية)/i.test(s);
    });
}

export function hasValidProduct(jsonLd: unknown[]): boolean {
  return schemaNodes(jsonLd)
    .filter((n) => /\bProduct\b/.test(typeOf(n)))
    .some((n) => {
      const offers = ([] as unknown[]).concat(n.offers ?? []) as Record<string, unknown>[];
      return offers.some((o) => o && (o.price !== undefined || o.lowPrice !== undefined) && o.priceCurrency && o.availability);
    });
}

const HREFLANG_CODE = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;

export const CHECKS: CheckDef[] = [
  // ---------- Technical ----------
  {
    id: "https",
    category: "technical",
    severity: "critical",
    scope: "site",
    platformControlled: true,
    name: { ar: "اتصال آمن HTTPS", en: "HTTPS" },
    site: (s) => !s.https,
    ar: {
      title: "الموقع لا يعمل عبر `HTTPS`",
      why: "جوجل يعتبر `HTTPS` عامل ترتيب، والمتصفحات تعرض تحذير «غير آمن» للزوار فيغادرون.",
      fix: "فعّل شهادة SSL مجانية (`Let's Encrypt`) من لوحة الاستضافة أو عبر `Cloudflare`، ثم اجعل كل الروابط تبدأ بـ `https`.",
    },
    en: {
      title: "Site is not served over HTTPS",
      why: "Google uses HTTPS as a ranking signal and browsers warn visitors that the site is \"Not secure\".",
      fix: "Enable a free SSL certificate (Let's Encrypt) from your hosting panel or Cloudflare, then use https in all links.",
    },
  },
  {
    id: "http_redirect",
    category: "technical",
    severity: "important",
    scope: "site",
    platformControlled: true,
    name: { ar: "تحويل http إلى https", en: "HTTP to HTTPS redirect" },
    site: (s) => (s.https && s.httpRedirectsToHttps !== null ? !s.httpRedirectsToHttps : null),
    ar: {
      title: "نسخة `http` لا تتحول تلقائياً إلى `https`",
      why: "وجود نسختين من الموقع يشتت قوة الروابط بينهما، وقد يفهرس جوجل النسخة غير الآمنة.",
      fix: "أضف تحويلاً دائماً `301` من `http` إلى `https` في إعدادات الخادم، أو فعّل خيار `Always Use HTTPS` في `Cloudflare`.",
    },
    en: {
      title: "http:// does not redirect to https://",
      why: "Two copies of the site split link equity and Google may index the insecure one.",
      fix: "Add a permanent 301 redirect from http to https in your server, or turn on Always Use HTTPS in Cloudflare.",
    },
    snippet: () => `# Apache (.htaccess)\nRewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]\n\n# Nginx\nserver {\n  listen 80;\n  return 301 https://$host$request_uri;\n}`,
  },
  {
    id: "status_ok",
    category: "technical",
    severity: "critical",
    scope: "page",
    name: { ar: "الصفحات تعمل بدون أخطاء", en: "Pages load without errors" },
    // Timeouts, rate limits and bot challenges are not the site's fault: not applicable.
    page: (p) => (p.blocked || p.status === 0 || p.status === 429 || p.status === 503 ? null : p.status !== 200),
    ar: {
      title: "صفحات لا تعمل (خطأ أو صفحة غير موجودة)",
      why: "الصفحات التي ترجع خطأ `404` أو `500` لا تظهر في جوجل، وتضيّع الزوار القادمين لها من روابط داخلية.",
      fix: "أصلح الصفحة أو حوّلها بتحويل `301` لأقرب صفحة بديلة، واحذف الروابط الداخلية المكسورة.",
    },
    en: {
      title: "Pages returning errors",
      why: "Pages that return 404 or 500 errors don't rank and lose the visitors who land on them.",
      fix: "Fix the page or 301-redirect it to the closest alternative, and remove broken internal links.",
    },
    platformFix: {
      salla: { ar: "غالباً منتج أو قسم محذوف ما زال مرتبطاً من القائمة أو من منتجات أخرى. احذف الرابط من «القائمة» في لوحة سلة أو أعد المنتج، وأضف تحويلاً من «الروابط المخصصة» إن توفر.", en: "Usually a deleted product or category still linked from the menu or other products. Remove the link from the Salla menu or restore the product." },
      zid: { ar: "غالباً منتج أو قسم محذوف ما زال مرتبطاً من القائمة. احذف الرابط من إعدادات القائمة في لوحة زد أو أعد المنتج.", en: "Usually a deleted product or category still linked from the menu. Remove the link in Zid's menu settings or restore the product." },
    },
  },
  {
    id: "response_time",
    category: "technical",
    severity: "important",
    scope: "site",
    name: { ar: "سرعة استجابة الخادم", en: "Server response time" },
    site: (s) => (s.home.status ? s.medianMs > 1800 : null),
    ar: {
      title: "الموقع بطيء في الاستجابة",
      why: "السرعة عامل ترتيب في جوجل، وأغلب زوار الجوال يغادرون إذا تأخرت الصفحة أكثر من 3 ثوانٍ.",
      fix: "استخدم استضافة قريبة من السعودية أو شبكة `CDN` مثل `Cloudflare`، فعّل التخزين المؤقت، وقلّل الإضافات والسكربتات الثقيلة.",
    },
    en: {
      title: "Slow server response",
      why: "Speed is a Google ranking factor and most mobile visitors leave if a page takes more than 3 seconds.",
      fix: "Use hosting close to Saudi Arabia or a CDN like Cloudflare, enable caching, and remove heavy plugins and scripts.",
    },
    platformFix: {
      salla: { ar: "السرعة على سلة تعتمد غالباً على القالب والتطبيقات المثبتة وحجم الصور. احذف التطبيقات غير المستخدمة، وقلّل البنرات الكبيرة في الرئيسية، وارفع صوراً بصيغة WebP.", en: "On Salla speed mostly depends on the theme, installed apps and image sizes. Remove unused apps, reduce big homepage banners and upload WebP images." },
      zid: { ar: "السرعة على زد تعتمد على القالب والإضافات وحجم الصور. احذف الإضافات غير المستخدمة وقلّل البنرات الكبيرة وارفع صوراً مضغوطة.", en: "On Zid speed depends on theme, add-ons and image sizes. Remove unused add-ons, reduce banners and upload compressed images." },
    },
  },
  {
    id: "redirect_chain",
    category: "technical",
    severity: "minor",
    scope: "site",
    platformControlled: true,
    name: { ar: "تحويل مباشر للصفحة الرئيسية", en: "Direct homepage redirect" },
    site: (s) => s.homeRedirects > 1,
    ar: {
      title: "سلسلة تحويلات قبل الوصول للصفحة الرئيسية",
      why: "كل تحويل إضافي يؤخر فتح الصفحة ويضيّع جزءاً من قوة الروابط.",
      fix: "اجعل `http` والنسخة بدون `www` تتحول مباشرة إلى الرابط النهائي بتحويل `301` واحد.",
    },
    en: {
      title: "Redirect chain before the homepage",
      why: "Each extra redirect delays the page and loses some link equity.",
      fix: "Redirect http and non-www straight to the final URL with a single 301.",
    },
  },
  {
    id: "compression",
    category: "technical",
    severity: "important",
    scope: "page",
    platformControlled: true,
    name: { ar: "ضغط الصفحات", en: "Compression" },
    page: (p) => (ok200(p) && p.bytes > 20 * 1024 ? !p.compressed : null),
    ar: {
      title: "الخادم لا يضغط الصفحات (`gzip`/`brotli`)",
      why: "الضغط يقلل حجم الصفحة إلى الربع تقريباً، فتفتح أسرع على شبكات الجوال.",
      fix: "فعّل الضغط من لوحة الاستضافة أو من `Cloudflare` (مفعّل تلقائياً في سلة وزد).",
    },
    en: {
      title: "Server doesn't compress pages (gzip/brotli)",
      why: "Compression cuts page size to about a quarter so it loads faster on mobile networks.",
      fix: "Enable compression in your hosting panel or Cloudflare (on by default on Salla and Zid).",
    },
  },
  {
    id: "page_weight",
    category: "technical",
    severity: "minor",
    scope: "page",
    platformControlled: true,
    name: { ar: "حجم الصفحات", en: "Page weight" },
    page: (p) => (p.isHtml ? p.bytes > 600 * 1024 : null),
    ar: {
      title: "حجم كود الصفحة كبير",
      why: "صفحات `HTML` التي تتجاوز 600 كيلوبايت تبطئ التحميل على شبكات الجوال.",
      fix: "انقل الأكواد المضمّنة (`CSS` و `JavaScript`) إلى ملفات خارجية، وقلّل الأقسام المكررة في الصفحة.",
    },
    en: {
      title: "Heavy HTML pages",
      why: "HTML documents over 600 KB slow down loading on mobile networks.",
      fix: "Move inline CSS and JavaScript to external files and trim repeated sections.",
    },
  },
  {
    id: "robots_blocked",
    category: "technical",
    severity: "critical",
    scope: "site",
    name: { ar: "ملف robots.txt يسمح بالزحف", en: "robots.txt allows crawling" },
    site: (s) => s.robots.blocksAll || s.robots.status >= 500,
    ar: {
      title: "ملف `robots.txt` يمنع جوجل من موقعك",
      why: "قاعدة `Disallow: /` أو خطأ خادم `5xx` في هذا الملف يجعل جوجل يتوقف عن الزحف لموقعك كله.",
      fix: "عدّل الملف ليسمح بالزحف كما في الكود، وتأكد أن الرابط `/robots.txt` يرجع `200` أو `404` فقط.",
    },
    en: {
      title: "robots.txt blocks Google",
      why: "A \"Disallow: /\" rule or a 5xx error on this file makes Google stop crawling your whole site.",
      fix: "Change the file to allow crawling as shown, and make sure /robots.txt returns 200 or 404 only.",
    },
    snippet: ({ origin }) => `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml`,
  },
  {
    id: "robots_missing",
    category: "technical",
    severity: "minor",
    scope: "site",
    platformControlled: true,
    name: { ar: "ملف robots.txt", en: "robots.txt" },
    site: (s) => (s.robots.status >= 500 ? null : !s.robots.exists),
    ar: {
      title: "ملف `robots.txt` غير موجود",
      why: "غيابه لا يمنع جوجل، لكنه المكان المعتاد لإخبار محركات البحث بخريطة موقعك.",
      fix: "أنشئ ملف `robots.txt` في جذر الموقع يسمح بالزحف ويشير إلى خريطة الموقع.",
    },
    en: {
      title: "No robots.txt",
      why: "It doesn't block Google, but it's the usual place to point search engines at your sitemap.",
      fix: "Add a robots.txt at the site root that allows crawling and points to your sitemap.",
    },
    snippet: ({ origin }) => `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml`,
  },
  {
    id: "sitemap",
    category: "technical",
    severity: "important",
    scope: "site",
    platformControlled: true,
    name: { ar: "خريطة الموقع", en: "Sitemap" },
    site: (s) => !s.sitemapFound,
    ar: {
      title: "لا توجد خريطة موقع `sitemap.xml`",
      why: "خريطة الموقع تساعد جوجل على اكتشاف كل صفحاتك ومنتجاتك الجديدة بسرعة.",
      fix: "فعّل خريطة الموقع (ووردبريس مع `Yoast` أو `Rank Math` ينشئها تلقائياً)، ثم أرسلها في `Google Search Console`.",
    },
    en: {
      title: "No sitemap.xml found",
      why: "A sitemap helps Google discover all your pages and new products quickly.",
      fix: "Enable a sitemap (WordPress with Yoast or Rank Math creates one), then submit it in Google Search Console.",
    },
  },
  {
    id: "canonical",
    category: "technical",
    severity: "minor",
    scope: "page",
    platformControlled: true,
    name: { ar: "وسم canonical", en: "Canonical tag" },
    page: (p) => (ok200(p) ? !p.canonical : null),
    ar: {
      title: "وسم `canonical` مفقود",
      why: "بدونه قد يرى جوجل نفس الصفحة بعدة روابط (مع معاملات تتبع مثلاً) ويعتبرها محتوى مكرراً.",
      fix: "أضف وسم `canonical` في `<head>` كل صفحة يشير إلى رابطها الأساسي.",
    },
    en: {
      title: "Missing canonical tag",
      why: "Without it Google may see the same page under several URLs (e.g. with tracking parameters) as duplicate content.",
      fix: "Add a canonical link in each page's <head> pointing to its main URL.",
    },
    snippet: ({ origin, url }) => `<link rel="canonical" href="${url || origin + "/"}" />`,
  },
  {
    id: "canonical_mismatch",
    category: "technical",
    severity: "important",
    scope: "page",
    name: { ar: "وسم canonical صحيح", en: "Canonical points correctly" },
    page: (p, s) => {
      if (!ok200(p) || !p.canonical) return null;
      let c: URL;
      try {
        c = new URL(p.canonical, p.url);
      } catch {
        return true;
      }
      const home = new URL(s.home.url);
      const pageIsHome = new URL(p.url).pathname.replace(/\/$/, "") === home.pathname.replace(/\/$/, "");
      if (c.hostname.replace(/^www\./, "") !== home.hostname.replace(/^www\./, "")) return true;
      if (s.https && c.protocol === "http:") return true;
      return !pageIsHome && c.pathname.replace(/\/$/, "") === home.pathname.replace(/\/$/, "") && s.pages.length > 2;
    },
    ar: {
      title: "وسم `canonical` يشير لرابط خاطئ",
      why: "إذا أشار `canonical` لموقع آخر أو لنسخة `http` أو للصفحة الرئيسية، فقد يتجاهل جوجل هذه الصفحة تماماً.",
      fix: "اجعل `canonical` في كل صفحة يشير إلى رابطها هي بـ `https` وعلى نطاقك نفسه.",
    },
    en: {
      title: "Canonical points to the wrong URL",
      why: "A canonical pointing to another site, to http, or to the homepage can make Google ignore the page.",
      fix: "Make each page's canonical point to its own https URL on your domain.",
    },
  },
  {
    id: "noindex_home",
    category: "technical",
    severity: "critical",
    scope: "site",
    name: { ar: "الصفحة الرئيسية قابلة للفهرسة", en: "Homepage is indexable" },
    site: (s) => (ok200(s.home) ? s.home.noindex : null),
    ar: {
      title: "الصفحة الرئيسية ممنوعة من الظهور في جوجل (`noindex`)",
      why: "وسم `noindex` يطلب من جوجل عدم إظهار الصفحة نهائياً، وغالباً يبقى بالخطأ بعد مرحلة تطوير الموقع.",
      fix: "احذف وسم `<meta name=\"robots\" content=\"noindex\">` أو ترويسة `X-Robots-Tag`. في ووردبريس: الإعدادات ← القراءة ← ألغِ «منع محركات البحث من أرشفة هذا الموقع».",
    },
    en: {
      title: "Homepage is blocked from Google (noindex)",
      why: "noindex tells Google never to show the page, and it's often left on by mistake after development.",
      fix: "Remove <meta name=\"robots\" content=\"noindex\"> or the X-Robots-Tag header. In WordPress: Settings → Reading → untick \"Discourage search engines\".",
    },
    platformFix: {
      salla: { ar: "تأكد أن المتجر غير مغلق أو في «وضع الصيانة» من إعدادات المتجر في لوحة سلة، فالمتجر المغلق يُمنع من الفهرسة.", en: "Make sure the store isn't closed or in maintenance mode in Salla's store settings; closed stores are blocked from indexing." },
      zid: { ar: "تأكد أن المتجر مفعّل وغير مغلق من إعدادات المتجر في لوحة زد.", en: "Make sure the store is active and not closed in Zid's store settings." },
    },
  },
  {
    id: "noindex",
    category: "technical",
    severity: "important",
    scope: "page",
    name: { ar: "الصفحات قابلة للفهرسة", en: "Pages are indexable" },
    page: (p, s) => (ok200(p) && p.url !== s.home.url ? p.noindex : null),
    ar: {
      title: "صفحات داخلية ممنوعة من الظهور في جوجل (`noindex`)",
      why: "هذه الصفحات لن تظهر في نتائج البحث. هذا طبيعي لصفحات مثل السلة، لكنه خطأ لصفحات المنتجات والأقسام.",
      fix: "إن كانت هذه صفحات منتجات أو أقسام أو مقالات، احذف منها وسم `noindex`.",
    },
    en: {
      title: "Inner pages blocked from Google (noindex)",
      why: "These pages won't appear in search. Fine for a cart page, wrong for products, categories and articles.",
      fix: "If these are products, categories or articles, remove their noindex tag.",
    },
  },
  {
    id: "mixed_content",
    category: "technical",
    severity: "important",
    scope: "page",
    name: { ar: "كل العناصر تُحمّل بأمان", en: "No mixed content" },
    page: (p) => (ok200(p) && p.url.startsWith("https:") ? p.mixedContent > 0 : null),
    ar: {
      title: "عناصر تُحمَّل عبر `http` في صفحة آمنة",
      why: "المتصفح يحظر هذه الصور أو السكربتات أو يُظهر تحذيراً، فتبدو الصفحة ناقصة أو غير آمنة.",
      fix: "غيّر روابط الصور والسكربتات والإطارات في الصفحة لتبدأ بـ `https`.",
    },
    en: {
      title: "Insecure http resources on https pages",
      why: "Browsers block these images or scripts or show a warning, so the page looks broken or unsafe.",
      fix: "Change image, script and iframe URLs on the page to https.",
    },
  },
  // ---------- On-page ----------
  {
    id: "title",
    category: "onpage",
    severity: "critical",
    scope: "page",
    name: { ar: "عنوان الصفحة", en: "Page title" },
    page: (p) => (ok200(p) ? visibleLength(p.title) < 10 : null),
    ar: {
      title: "عنوان الصفحة مفقود أو قصير جداً",
      why: "العنوان (`title`) أهم عنصر لظهورك في جوجل، وهو السطر الأزرق الذي يضغط عليه الباحث.",
      fix: "اكتب لكل صفحة عنواناً يبدأ بالكلمة التي يبحث عنها عميلك ثم اسم نشاطك، مثل: «عطور عود فاخرة في الرياض | متجر ريحان».",
    },
    en: {
      title: "Title missing or too short",
      why: "The title is the most important on-page element and the blue line people click in Google.",
      fix: "Give every page a title that starts with the phrase customers search for, then your brand, e.g. \"Luxury oud perfume in Riyadh | Rayhan Store\".",
    },
    platformFix: {
      salla: { ar: "من لوحة سلة: افتح المنتج أو القسم ← قسم «تحسينات SEO» ← اكتب «عنوان الصفحة». ولعنوان الرئيسية: الإعدادات ← تحسينات SEO.", en: "In Salla: open the product or category → SEO section → page title. For the homepage: Settings → SEO." },
      zid: { ar: "من لوحة زد: افتح المنتج ← قسم «تحسين محركات البحث SEO» ← «عنوان الصفحة». ولعنوان الرئيسية: إعدادات المتجر ← SEO.", en: "In Zid: open the product → SEO section → page title. For the homepage: store settings → SEO." },
    },
    snippet: () => `<title>عطور عود فاخرة في الرياض | متجر ريحان</title>`,
  },
  {
    id: "title_length",
    category: "onpage",
    severity: "minor",
    scope: "page",
    name: { ar: "طول العنوان", en: "Title length" },
    page: (p) => (ok200(p) && visibleLength(p.title) >= 10 ? visibleLength(p.title) > (isArabicPage(p) ? 65 : 60) : null),
    ar: {
      title: "عنوان الصفحة طويل وقد يُقطع في نتائج جوجل",
      why: "جوجل يعرض نحو 600 بكسل من العنوان (قرابة 65 حرفاً عربياً)، وما زاد يُستبدل بنقاط فتضيع الكلمات المهمة.",
      fix: "ضع الكلمة المفتاحية في البداية واختصر اسم المتجر في النهاية.",
    },
    en: {
      title: "Title may be truncated in Google",
      why: "Google shows about 600px of a title (roughly 65 Arabic characters); the rest is cut off.",
      fix: "Put the key phrase first and shorten the brand suffix.",
    },
    platformFix: {
      salla: { ar: "في سلة يضاف اسم المتجر تلقائياً بعد اسم المنتج. اكتب «عنوان الصفحة» يدوياً من قسم «تحسينات SEO» في المنتج بطول أقصر.", en: "Salla appends the store name automatically. Write a shorter page title in the product's SEO section." },
      zid: { ar: "اكتب «عنوان الصفحة» يدوياً من قسم SEO في المنتج بطول أقصر بدلاً من الاسم التلقائي.", en: "Write a shorter page title manually in the product's SEO section." },
    },
  },
  {
    id: "meta_description",
    category: "onpage",
    severity: "important",
    scope: "page",
    name: { ar: "الوصف التعريفي", en: "Meta description" },
    page: (p) => (ok200(p) ? visibleLength(p.metaDescription) === 0 : null),
    ar: {
      title: "الوصف التعريفي مفقود",
      why: "الوصف يظهر تحت العنوان في نتائج جوجل ويقنع الباحث بالضغط. بدونه يختار جوجل نصاً عشوائياً من الصفحة.",
      fix: "اكتب لكل صفحة وصفاً من 50 إلى 160 حرفاً يذكر ما تقدمه وميزة واضحة ودعوة للطلب، مثل التوصيل السريع داخل المملكة.",
    },
    en: {
      title: "Meta description missing",
      why: "The description shows under your title in Google and convinces people to click; without it Google picks random text.",
      fix: "Write a 50–160 character description per page with what you offer, a clear benefit and a call to action.",
    },
    platformFix: {
      salla: { ar: "من لوحة سلة: افتح المنتج ← «تحسينات SEO» ← «وصف الصفحة». وللرئيسية: الإعدادات ← تحسينات SEO.", en: "In Salla: product → SEO section → page description. Homepage: Settings → SEO." },
      zid: { ar: "من لوحة زد: افتح المنتج ← قسم SEO ← «وصف الصفحة». وللرئيسية: إعدادات المتجر ← SEO.", en: "In Zid: product → SEO section → page description. Homepage: store settings → SEO." },
    },
    snippet: () => `<meta name="description" content="تشكيلة عطور عود أصلية بأسعار منافسة، توصيل خلال 24 ساعة داخل الرياض وشحن لكل مدن المملكة. اطلب الآن." />`,
  },
  {
    id: "meta_description_length",
    category: "onpage",
    severity: "minor",
    scope: "page",
    name: { ar: "طول الوصف التعريفي", en: "Description length" },
    page: (p) => {
      const n = visibleLength(p.metaDescription);
      return ok200(p) && n > 0 ? n < 50 || n > 160 : null;
    },
    ar: {
      title: "الوصف التعريفي قصير جداً أو طويل جداً",
      why: "الوصف المثالي بين 50 و160 حرفاً؛ القصير لا يقنع والطويل يُقطع.",
      fix: "أعد كتابة الوصف ليكون جملة أو جملتين تذكر المنتج والميزة ودعوة للطلب.",
    },
    en: {
      title: "Description too short or too long",
      why: "Aim for 50–160 characters; short ones don't persuade and long ones get cut.",
      fix: "Rewrite it as one or two sentences with the product, a benefit and a call to action.",
    },
  },
  {
    id: "duplicate_titles",
    category: "onpage",
    severity: "important",
    scope: "page",
    name: { ar: "عناوين فريدة", en: "Unique titles" },
    page: (p, s) => (ok200(p) && p.title && s.pages.length >= 3 ? (s.titleCounts.get(normText(p.title)) ?? 0) > 1 : null),
    ar: {
      title: "عناوين مكررة في أكثر من صفحة",
      why: "عندما تحمل عدة صفحات العنوان نفسه لا يعرف جوجل أيها يعرض، فيتجاهل بعضها أو يعيد كتابة العنوان بنفسه.",
      fix: "اكتب لكل منتج وقسم عنواناً خاصاً به يذكر اسمه وميزته.",
    },
    en: {
      title: "Duplicate titles across pages",
      why: "When many pages share a title Google can't tell them apart and may drop or rewrite them.",
      fix: "Give each product and category its own title.",
    },
    platformFix: {
      salla: { ar: "افتح كل منتج متأثر في لوحة سلة ← «تحسينات SEO» ← اكتب عنواناً خاصاً به بدلاً من ترك الحقل فارغاً.", en: "Open each affected product in Salla → SEO section → write its own title instead of leaving it empty." },
      zid: { ar: "افتح كل منتج متأثر في لوحة زد ← قسم SEO ← اكتب عنواناً خاصاً به.", en: "Open each affected product in Zid → SEO section → write its own title." },
    },
  },
  {
    id: "duplicate_descriptions",
    category: "onpage",
    severity: "minor",
    scope: "page",
    name: { ar: "أوصاف فريدة", en: "Unique descriptions" },
    page: (p, s) => (ok200(p) && p.metaDescription && s.pages.length >= 3 ? (s.descCounts.get(normText(p.metaDescription)) ?? 0) > 1 : null),
    ar: {
      title: "وصف تعريفي مكرر في أكثر من صفحة",
      why: "الوصف المكرر لا يميز صفحاتك في النتائج، فيقل الضغط عليها.",
      fix: "اكتب وصفاً مختلفاً لكل منتج وقسم.",
    },
    en: {
      title: "Duplicate meta descriptions",
      why: "Repeated descriptions don't distinguish your pages in results, so fewer people click.",
      fix: "Write a distinct description for each product and category.",
    },
  },
  {
    id: "h1",
    category: "onpage",
    severity: "important",
    scope: "page",
    name: { ar: "العنوان الرئيسي H1", en: "H1 heading" },
    page: (p) => (ok200(p) ? p.h1Count === 0 : null),
    ar: {
      title: "العنوان الرئيسي `H1` مفقود",
      why: "العنوان الرئيسي (`H1`) يوضح لجوجل وللزائر موضوع الصفحة الأساسي.",
      fix: "أضف في كل صفحة عنواناً رئيسياً `H1` يحتوي الكلمة المفتاحية الأساسية.",
    },
    en: {
      title: "Missing H1 heading",
      why: "The H1 tells Google and visitors the page's main topic.",
      fix: "Add an H1 containing the main keyword to each page.",
    },
    snippet: () => `<h1>عطور عود فاخرة</h1>`,
  },
  {
    id: "img_alt",
    category: "onpage",
    severity: "important",
    scope: "page",
    name: { ar: "النص البديل للصور", en: "Image alt text" },
    page: (p) => (p.isHtml && p.imgCount > 0 ? p.imgMissingAlt > 0 : null),
    ar: {
      title: "صور بدون نص بديل (`alt`)",
      why: "النص البديل يجعل صورك تظهر في بحث الصور في جوجل، وهو مصدر زيارات مهم للمتاجر.",
      fix: "أضف وصفاً عربياً قصيراً لكل صورة يصف المنتج، مثل: «عطر عود ملكي 100 مل».",
    },
    en: {
      title: "Images without alt text",
      why: "Alt text gets your images into Google Images, an important traffic source for stores.",
      fix: "Add a short descriptive alt to every image, e.g. \"Royal oud perfume 100 ml\".",
    },
    platformFix: {
      salla: { ar: "في لوحة سلة: افتح المنتج ← اضغط على الصورة ← اكتب «النص البديل» وصفاً قصيراً للمنتج. وللبنرات: من «تصميم المتجر».", en: "In Salla: open the product → click the image → fill in the alt text. For banners: Store design." },
      zid: { ar: "في لوحة زد: افتح المنتج ← الصور ← أضف وصفاً بديلاً لكل صورة.", en: "In Zid: open the product → images → add alt text to each image." },
    },
    snippet: () => `<img src="oud.jpg" alt="عطر عود ملكي 100 مل" />`,
  },
  {
    id: "thin_content",
    category: "onpage",
    severity: "minor",
    scope: "page",
    name: { ar: "كمية المحتوى", en: "Content length" },
    page: (p) => (ok200(p) ? p.wordCount < (isArabicPage(p) ? 150 : 200) : null),
    ar: {
      title: "محتوى قليل في الصفحة",
      why: "الصفحات التي فيها نص قليل نادراً ما تتصدر، لأن جوجل لا يجد ما يكفي لفهم موضوعها.",
      fix: "أضف نصاً مفيداً بالعربية: وصفاً تفصيلياً للمنتج أو الخدمة، أسئلة شائعة، ومعلومات الشحن والضمان.",
    },
    en: {
      title: "Thin content",
      why: "Pages with little text rarely rank because Google can't tell what they're about.",
      fix: "Add useful text: detailed product or service descriptions, FAQs, shipping and warranty details.",
    },
    platformFix: {
      salla: { ar: "اكتب «وصف المنتج» في لوحة سلة بفقرتين على الأقل: المكونات أو المواصفات، طريقة الاستخدام، ولمن يناسب. وأضف نصاً تعريفياً في الرئيسية من «تصميم المتجر».", en: "Write at least two paragraphs in Salla's product description: specs, how to use, who it suits. Add intro text to the homepage via Store design." },
      zid: { ar: "اكتب وصفاً مفصلاً للمنتج في لوحة زد بفقرتين على الأقل، وأضف نصاً تعريفياً في الرئيسية من إعدادات التصميم.", en: "Write a detailed product description in Zid (two paragraphs+) and add intro text to the homepage." },
    },
  },
  {
    id: "product_schema",
    category: "onpage",
    severity: "important",
    scope: "page",
    name: { ar: "بيانات المنتج", en: "Product data" },
    page: (p) => (ok200(p) && isProductPage(p) ? !hasValidProduct(p.jsonLd) : null),
    ar: {
      title: "صفحات منتجات بدون بيانات منتج (`Product`)",
      why: "بيانات `Product` مع السعر بالريال والتوفر تتيح لجوجل عرض السعر وحالة التوفر تحت نتيجتك وفي تبويب التسوق، فترتفع النقرات.",
      fix: "أضف بيانات `Product` منظمة لكل منتج تتضمن السعر والعملة وحالة التوفر.",
    },
    en: {
      title: "Product pages without Product data",
      why: "Product data with SAR price and availability lets Google show price and stock under your result and in Shopping.",
      fix: "Add Product structured data with price, currency and availability to each product.",
    },
    platformFix: {
      salla: { ar: "سلة تضيف هذه البيانات تلقائياً عندما تكون حقول المنتج مكتملة (السعر، الكمية، الوصف، الصورة). أكمل الحقول، وإن استمرت المشكلة تواصل مع دعم سلة أو جرّب قالباً آخر.", en: "Salla adds this automatically when product fields are complete (price, quantity, description, image). Complete them; if it persists contact Salla support or try another theme." },
      zid: { ar: "زد تضيف هذه البيانات تلقائياً عند اكتمال حقول المنتج. أكمل السعر والكمية والوصف والصورة، وإن استمرت تواصل مع دعم زد.", en: "Zid adds this automatically when product fields are complete. Complete them; if it persists contact Zid support." },
    },
    snippet: () => `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "عطر عود ملكي 100 مل",
  "image": "https://example.sa/oud.jpg",
  "offers": {
    "@type": "Offer",
    "price": "199",
    "priceCurrency": "SAR",
    "availability": "https://schema.org/InStock"
  }
}
</script>`,
  },
  {
    id: "internal_links",
    category: "onpage",
    severity: "minor",
    scope: "page",
    name: { ar: "الروابط الداخلية", en: "Internal links" },
    page: (p) => (ok200(p) ? p.internalLinks.length < 3 : null),
    ar: {
      title: "روابط داخلية قليلة",
      why: "الروابط الداخلية توزّع قوة الصفحة الرئيسية على باقي صفحاتك وتساعد جوجل على اكتشافها.",
      fix: "اربط بين صفحاتك: من الرئيسية إلى الأقسام، ومن المنتجات إلى منتجات مشابهة، ومن المقالات إلى الخدمات.",
    },
    en: {
      title: "Few internal links",
      why: "Internal links pass authority from your homepage to other pages and help Google discover them.",
      fix: "Link pages together: home to categories, products to related products, articles to services.",
    },
  },
  {
    id: "open_graph",
    category: "onpage",
    severity: "minor",
    scope: "page",
    name: { ar: "وسوم المشاركة", en: "Open Graph tags" },
    page: (p) => (ok200(p) ? !p.ogTitle || !/^https:\/\//i.test(p.ogImage) : null),
    ar: {
      title: "وسوم المشاركة (`Open Graph`) ناقصة",
      why: "عند مشاركة رابطك في واتساب أو إكس أو سناب يظهر بدون صورة أو عنوان جذاب، فتقل النقرات. واتساب يتجاهل الصور ذات الروابط النسبية.",
      fix: "أضف وسوم `og:title` و `og:description` و `og:image` برابط صورة كامل يبدأ بـ `https`.",
    },
    en: {
      title: "Open Graph tags incomplete",
      why: "Links shared on WhatsApp, X or Snapchat show without an image or proper title. WhatsApp ignores relative image URLs.",
      fix: "Add og:title, og:description and og:image with a full https image URL.",
    },
    snippet: ({ origin }) => `<meta property="og:title" content="اسم نشاطك: ما تقدمه في جملة" />\n<meta property="og:description" content="وصف قصير يشجع على النقر" />\n<meta property="og:image" content="${origin}/og-image.jpg" />\n<meta property="og:locale" content="ar_SA" />`,
  },
  {
    id: "structured_data",
    category: "onpage",
    severity: "important",
    scope: "site",
    platformControlled: true,
    name: { ar: "البيانات المنظمة", en: "Structured data" },
    site: (s) => (s.home.isHtml ? s.home.jsonLd.length === 0 : null),
    ar: {
      title: "لا توجد بيانات منظمة (`Schema`)",
      why: "البيانات المنظمة تساعد جوجل على فهم نشاطك وعرض نتائج مميزة مثل التقييمات والأسعار، فتزيد النقرات.",
      fix: "أضف كود `JSON-LD` من نوع `Organization` أو `LocalBusiness` في الصفحة الرئيسية، و `Product` في صفحات المنتجات.",
    },
    en: {
      title: "No structured data (Schema)",
      why: "Structured data helps Google understand your business and show rich results such as ratings and prices.",
      fix: "Add Organization or LocalBusiness JSON-LD on the homepage and Product on product pages.",
    },
  },
  // ---------- Mobile ----------
  {
    id: "viewport",
    category: "mobile",
    severity: "critical",
    scope: "page",
    platformControlled: true,
    name: { ar: "التوافق مع الجوال", en: "Mobile viewport" },
    page: (p) => (ok200(p) ? !/width\s*=\s*device-width/i.test(p.viewport) : null),
    ar: {
      title: "الموقع غير مهيأ للجوال",
      why: "جوجل يقيّم موقعك بنسخة الجوال أولاً، وأغلب الباحثين في السعودية يستخدمون الجوال.",
      fix: "أضف وسم `viewport` في `<head>` وتأكد أن التصميم متجاوب مع الشاشات الصغيرة.",
    },
    en: {
      title: "Not mobile-friendly (no viewport)",
      why: "Google indexes the mobile version first, and most searchers in Saudi Arabia are on mobile.",
      fix: "Add the viewport meta tag to the <head> and make sure the design is responsive.",
    },
    snippet: () => `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
  },
  {
    id: "favicon",
    category: "mobile",
    severity: "minor",
    scope: "site",
    name: { ar: "أيقونة الموقع", en: "Favicon" },
    site: (s) => (s.home.isHtml ? !s.home.hasFavicon : null),
    ar: {
      title: "أيقونة الموقع (`favicon`) مفقودة",
      why: "جوجل يعرض أيقونة موقعك بجانب النتيجة في الجوال، وغيابها يقلل الثقة والنقرات.",
      fix: "أضف أيقونة مربعة بمقاس 48×48 على الأقل واربطها في `<head>`.",
    },
    en: {
      title: "Missing favicon",
      why: "Google shows your icon next to mobile results; without it the result looks less trustworthy.",
      fix: "Add a square icon of at least 48×48 px and link it in the <head>.",
    },
    platformFix: {
      salla: { ar: "في لوحة سلة: الإعدادات ← إعدادات المتجر ← ارفع «أيقونة المتجر».", en: "In Salla: Settings → Store settings → upload the store icon." },
      zid: { ar: "في لوحة زد: إعدادات المتجر ← الهوية ← ارفع أيقونة المتجر.", en: "In Zid: store settings → identity → upload the store icon." },
    },
    snippet: () => `<link rel="icon" href="/favicon.png" sizes="48x48" />`,
  },
  // ---------- Arabic & Saudi ----------
  {
    id: "lang_ar",
    category: "saudi",
    severity: "important",
    scope: "page",
    platformControlled: true,
    name: { ar: "لغة الصفحة", en: "Page language" },
    page: (p) => {
      if (!ok200(p)) return null;
      if (!p.lang) return true;
      return isArabicPage(p) ? !p.lang.startsWith("ar") : null;
    },
    ar: {
      title: "لغة الصفحة غير محددة كعربية",
      why: "سمة `lang=\"ar\"` تخبر جوجل أن الصفحة عربية فيعرضها للباحثين بالعربية في السعودية والخليج.",
      fix: "أضف `lang=\"ar\"` إلى وسم `<html>` في الصفحات العربية، و `lang=\"en\"` في الصفحات الإنجليزية.",
    },
    en: {
      title: "Page language not declared as Arabic",
      why: "lang=\"ar\" tells Google the page is Arabic so it's shown to Arabic searchers in Saudi Arabia and the Gulf.",
      fix: "Add lang=\"ar\" to the <html> tag of Arabic pages and lang=\"en\" on English pages.",
    },
    snippet: () => `<html lang="ar" dir="rtl">`,
  },
  {
    id: "dir_rtl",
    category: "saudi",
    severity: "important",
    scope: "page",
    platformControlled: true,
    name: { ar: "اتجاه النص RTL", en: "Right-to-left direction" },
    page: (p) => (ok200(p) && isArabicPage(p) ? p.dir !== "rtl" : null),
    ar: {
      title: "اتجاه الصفحة ليس من اليمين لليسار",
      why: "بدون `dir=\"rtl\"` تظهر النصوص العربية وعلامات الترقيم بشكل مكسور، فيغادر الزائر بسرعة.",
      fix: "أضف `dir=\"rtl\"` إلى وسم `<html>` في الصفحات العربية.",
    },
    en: {
      title: "Arabic page not set to right-to-left",
      why: "Without dir=\"rtl\", Arabic text and punctuation render broken and visitors leave quickly.",
      fix: "Add dir=\"rtl\" to the <html> tag of Arabic pages.",
    },
    snippet: () => `<html lang="ar" dir="rtl">`,
  },
  {
    id: "arabic_meta",
    category: "saudi",
    severity: "important",
    scope: "page",
    name: { ar: "عنوان باللغة العربية", en: "Arabic title" },
    page: (p) => (ok200(p) && isArabicPage(p) && p.title ? !hasArabic(p.title) : null),
    ar: {
      title: "عنوان الصفحة العربية مكتوب بالإنجليزية",
      why: "الباحث السعودي يكتب بالعربية غالباً، والعنوان الإنجليزي لا يطابق بحثه فلا تظهر صفحتك.",
      fix: "اكتب العنوان والوصف بالعربية بالكلمات التي يستخدمها عملاؤك، ويمكنك إضافة الاسم الإنجليزي في النهاية.",
    },
    en: {
      title: "Arabic page has an English-only title",
      why: "Saudi searchers mostly type in Arabic; an English title doesn't match their search.",
      fix: "Write the title and description in Arabic using your customers' words; add the English brand name at the end if you like.",
    },
  },
  {
    id: "hreflang",
    category: "saudi",
    severity: "minor",
    scope: "site",
    name: { ar: "ربط النسخ اللغوية", en: "Language versions (hreflang)" },
    site: (s) => {
      const h = s.home.hreflangs;
      if (h.length === 0) return s.home.linksToEnglishVersion ? true : null;
      if (h.some((x) => !HREFLANG_CODE.test(x.lang) || /^sa(-|$)/i.test(x.lang))) return true;
      const norm = (u: string) => u.replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");
      const selfRef = h.some((x) => norm(x.href) === norm(s.home.url));
      return !selfRef || !h.some((x) => x.lang.toLowerCase().startsWith("ar")) || !h.some((x) => /^(x-default|en)/i.test(x.lang));
    },
    ar: {
      title: "ربط النسختين العربية والإنجليزية (`hreflang`) ناقص أو خاطئ",
      why: "إذا كان لموقعك نسختان، فوسوم `hreflang` تضمن ظهور النسخة العربية للباحث العربي والإنجليزية للباحث الإنجليزي.",
      fix: "أضف في `<head>` كل صفحة وسوماً تشير للنسختين وللصفحة نفسها ولنسخة افتراضية `x-default`. استخدم `ar` لكل العرب أو `ar-SA` للسعودية فقط، ولا تكتب `sa` لأنها رمز لغة السنسكريتية.",
    },
    en: {
      title: "Arabic/English versions not linked correctly (hreflang)",
      why: "If your site has two languages, hreflang makes Google show Arabic to Arabic searchers and English to English searchers.",
      fix: "Add hreflang links to both versions, the page itself and an x-default. Use ar or ar-SA, never \"sa\" (that's Sanskrit).",
    },
    snippet: ({ origin }) => `<link rel="alternate" hreflang="ar" href="${origin}/" />\n<link rel="alternate" hreflang="en" href="${origin}/en/" />\n<link rel="alternate" hreflang="x-default" href="${origin}/" />`,
  },
  {
    id: "local_schema",
    category: "saudi",
    severity: "minor",
    scope: "site",
    name: { ar: "بيانات النشاط في السعودية", en: "Saudi business data" },
    site: (s) => (s.home.isHtml ? !hasSaudiBusinessData(s.home.jsonLd) : null),
    ar: {
      title: "بيانات نشاطك في السعودية غير موجودة في الموقع",
      why: "ظهورك في خرائط جوجل ونتائج «قريب مني» يعتمد أساساً على ملفك في `Google Business Profile`، وبيانات `Organization` أو `LocalBusiness` بعنوانك ورقمك السعودي تؤكد لجوجل أن موقعك هو النشاط نفسه.",
      fix: "أنشئ أو وثّق ملفك في `Google Business Profile`، وأضف كود `LocalBusiness` بعنوانك في المملكة ورقمك بصيغة `+966`.",
    },
    en: {
      title: "No Saudi business data on the site",
      why: "Maps and \"near me\" visibility comes mainly from Google Business Profile; Organization/LocalBusiness data with your Saudi address and phone confirms the site is that business.",
      fix: "Create or verify your Google Business Profile and add LocalBusiness JSON-LD with your KSA address and +966 phone.",
    },
    snippet: ({ origin }) => `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "اسم نشاطك",
  "url": "${origin}/",
  "telephone": "+966500000000",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "طريق الملك فهد",
    "addressLocality": "الرياض",
    "addressCountry": "SA"
  }
}
</script>`,
  },
  {
    id: "readable_urls",
    category: "saudi",
    severity: "minor",
    scope: "page",
    name: { ar: "روابط واضحة", en: "Readable URLs" },
    page: (p) => {
      if (!ok200(p)) return null;
      const u = new URL(p.url);
      let decodedLen = (u.pathname + u.search).length;
      try {
        decodedLen = decodeURIComponent(u.pathname + u.search).length;
      } catch {
        /* keep raw length */
      }
      return decodedLen > 100 || [...u.searchParams.keys()].length > 2;
    },
    ar: {
      title: "روابط صفحات طويلة أو غير مقروءة",
      why: "الروابط القصيرة الواضحة تُفهم أسرع من جوجل والزائر، وتُشارك بسهولة.",
      fix: "استخدم روابط قصيرة تصف المحتوى مثل `/عطور-عود` أو `/oud-perfume` بدلاً من المعاملات الطويلة.",
    },
    en: {
      title: "Long or unreadable URLs",
      why: "Short descriptive URLs are understood faster by Google and visitors and are easier to share.",
      fix: "Use short descriptive slugs like /oud-perfume instead of long parameters.",
    },
  },
];

export const CHECK_BY_ID: Record<string, CheckDef> = Object.fromEntries(CHECKS.map((c) => [c.id, c]));

export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 15, important: 5, minor: 1 };
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, important: 1, minor: 2 };

import { hasArabic, type PageFacts, type RobotsInfo } from "./analyze";

export type Severity = "critical" | "important" | "minor";
export type Category = "technical" | "onpage" | "mobile" | "saudi";

export interface SiteFacts {
  host: string;
  origin: string;
  https: boolean;
  httpRedirectsToHttps: boolean | null;
  home: PageFacts;
  pages: PageFacts[];
  robots: RobotsInfo;
  sitemapFound: boolean;
  isArabicSite: boolean;
}

interface Copy {
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
  snippet?: (site: { host: string; origin: string }) => string;
  /** Page checks: return true when the page FAILS, null when not applicable. */
  page?: (p: PageFacts, s: SiteFacts) => boolean | null;
  /** Site checks: return true when the site FAILS, null when not applicable. */
  site?: (s: SiteFacts) => boolean | null;
}

const isArabicPage = (p: PageFacts) => p.arabicRatio >= 0.3;

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

function hasSaudiLocalSchema(jsonLd: unknown[]): boolean {
  const nodes = schemaNodes(jsonLd);
  const relevant = nodes.filter((n) => {
    const t = ([] as unknown[]).concat(n["@type"] ?? []).map(String).join(" ");
    return /Organization|LocalBusiness|Store|Restaurant|Dentist|MedicalClinic|Physician|Hotel|AutoRepair|ProfessionalService|Corporation/i.test(t);
  });
  return relevant.some((n) => {
    const s = JSON.stringify(n);
    const saudiAddress = /"addressCountry"\s*:\s*("(SA|KSA|Saudi Arabia|السعودية|المملكة العربية السعودية)"|\{[^}]*"(SA|Saudi Arabia)")/i.test(s);
    const saudiPhone = /(\+966|00966)/.test(s);
    return saudiAddress && saudiPhone;
  });
}

export const CHECKS: CheckDef[] = [
  // ---------- Technical ----------
  {
    id: "https",
    category: "technical",
    severity: "critical",
    scope: "site",
    site: (s) => !s.https,
    ar: {
      title: "الموقع لا يعمل عبر HTTPS",
      why: "جوجل يعتبر HTTPS عامل ترتيب، والمتصفحات تعرض تحذير \"غير آمن\" للزوار مما يرفع نسبة الخروج.",
      fix: "فعّل شهادة SSL مجانية (Let's Encrypt) من لوحة الاستضافة أو عبر Cloudflare، ثم اجعل كل الروابط تبدأ بـ https.",
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
    site: (s) => (s.https && s.httpRedirectsToHttps !== null ? !s.httpRedirectsToHttps : null),
    ar: {
      title: "نسخة http لا تتحول تلقائياً إلى https",
      why: "وجود نسختين من الموقع يشتت قوة الروابط بينهما وقد يفهرس جوجل النسخة غير الآمنة.",
      fix: "أضف تحويلاً دائماً 301 من http إلى https في إعدادات الخادم أو Cloudflare (Always Use HTTPS).",
    },
    en: {
      title: "http:// does not redirect to https://",
      why: "Two copies of the site split link equity and Google may index the insecure one.",
      fix: "Add a permanent 301 redirect from http to https in your server or Cloudflare (Always Use HTTPS).",
    },
    snippet: () => `# Apache (.htaccess)\nRewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]\n\n# Nginx\nserver {\n  listen 80;\n  return 301 https://$host$request_uri;\n}`,
  },
  {
    id: "status_ok",
    category: "technical",
    severity: "critical",
    scope: "page",
    page: (p) => p.status !== 200,
    ar: {
      title: "صفحات لا تعمل (خطأ أو صفحة غير موجودة)",
      why: "الصفحات التي ترجع خطأ 404 أو 500 لا تظهر في جوجل وتضيّع الزوار القادمين لها.",
      fix: "أصلح الصفحة أو حوّلها بتحويل 301 لأقرب صفحة بديلة، واحذف الروابط الداخلية المكسورة.",
    },
    en: {
      title: "Pages returning errors",
      why: "Pages that return 404 or 500 errors don't rank and lose the visitors who land on them.",
      fix: "Fix the page or 301-redirect it to the closest alternative, and remove broken internal links.",
    },
  },
  {
    id: "response_time",
    category: "technical",
    severity: "important",
    scope: "site",
    site: (s) => (s.home.status ? s.home.ms > 1500 : null),
    ar: {
      title: "الموقع بطيء في الاستجابة",
      why: "سرعة الموقع عامل ترتيب في جوجل، وأغلب الزوار من الجوال يغادرون إذا تأخر التحميل أكثر من 3 ثوانٍ.",
      fix: "استخدم استضافة قريبة من السعودية أو شبكة CDN مثل Cloudflare، فعّل التخزين المؤقت (cache)، وقلّل الإضافات الثقيلة.",
    },
    en: {
      title: "Slow server response",
      why: "Speed is a Google ranking factor and most mobile visitors leave if a page takes more than 3 seconds.",
      fix: "Use hosting close to Saudi Arabia or a CDN like Cloudflare, enable caching, and remove heavy plugins.",
    },
  },
  {
    id: "page_weight",
    category: "technical",
    severity: "minor",
    scope: "page",
    page: (p) => (p.isHtml ? p.bytes > 300 * 1024 : null),
    ar: {
      title: "حجم كود الصفحة كبير",
      why: "صفحات HTML الكبيرة (أكثر من 300 كيلوبايت) تبطئ التحميل على شبكات الجوال.",
      fix: "انقل الأكواد المضمّنة (CSS و JavaScript) إلى ملفات خارجية، وفعّل ضغط gzip أو brotli على الخادم.",
    },
    en: {
      title: "Heavy HTML pages",
      why: "HTML documents over 300 KB slow down loading on mobile networks.",
      fix: "Move inline CSS and JavaScript to external files and enable gzip or brotli compression.",
    },
  },
  {
    id: "robots",
    category: "technical",
    severity: "important",
    scope: "site",
    site: (s) => !s.robots.exists || s.robots.blocksAll,
    ar: {
      title: "ملف robots.txt مفقود أو يمنع جوجل",
      why: "ملف robots.txt يوجّه محركات البحث، وإذا كان يحتوي Disallow: / فإن جوجل لن يزحف لموقعك أبداً.",
      fix: "أنشئ ملف robots.txt في جذر الموقع يسمح بالزحف ويشير إلى خريطة الموقع.",
    },
    en: {
      title: "robots.txt missing or blocking Google",
      why: "robots.txt guides crawlers; a \"Disallow: /\" rule stops Google from crawling the whole site.",
      fix: "Add a robots.txt at the site root that allows crawling and points to your sitemap.",
    },
    snippet: ({ origin }) => `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml`,
  },
  {
    id: "sitemap",
    category: "technical",
    severity: "important",
    scope: "site",
    site: (s) => !s.sitemapFound,
    ar: {
      title: "لا توجد خريطة موقع sitemap.xml",
      why: "خريطة الموقع تساعد جوجل على اكتشاف كل صفحاتك ومنتجاتك الجديدة بسرعة.",
      fix: "فعّل خريطة الموقع (سلة وزد ووردبريس مع Yoast تنشئها تلقائياً)، ثم أرسلها في Google Search Console.",
    },
    en: {
      title: "No sitemap.xml found",
      why: "A sitemap helps Google discover all your pages and new products quickly.",
      fix: "Enable a sitemap (Salla, Zid and WordPress with Yoast generate one automatically) and submit it in Google Search Console.",
    },
  },
  {
    id: "canonical",
    category: "technical",
    severity: "minor",
    scope: "page",
    page: (p) => (p.isHtml && p.status === 200 ? !p.canonical : null),
    ar: {
      title: "وسم canonical مفقود",
      why: "بدونه قد يرى جوجل نفس الصفحة بعدة روابط (مع معاملات تتبع مثلاً) ويعتبرها محتوى مكرراً.",
      fix: "أضف وسم canonical في <head> كل صفحة يشير إلى رابطها الأساسي.",
    },
    en: {
      title: "Missing canonical tag",
      why: "Without it Google may see the same page under several URLs (e.g. with tracking parameters) as duplicate content.",
      fix: "Add a canonical link in each page's <head> pointing to its main URL.",
    },
    snippet: ({ origin }) => `<link rel="canonical" href="${origin}/" />`,
  },
  {
    id: "noindex",
    category: "technical",
    severity: "critical",
    scope: "page",
    page: (p) => (p.isHtml && p.status === 200 ? p.noindex : null),
    ar: {
      title: "صفحات ممنوعة من الظهور في جوجل (noindex)",
      why: "وسم noindex يطلب من جوجل عدم إظهار الصفحة نهائياً، وغالباً يبقى بالخطأ بعد مرحلة التطوير.",
      fix: "احذف وسم <meta name=\"robots\" content=\"noindex\"> أو ترويسة X-Robots-Tag من الصفحات التي تريد ظهورها. في ووردبريس: الإعدادات ← القراءة ← ألغِ \"منع محركات البحث\".",
    },
    en: {
      title: "Pages blocked from Google (noindex)",
      why: "noindex tells Google never to show the page, and it is often left on by mistake after development.",
      fix: "Remove <meta name=\"robots\" content=\"noindex\"> or the X-Robots-Tag header from pages you want indexed. In WordPress: Settings → Reading → untick \"Discourage search engines\".",
    },
  },
  // ---------- On-page ----------
  {
    id: "title",
    category: "onpage",
    severity: "critical",
    scope: "page",
    page: (p) => (p.isHtml && p.status === 200 ? p.title.length < 15 || p.title.length > 60 : null),
    ar: {
      title: "عنوان الصفحة مفقود أو بطول غير مناسب",
      why: "العنوان (title) هو أهم عنصر لظهورك في جوجل، وهو السطر الأزرق الذي يضغط عليه الباحث. الطول المثالي 15 إلى 60 حرفاً.",
      fix: "اكتب لكل صفحة عنواناً فريداً يبدأ بالكلمة التي يبحث عنها عميلك ثم اسم نشاطك، مثل: \"عطور عود فاخرة في الرياض | متجر ريحان\".",
    },
    en: {
      title: "Title missing or wrong length",
      why: "The title is the most important on-page element and the blue line people click in Google. Aim for 15–60 characters.",
      fix: "Give every page a unique title that starts with the phrase customers search for, then your brand, e.g. \"Luxury oud perfume in Riyadh | Rayhan Store\".",
    },
    snippet: () => `<title>عطور عود فاخرة في الرياض | متجر ريحان</title>`,
  },
  {
    id: "meta_description",
    category: "onpage",
    severity: "important",
    scope: "page",
    page: (p) => (p.isHtml && p.status === 200 ? p.metaDescription.length < 50 || p.metaDescription.length > 160 : null),
    ar: {
      title: "الوصف التعريفي مفقود أو بطول غير مناسب",
      why: "الوصف يظهر تحت العنوان في نتائج جوجل ويقنع الباحث بالضغط. الطول المثالي 50 إلى 160 حرفاً.",
      fix: "اكتب وصفاً جذاباً لكل صفحة يذكر ما تقدمه وميزة واضحة ودعوة للتواصل، مثل التوصيل السريع داخل المملكة.",
    },
    en: {
      title: "Meta description missing or wrong length",
      why: "The description shows under your title in Google and convinces people to click. Aim for 50–160 characters.",
      fix: "Write a compelling description per page with what you offer, a clear benefit and a call to action (e.g. fast delivery across KSA).",
    },
    snippet: () => `<meta name="description" content="تشكيلة عطور عود أصلية بأسعار منافسة، توصيل خلال 24 ساعة داخل الرياض وشحن لكل مدن المملكة. اطلب الآن." />`,
  },
  {
    id: "h1",
    category: "onpage",
    severity: "important",
    scope: "page",
    page: (p) => (p.isHtml && p.status === 200 ? p.h1Count !== 1 : null),
    ar: {
      title: "العنوان الرئيسي H1 مفقود أو مكرر",
      why: "كل صفحة تحتاج عنواناً رئيسياً واحداً (H1) يوضح لجوجل موضوعها الأساسي.",
      fix: "اجعل في كل صفحة وسم H1 واحداً فقط يحتوي الكلمة المفتاحية الأساسية، واستخدم H2 و H3 للعناوين الفرعية.",
    },
    en: {
      title: "H1 heading missing or duplicated",
      why: "Each page needs exactly one H1 that tells Google its main topic.",
      fix: "Use exactly one H1 per page containing the main keyword; use H2 and H3 for sub-headings.",
    },
    snippet: () => `<h1>عطور عود فاخرة</h1>`,
  },
  {
    id: "heading_order",
    category: "onpage",
    severity: "minor",
    scope: "page",
    page: (p) => {
      if (!p.isHtml || p.status !== 200 || p.headingLevels.length < 2) return null;
      for (let i = 1; i < p.headingLevels.length; i++) if (p.headingLevels[i] - p.headingLevels[i - 1] > 1) return true;
      return false;
    },
    ar: {
      title: "تسلسل العناوين غير مرتب",
      why: "القفز من H1 إلى H3 مباشرة يصعّب على جوجل وقارئات الشاشة فهم بنية المحتوى.",
      fix: "رتّب العناوين بتسلسل منطقي: H1 ثم H2 ثم H3 دون تخطي مستويات.",
    },
    en: {
      title: "Headings skip levels",
      why: "Jumping from H1 straight to H3 makes structure harder for Google and screen readers to understand.",
      fix: "Order headings logically: H1, then H2, then H3, without skipping levels.",
    },
  },
  {
    id: "img_alt",
    category: "onpage",
    severity: "important",
    scope: "page",
    page: (p) => (p.isHtml && p.imgCount > 0 ? p.imgMissingAlt > 0 : null),
    ar: {
      title: "صور بدون نص بديل (alt)",
      why: "النص البديل يجعل صورك تظهر في بحث الصور في جوجل، وهو مصدر زيارات مهم للمتاجر.",
      fix: "أضف وصفاً عربياً قصيراً لكل صورة يصف المنتج، مثل: alt=\"عطر عود ملكي 100 مل\". في سلة وزد يوجد حقل للنص البديل عند رفع صورة المنتج.",
    },
    en: {
      title: "Images without alt text",
      why: "Alt text gets your images into Google Images, an important traffic source for stores.",
      fix: "Add a short descriptive alt to every image, e.g. alt=\"Royal oud perfume 100 ml\". Salla and Zid have an alt field when uploading product images.",
    },
    snippet: () => `<img src="oud.jpg" alt="عطر عود ملكي 100 مل" />`,
  },
  {
    id: "thin_content",
    category: "onpage",
    severity: "important",
    scope: "page",
    page: (p) => (p.isHtml && p.status === 200 ? p.wordCount < 250 : null),
    ar: {
      title: "محتوى قليل في الصفحة",
      why: "الصفحات التي تحتوي أقل من 250 كلمة نادراً ما تتصدر، لأن جوجل لا يجد ما يكفي لفهم موضوعها.",
      fix: "أضف نصاً مفيداً بالعربية: وصفاً تفصيلياً للمنتج أو الخدمة، أسئلة شائعة، ومعلومات الشحن والضمان.",
    },
    en: {
      title: "Thin content",
      why: "Pages with fewer than 250 words rarely rank because Google can't tell what they're about.",
      fix: "Add useful text: detailed product or service descriptions, FAQs, and shipping and warranty details.",
    },
  },
  {
    id: "internal_links",
    category: "onpage",
    severity: "minor",
    scope: "page",
    page: (p) => (p.isHtml && p.status === 200 ? p.internalLinks.length < 3 : null),
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
    page: (p) => (p.isHtml && p.status === 200 ? !p.ogTitle || !p.ogImage : null),
    ar: {
      title: "وسوم المشاركة (Open Graph) مفقودة",
      why: "عند مشاركة رابطك في واتساب أو إكس أو سناب يظهر بدون صورة وعنوان جذاب، فتقل نقرات الزوار.",
      fix: "أضف وسوم og:title و og:description و og:image في <head>.",
    },
    en: {
      title: "Open Graph tags missing",
      why: "Links shared on WhatsApp, X or Snapchat show without an image or proper title, so fewer people click.",
      fix: "Add og:title, og:description and og:image tags to the <head>.",
    },
    snippet: ({ origin }) => `<meta property="og:title" content="متجر ريحان للعطور" />\n<meta property="og:description" content="عطور عود أصلية مع توصيل سريع" />\n<meta property="og:image" content="${origin}/og-image.jpg" />\n<meta property="og:locale" content="ar_SA" />`,
  },
  {
    id: "structured_data",
    category: "onpage",
    severity: "important",
    scope: "site",
    site: (s) => (s.home.isHtml ? s.home.jsonLd.length === 0 : null),
    ar: {
      title: "لا توجد بيانات منظمة (Schema)",
      why: "البيانات المنظمة تتيح لجوجل عرض نتائج مميزة مثل التقييمات والأسعار والأسئلة الشائعة، فتزيد النقرات.",
      fix: "أضف كود JSON-LD من نوع Organization أو LocalBusiness أو Product في صفحاتك.",
    },
    en: {
      title: "No structured data (Schema)",
      why: "Structured data lets Google show rich results such as ratings, prices and FAQs, which increases clicks.",
      fix: "Add JSON-LD of type Organization, LocalBusiness or Product to your pages.",
    },
  },
  // ---------- Mobile ----------
  {
    id: "viewport",
    category: "mobile",
    severity: "critical",
    scope: "page",
    page: (p) => (p.isHtml && p.status === 200 ? !/width\s*=\s*device-width/i.test(p.viewport) : null),
    ar: {
      title: "الموقع غير مهيأ للجوال",
      why: "جوجل يقيّم موقعك بنسخة الجوال أولاً، وأغلب الباحثين في السعودية يستخدمون الجوال.",
      fix: "أضف وسم viewport في <head> وتأكد أن التصميم متجاوب.",
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
    site: (s) => (s.home.isHtml ? !s.home.hasFavicon : null),
    ar: {
      title: "أيقونة الموقع (favicon) مفقودة",
      why: "جوجل يعرض أيقونة موقعك بجانب النتيجة في الجوال، وغيابها يقلل الثقة والنقرات.",
      fix: "أضف أيقونة مربعة بمقاس 48×48 على الأقل واربطها في <head>.",
    },
    en: {
      title: "Missing favicon",
      why: "Google shows your icon next to mobile results; without it the result looks less trustworthy.",
      fix: "Add a square icon of at least 48×48 px and link it in the <head>.",
    },
    snippet: () => `<link rel="icon" href="/favicon.png" sizes="48x48" />`,
  },
  // ---------- Arabic & Saudi ----------
  {
    id: "lang_ar",
    category: "saudi",
    severity: "important",
    scope: "page",
    page: (p) => {
      if (!p.isHtml || p.status !== 200) return null;
      if (!p.lang) return true;
      return isArabicPage(p) ? !p.lang.startsWith("ar") : null;
    },
    ar: {
      title: "لغة الصفحة غير محددة كعربية",
      why: "سمة lang=\"ar\" تخبر جوجل أن الصفحة عربية فيعرضها للباحثين بالعربية في السعودية.",
      fix: "أضف lang=\"ar\" (أو ar-SA) إلى وسم <html> في الصفحات العربية، و lang=\"en\" في الصفحات الإنجليزية.",
    },
    en: {
      title: "Page language not declared as Arabic",
      why: "lang=\"ar\" tells Google the page is Arabic so it is shown to Arabic searchers in Saudi Arabia.",
      fix: "Add lang=\"ar\" (or ar-SA) to the <html> tag of Arabic pages and lang=\"en\" on English pages.",
    },
    snippet: () => `<html lang="ar" dir="rtl">`,
  },
  {
    id: "dir_rtl",
    category: "saudi",
    severity: "important",
    scope: "page",
    page: (p) => (p.isHtml && p.status === 200 && isArabicPage(p) ? p.dir !== "rtl" : null),
    ar: {
      title: "اتجاه الصفحة ليس من اليمين لليسار",
      why: "بدون dir=\"rtl\" تظهر النصوص العربية وعلامات الترقيم بشكل مكسور، فيغادر الزائر بسرعة.",
      fix: "أضف dir=\"rtl\" إلى وسم <html> في الصفحات العربية.",
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
    page: (p) => (p.isHtml && p.status === 200 && isArabicPage(p) && p.title ? !hasArabic(p.title) : null),
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
    site: (s) => {
      const h = s.home.hreflangs;
      if (h.length === 0) return s.home.linksToEnglishVersion ? true : null;
      return !h.some((x) => x.lang.startsWith("ar")) || !h.some((x) => x.lang === "x-default" || x.lang.startsWith("en"));
    },
    ar: {
      title: "ربط النسختين العربية والإنجليزية (hreflang) ناقص",
      why: "إذا كان لموقعك نسختان، فوسوم hreflang تضمن ظهور النسخة العربية للباحث العربي والإنجليزية للباحث الإنجليزي.",
      fix: "أضف في <head> كل صفحة وسوم hreflang تشير للنسختين ولنسخة افتراضية x-default.",
    },
    en: {
      title: "Arabic/English versions not linked (hreflang)",
      why: "If your site has two languages, hreflang makes Google show the Arabic version to Arabic searchers and English to English searchers.",
      fix: "Add hreflang links to both versions plus an x-default in each page's <head>.",
    },
    snippet: ({ origin }) => `<link rel="alternate" hreflang="ar-SA" href="${origin}/" />\n<link rel="alternate" hreflang="en" href="${origin}/en/" />\n<link rel="alternate" hreflang="x-default" href="${origin}/" />`,
  },
  {
    id: "local_schema",
    category: "saudi",
    severity: "important",
    scope: "site",
    site: (s) => (s.home.isHtml ? !hasSaudiLocalSchema(s.home.jsonLd) : null),
    ar: {
      title: "بيانات النشاط المحلي في السعودية غير موجودة",
      why: "بيانات LocalBusiness مع عنوان سعودي ورقم +966 تساعدك على الظهور في نتائج \"قريب مني\" وخرائط جوجل.",
      fix: "أضف كود LocalBusiness أو Organization بعنوانك في المملكة ورقم جوالك بصيغة +966، وأنشئ ملفاً تجارياً في Google Business Profile.",
    },
    en: {
      title: "No Saudi local business data",
      why: "LocalBusiness data with a Saudi address and +966 phone helps you appear in \"near me\" results and Google Maps.",
      fix: "Add LocalBusiness or Organization JSON-LD with your KSA address and +966 phone, and claim your Google Business Profile.",
    },
    snippet: ({ origin }) => `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "متجر ريحان",
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
    page: (p) => {
      if (!p.isHtml || p.status !== 200) return null;
      const u = new URL(p.url);
      const decodedLen = decodeURIComponent(u.pathname + u.search).length;
      return decodedLen > 100 || [...u.searchParams.keys()].length > 2 || /\/\d{6,}(\/|$)/.test(u.pathname);
    },
    ar: {
      title: "روابط صفحات طويلة أو غير مقروءة",
      why: "الروابط القصيرة الواضحة تُفهم أسرع من جوجل والزائر، وتُشارك بسهولة.",
      fix: "استخدم روابط قصيرة تصف المحتوى مثل /عطور-عود أو /oud-perfume بدلاً من أرقام ومعاملات طويلة.",
    },
    en: {
      title: "Long or unreadable URLs",
      why: "Short descriptive URLs are understood faster by Google and visitors and are easier to share.",
      fix: "Use short descriptive slugs like /oud-perfume instead of long numbers and parameters.",
    },
  },
];

export const CHECK_BY_ID: Record<string, CheckDef> = Object.fromEntries(CHECKS.map((c) => [c.id, c]));

export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 12, important: 6, minor: 2 };
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, important: 1, minor: 2 };

/** Short neutral names, used for the "passed checks" list. */
export const CHECK_NAMES: Record<string, { ar: string; en: string }> = {
  https: { ar: "اتصال آمن HTTPS", en: "HTTPS" },
  http_redirect: { ar: "تحويل http إلى https", en: "HTTP to HTTPS redirect" },
  status_ok: { ar: "الصفحات تعمل بدون أخطاء", en: "Pages load without errors" },
  response_time: { ar: "سرعة استجابة الخادم", en: "Server response time" },
  page_weight: { ar: "حجم الصفحات", en: "Page weight" },
  robots: { ar: "ملف robots.txt", en: "robots.txt" },
  sitemap: { ar: "خريطة الموقع", en: "Sitemap" },
  canonical: { ar: "وسم canonical", en: "Canonical tag" },
  noindex: { ar: "الصفحات قابلة للفهرسة", en: "Pages are indexable" },
  title: { ar: "عنوان الصفحة", en: "Page title" },
  meta_description: { ar: "الوصف التعريفي", en: "Meta description" },
  h1: { ar: "العنوان الرئيسي H1", en: "H1 heading" },
  heading_order: { ar: "تسلسل العناوين", en: "Heading order" },
  img_alt: { ar: "النص البديل للصور", en: "Image alt text" },
  thin_content: { ar: "كمية المحتوى", en: "Content length" },
  internal_links: { ar: "الروابط الداخلية", en: "Internal links" },
  open_graph: { ar: "وسوم المشاركة", en: "Open Graph tags" },
  structured_data: { ar: "البيانات المنظمة", en: "Structured data" },
  viewport: { ar: "التوافق مع الجوال", en: "Mobile viewport" },
  favicon: { ar: "أيقونة الموقع", en: "Favicon" },
  lang_ar: { ar: "لغة الصفحة", en: "Page language" },
  dir_rtl: { ar: "اتجاه النص RTL", en: "Right-to-left direction" },
  arabic_meta: { ar: "عنوان باللغة العربية", en: "Arabic title" },
  hreflang: { ar: "ربط النسخ اللغوية", en: "Language versions (hreflang)" },
  local_schema: { ar: "بيانات النشاط المحلي السعودي", en: "Saudi local business data" },
  readable_urls: { ar: "روابط واضحة", en: "Readable URLs" },
};

// Local fixture websites + a fake Moyasar API, used by test/e2e.mjs.
import http from "node:http";

const goodHome = `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>عطور عود فاخرة في الرياض | متجر ريحان</title>
<meta name="description" content="تشكيلة عطور عود أصلية بأسعار منافسة، توصيل خلال 24 ساعة داخل الرياض وشحن لكل مدن المملكة.">
<link rel="canonical" href="/"><link rel="icon" href="/favicon.png">
<meta property="og:title" content="متجر ريحان"><meta property="og:image" content="/og.jpg">
<link rel="alternate" hreflang="ar-SA" href="/"><link rel="alternate" hreflang="en" href="/en/"><link rel="alternate" hreflang="x-default" href="/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"متجر ريحان","telephone":"+966500000000","address":{"@type":"PostalAddress","addressLocality":"الرياض","addressCountry":"SA"}}</script>
</head><body><h1>عطور عود فاخرة</h1><h2>الأكثر مبيعاً</h2>
<p>${"نقدم في متجر ريحان أجود أنواع العود والعطور الشرقية المختارة بعناية من أفضل المصادر ونوصلها لباب بيتك بسرعة. ".repeat(20)}</p>
<img src="a.jpg" alt="عطر عود ملكي"><a href="/products">المنتجات</a><a href="/about">من نحن</a><a href="/contact">تواصل</a><a href="/missing">قديم</a>
</body></html>`;

const goodInner = (title) => goodHome.replace(/<title>.*?<\/title>/, `<title>${title} | متجر ريحان</title>`).replace('<link rel="canonical" href="/">', `<link rel="canonical" href="/x">`);

const badHome = `<html><head><title>Home</title><meta name="robots" content="noindex"></head>
<body><h1>Welcome</h1><h1>Shop</h1><h3>Offers</h3><p>مرحبا بكم في متجرنا للعطور والبخور الفاخر</p><img src="x.png"><a href="/p?id=1&cat=2&ref=3">x</a></body></html>`;

function site(port, routes) {
  return http
    .createServer((req, res) => {
      const path = req.url.split("?")[0];
      const r = routes[path];
      if (!r) {
        res.writeHead(404, { "content-type": "text/html" });
        return res.end("<html><body>not found</body></html>");
      }
      res.writeHead(200, { "content-type": r.type || "text/html; charset=utf-8" });
      res.end(r.body);
    })
    .listen(port, "127.0.0.1");
}

site(4011, {
  "/": { body: goodHome },
  "/products": { body: goodInner("منتجاتنا من العود") },
  "/about": { body: goodInner("من نحن وقصتنا") },
  "/contact": { body: goodInner("تواصل معنا الآن") },
  "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\nSitemap: http://127.0.0.1:4011/sitemap.xml\n" },
  "/sitemap.xml": { type: "application/xml", body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>/</loc></url></urlset>' },
});

site(4012, {
  "/": { body: badHome },
  "/p": { body: badHome },
  "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" },
});

// Fake Moyasar API
http
  .createServer((req, res) => {
    const m = req.url.match(/^\/v1\/payments\/([\w-]+)$/);
    const auth = req.headers.authorization || "";
    if (!m || auth !== "Basic " + Buffer.from("sk_test_fake:").toString("base64")) {
      res.writeHead(404);
      return res.end("{}");
    }
    const id = m[1];
    const [, userId, plan, period, amount, status] = id.split("-"); // pay-<user>-<plan>-<period>-<amount>-<status>
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id, status, amount: Number(amount), currency: "SAR", metadata: { user_id: userId, plan, period } }));
  })
  .listen(4013, "127.0.0.1");

console.log("fixtures up on 4011 (good), 4012 (bad), 4013 (moyasar)");

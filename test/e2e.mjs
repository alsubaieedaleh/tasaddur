// End-to-end test against local fixture sites and a fake Moyasar API.
// 1) node test/fixtures.mjs
// 2) start the app on a FRESH database with:
//    ALLOW_PRIVATE_HOSTS=1 MOYASAR_API_URL=http://127.0.0.1:4013/v1 MOYASAR_SECRET_KEY=sk_test_fake
//    MOYASAR_PUBLISHABLE_KEY=pk_test_fake CRON_SECRET=s3cret DATABASE_PATH=/tmp/tasaddur-e2e.db npx next start -p 3100
// 3) BASE=http://localhost:3100 SHOTS=./shots node test/e2e.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://localhost:3100";
const SHOTS = process.env.SHOTS;
const UID = Number(process.env.E2E_USER_ID || 1); // first user on a fresh database
const step = (m) => console.log("✓", m);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const shot = async (name, p = page) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const submitAudit = async (domain, p = page) => {
  await p.fill('input[name="domain"]', domain);
  await p.click('form.audit-form button[type="submit"]');
};
/** Audits run in the background: wait for the report page, then for the poller to show the result. */
const waitForReport = async (p = page, timeout = 90000) => {
  await p.waitForURL(/\/audit\//, { timeout });
  await p.waitForSelector(".ring:not(.spinning)", { timeout });
  const txt = await p.$eval(".ring", (el) => el.textContent || "");
  return Number((txt.match(/\d+/) || ["0"])[0]);
};

// 1. Home is Arabic RTL, has our own SEO basics
await page.goto(BASE);
assert.equal(await page.getAttribute("html", "dir"), "rtl");
assert.match(await page.textContent("h1"), /فحص سيو/);
assert.match(await page.title(), /سلة وزد/);
assert.ok(await page.$('script[type="application/ld+json"]'), "JSON-LD present");
assert.ok(await page.$('label[for]'), "audit input has a label");
await shot("01-home-ar");
let r = await page.request.get(`${BASE}/robots.txt`);
assert.match(await r.text(), /Disallow: \/dashboard/);
r = await page.request.get(`${BASE}/sitemap.xml`);
assert.match(await r.text(), /\/pricing/);
step("home renders in Arabic RTL with title, JSON-LD, label, robots.txt and sitemap");

// 2. Invalid domain
await submitAudit("not a domain");
await page.waitForSelector(".error");
step("invalid domain rejected");

// 3. Bot-protected site: clear message, not counted against the daily free audit
await submitAudit("127.0.0.1:4014");
await page.waitForURL(/\/audit\//, { timeout: 60000 });
await page.waitForSelector(".error", { timeout: 60000 });
assert.match(await page.textContent(".error"), /Cloudflare/);
assert.equal(await page.$(".ring"), null, "no 0/100 score shown for a site we couldn't audit");
step("bot-protected site shows a clear message");

// 4. Anonymous audit of the bad site (async, with running state)
await page.goto(BASE);
await submitAudit("http://127.0.0.1:4012/");
const badScore = await waitForReport();
const badUrl = page.url();
assert.ok(badScore <= 25, `blocked + noindex site must be capped at 25, got ${badScore}`);
const body = await page.textContent("main");
for (const s of ["ممنوعة من الظهور", "robots.txt", "غير مهيأ للجوال", "اتجاه الصفحة"]) assert.ok(body.includes(s), `missing issue: ${s}`);
assert.ok((await page.$$(".locked")).length > 0, "fixes beyond top 3 should be locked for free");
assert.ok(await page.$(".upsell"), "inline upsell shown");
assert.match(await page.textContent(".upsell"), /احفظ تقريري مجاناً/);
assert.ok(await page.$(".sev-title.critical"), "issues grouped by severity");
await shot("02-report-bad-anon");
step(`anonymous audit works, bad site capped at ${badScore}, fixes locked after top 3, save-report CTA`);

// 5. Anonymous daily limit (per browser cookie; the bot-protected attempt didn't count)
await page.goto(BASE);
await submitAudit("127.0.0.1:4011");
await page.waitForSelector(".error");
assert.match(await page.textContent(".error"), /سجّل مجاناً/);
assert.ok(await page.$('.form-error a[href^="/signup?next="]'), "signup button carries next");
step("anonymous limit enforced (1/day per browser) with a signup button");

// 6. Signup claims the anonymous audit (by cookie)
await page.goto(`${BASE}/signup`);
await page.fill("#email", `user${Date.now()}@example.com`);
await page.fill("#password", "password123");
await page.click('button[type="submit"]');
await page.waitForURL(/\/dashboard/);
assert.ok((await page.textContent(".domain-list")).includes("127.0.0.1:4012"), "anonymous audit should be claimed");
step("signup works and claims the anonymous report");

// 7. Free plan: domain limit (1 site), with change-domain button
await submitAudit("127.0.0.1:4011");
await page.waitForSelector(".error");
assert.match(await page.textContent(".error"), /الأقصى من المواقع/);
assert.ok(await page.$('.form-error a[href="/dashboard#domains"]'));
step("free plan domain limit enforced, change-domain offered");

// 8. Change domain: remove works once, then cooldown
await page.click('.domain-list form button[type="submit"]');
await page.waitForURL(/removed=removed/);
await submitAudit("127.0.0.1:4011");
const freeScore = await waitForReport();
assert.ok(await page.$("text=فحصنا صفحتك الرئيسية فقط"), "homepage-only note for free");
await page.goto(`${BASE}/dashboard`);
await page.click('.domain-list form button[type="submit"]');
await page.waitForURL(/removed=cooldown/);
assert.match(await page.textContent(".error"), /7 أيام/);
step(`domain swap works (new site scored ${freeScore}), second swap blocked by 7-day cooldown`);

// 9. Payment verification
const cb = (id) => page.request.get(`${BASE}/api/payments/callback?id=${id}`, { maxRedirects: 0 });
r = await cb(`pay-999999-pro-monthly-7900-paid`);
assert.match(r.headers().location, /paid=0/, "unknown user must not activate");
r = await cb(`pay-${UID}-pro-monthly-100-paid`);
assert.match(r.headers().location, /paid=0/, "wrong amount must not activate");
r = await cb(`pay-${UID}-pro-monthly-7900-failed`);
assert.match(r.headers().location, /paid=0/, "failed payment must not activate");
r = await cb(`pay-${UID}-business-weekly-2900-paid`);
assert.match(r.headers().location, /paid=0/, "business has no weekly pass");
await page.goto(`${BASE}/api/payments/callback?id=pay-${UID}-pro-weekly-2900-paid`);
await page.waitForURL(/paid=1/);
assert.match(await page.textContent(".notice"), /تم تفعيل خطة احترافي/);
assert.ok(await page.$(".onboarding a.btn"), "paid onboarding offers a full audit");
r = await cb(`pay-${UID}-pro-weekly-2900-paid`);
assert.match(r.headers().location, /paid=1/, "replay is idempotent");
await cb(`pay-${UID}-pro-monthly-7900-paid`);
await page.goto(`${BASE}/dashboard`);
assert.match(await page.textContent(".dash-top"), /احترافي/);
await shot("03-dashboard-pro");
step("payments: bad ones rejected, 29 SAR weekly pass activates Pro, replay idempotent, monthly stacks on top");

// 10. Pro: multi-page audit of the good site, all fixes unlocked, "what changed"
await page.click(".onboarding a.btn").catch(() => {});
await page.goto(`${BASE}/dashboard?rerun=127.0.0.1:4011`);
await page.click('form.audit-form button[type="submit"]');
const goodScore = await waitForReport();
// The fixture is served over plain http, so the no-HTTPS cap (60) applies.
assert.equal(goodScore, 60, `good http site should hit the 60 cap, got ${goodScore}`);
assert.match(await page.textContent("details.tech"), /5 صفحات/, "should crawl 5 pages (home, 3 inner, 1 broken)");
assert.equal((await page.$$(".locked")).length, 0, "pro sees all fixes");
assert.ok((await page.textContent("main")).includes("صفحات لا تعمل"), "broken /missing link detected");
assert.ok(await page.$(".changed"), "what changed since the previous audit");
await shot("04-report-good-pro");
step(`pro audit crawled 5 pages, good site scored ${goodScore}, broken link found, nothing locked, diff shown`);

// 11. Earlier report is now unlocked for the Pro owner
await page.goto(badUrl);
assert.equal((await page.$$(".locked")).length, 0);
step("pro owner sees all fixes on earlier report");

// 12. English toggle
await page.click("a.lang");
await page.waitForLoadState("networkidle");
assert.equal(await page.getAttribute("html", "dir"), "ltr");
assert.ok((await page.textContent("main")).includes("Why it matters"));
await shot("05-report-en");
await page.click("a.lang");
await page.waitForLoadState("networkidle");
assert.equal(await page.getAttribute("html", "dir"), "rtl");
step("language toggle AR <-> EN keeps the page");

// 13. Checkout and pricing
await page.goto(`${BASE}/checkout?plan=business&period=yearly`);
assert.match(await page.textContent("main"), /1,990/);
await page.goto(`${BASE}/checkout?plan=business&period=weekly`);
assert.match(page.url(), /\/pricing/);
await page.goto(`${BASE}/pricing`);
assert.match(await page.textContent("main"), /الأكثر طلباً/);
assert.match(await page.textContent("main"), /29 ريال/);
step("checkout shows Business yearly 1,990 SAR; invalid weekly redirects; pricing shows badge and 29 SAR pass");

// 14. Cron auth
r = await page.request.get(`${BASE}/api/cron/weekly`);
assert.equal(r.status(), 401);
r = await page.request.get(`${BASE}/api/cron/weekly`, { headers: { authorization: "Bearer s3cret" } });
assert.equal(r.status(), 200);
step(`cron endpoint protected; run result ${JSON.stringify(await r.json())}`);

// 15. Open redirect blocked
r = await page.request.get(`${BASE}/api/lang?to=en`, { maxRedirects: 0, headers: { referer: "https://evil.example/x" } });
assert.ok(!/evil/.test(r.headers().location || ""), "lang switch must not redirect off-site");
step("language switch ignores foreign referers");

// 16. Mobile
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await mobile.newPage();
await mp.goto(BASE);
assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "no horizontal scroll on mobile");
assert.ok(await mp.isVisible("details.menu summary"), "mobile menu visible");
await shot("06-home-mobile", mp);
await mp.goto(badUrl);
assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "no horizontal scroll on report");
await shot("07-report-mobile", mp);
await mp.goto(`${BASE}/pricing`);
assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "no horizontal scroll on pricing");
await shot("08-pricing-mobile", mp);
step("mobile layout has no horizontal scroll, menu available");

await browser.close();
console.log("\nAll e2e checks passed");

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
const submitAudit = async (domain) => {
  await page.fill('input[name="domain"]', domain);
  await page.click('form.audit-form button[type="submit"]');
};

// 1. Home is Arabic RTL
await page.goto(BASE);
assert.equal(await page.getAttribute("html", "dir"), "rtl");
assert.match(await page.textContent("h1"), /تصدّر/);
await shot("01-home-ar");
step("home renders in Arabic RTL");

// 2. Invalid domain
await submitAudit("not a domain");
await page.waitForSelector(".error");
step("invalid domain rejected");

// 3. Anonymous audit of the bad site
await submitAudit("http://127.0.0.1:4012/");
await page.waitForURL(/\/audit\//, { timeout: 60000 });
const badUrl = page.url();
const badScore = Number(await page.textContent(".ring strong"));
assert.ok(badScore < 50, `bad site score should be low, got ${badScore}`);
const body = await page.textContent("main");
for (const s of ["ممنوعة من الظهور", "robots.txt", "غير مهيأ للجوال", "اتجاه الصفحة", "العنوان الرئيسي H1"]) assert.ok(body.includes(s), `missing issue: ${s}`);
assert.ok((await page.$$(".locked")).length > 0, "fixes beyond top 3 should be locked for free");
await shot("02-report-bad-anon");
step(`anonymous audit works, bad site scored ${badScore}, fixes locked after top 3`);

// 4. Anonymous daily limit
await page.goto(BASE);
await submitAudit("127.0.0.1:4011");
await page.waitForSelector(".error");
assert.match(await page.textContent(".error"), /أنشئ حساباً/);
step("anonymous limit enforced (1/day)");

// 5. Signup claims the anonymous audit
await page.goto(`${BASE}/signup`);
await page.fill("#email", `user${Date.now()}@example.com`);
await page.fill("#password", "password123");
await page.click('button[type="submit"]');
await page.waitForURL(/\/dashboard/);
assert.ok((await page.textContent("table")).includes("127.0.0.1:4012"), "anonymous audit should be claimed");
step("signup works and claims the anonymous report");

// 6. Free plan: domain limit (1 site)
await submitAudit("127.0.0.1:4011");
await page.waitForSelector(".error");
assert.match(await page.textContent(".error"), /الأقصى من المواقع/);
step("free plan domain limit enforced");

// 7. Payment verification
const cb = (id) => page.request.get(`${BASE}/api/payments/callback?id=${id}`, { maxRedirects: 0 });
let r = await cb(`pay-999999-pro-monthly-7900-paid`);
assert.match(r.headers().location, /paid=0/, "unknown user must not activate");
r = await cb(`pay-${UID}-pro-monthly-100-paid`);
assert.match(r.headers().location, /paid=0/, "wrong amount must not activate");
r = await cb(`pay-${UID}-pro-monthly-7900-failed`);
assert.match(r.headers().location, /paid=0/, "failed payment must not activate");
await page.goto(`${BASE}/api/payments/callback?id=pay-${UID}-pro-monthly-7900-paid`);
await page.waitForURL(/paid=1/);
assert.match(await page.textContent(".notice"), /تم الدفع/);
assert.match(await page.textContent(".dash-top"), /احترافي/);
r = await cb(`pay-${UID}-pro-monthly-7900-paid`);
assert.match(r.headers().location, /paid=1/, "replay is idempotent");
await shot("03-dashboard-pro");
step("payments: wrong amount / failed / unknown user rejected, valid one activates Pro, replay idempotent");

// 8. Pro: multi-page audit of the good site, all fixes unlocked
await submitAudit("127.0.0.1:4011");
await page.waitForURL(/\/audit\//, { timeout: 90000 });
const goodScore = Number(await page.textContent(".ring strong"));
assert.ok(goodScore >= 75, `good site should score high, got ${goodScore}`);
assert.match(await page.textContent(".meta"), /5 صفحة/, "should crawl 5 pages (home, 3 inner, 1 broken)");
assert.equal((await page.$$(".locked")).length, 0, "pro sees all fixes");
assert.ok((await page.textContent("main")).includes("صفحات لا تعمل"), "broken /missing link detected");
await shot("04-report-good-pro");
step(`pro audit crawled 5 pages, good site scored ${goodScore}, broken link found, nothing locked`);

// 9. Earlier report is now unlocked for the Pro owner
await page.goto(badUrl);
assert.equal((await page.$$(".locked")).length, 0);
step("pro owner sees all fixes on earlier report");

// 10. English toggle
await page.click("a.lang");
await page.waitForLoadState("networkidle");
assert.equal(await page.getAttribute("html", "dir"), "ltr");
assert.ok((await page.textContent("main")).includes("Why it matters"));
await shot("05-report-en");
await page.click("a.lang");
await page.waitForLoadState("networkidle");
assert.equal(await page.getAttribute("html", "dir"), "rtl");
step("language toggle AR <-> EN keeps the page");

// 11. Checkout page
await page.goto(`${BASE}/checkout?plan=business&period=yearly`);
assert.match(await page.textContent("main"), /1,990/);
step("checkout shows Business yearly at 1,990 SAR");

// 12. Cron auth
r = await page.request.get(`${BASE}/api/cron/weekly`);
assert.equal(r.status(), 401);
r = await page.request.get(`${BASE}/api/cron/weekly`, { headers: { authorization: "Bearer s3cret" } });
assert.equal(r.status(), 200);
step(`cron endpoint protected; run result ${JSON.stringify(await r.json())}`);

// 13. Mobile
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await mobile.newPage();
await mp.goto(BASE);
assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "no horizontal scroll on mobile");
await shot("06-home-mobile", mp);
await mp.goto(badUrl);
assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "no horizontal scroll on report");
await shot("07-report-mobile", mp);
await mp.goto(`${BASE}/pricing`);
await shot("08-pricing-mobile", mp);
step("mobile layout has no horizontal scroll");

await browser.close();
console.log("\nAll e2e checks passed");

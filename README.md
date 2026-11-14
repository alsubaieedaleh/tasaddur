# Tasaddur (تصدّر)

Arabic-first SEO audit SaaS for Saudi businesses. Type a domain, get a 0–100 score and a prioritized list of fixes in Arabic (or English) with copy-paste code.

The product decisions (features, SAR pricing, free tier, acquisition) are in the PRD.

## What's in the app

- **Audit engine** (`lib/audit/`): 36 checks across technical, content, mobile, and Arabic/Saudi groups. It detects Salla, Zid, Shopify and WordPress, gives platform-specific fix steps, and doesn't count settings the store platform controls. Scores are capped when the site can't be indexed (noindex home, robots block, broken home: max 25; no HTTPS: max 60). It crawls the homepage on Free and up to 100/500 pages on Pro/Business, seeding from the sitemap and respecting robots.txt. Outbound requests pin the resolved IP (no DNS rebinding), allow only ports 80/443, and are size and time limited. Bot-protection pages (Cloudflare challenges) are reported clearly and not counted.
- **Audits run in the background**: the report page shows progress and refreshes itself. At most `MAX_CONCURRENT_AUDITS` run at once.
- **Plans** (`lib/plans.ts`): Free, Pro 79 SAR/mo (790/yr, or a 29 SAR one-week pass), Business 199 SAR/mo (1,990/yr), VAT-inclusive. Anonymous visitors get 1 audit per browser per day; signing up claims that report. Free accounts can swap their one site once every 7 days.
- **Payments** (`lib/billing.ts`): Moyasar hosted form. The callback and the webhook both re-fetch the payment from Moyasar with the secret key, check status, SAR currency, the exact amount, and the user, and apply it once per payment id. Unused days of a current plan are credited when upgrading or switching. Receipts show VAT.
- **Monitoring** (`app/api/cron/weekly`): paid sites are re-audited weekly and free sites monthly, with an email digest (score, change, top issue), plus renewal reminders 7 days and 1 day before expiry and on expiry.
- **UI**: Arabic RTL by default with an English toggle, mobile menu, light/dark themes, WhatsApp/X sharing, "what changed" since the last audit, print-to-PDF (agency name on Business).
- **Security**: async scrypt passwords, login/signup rate limits, session rotation, open-redirect-safe `next` handling, client IP from `X-Forwarded-For` limited to `TRUSTED_PROXY_HOPS`.
- **Storage**: SQLite via Node's built-in `node:sqlite` with versioned migrations.

## Run it

```bash
cp .env.example .env.local   # add your Moyasar keys
npm install
npm run dev                  # http://localhost:3000
```

Requires Node 22.13+.

Production: `npm run build && npm start` behind HTTPS. Keep `DATABASE_PATH` on a persistent volume, and set up a daily cron job:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/weekly
```

### Moyasar setup

1. Create an account at dashboard.moyasar.com and copy the test keys into `.env.local`.
2. Set `APP_URL` to your public URL. The callback is `APP_URL/api/payments/callback`.
3. Add a webhook to `APP_URL/api/payments/webhook` for paid payments, and put its secret token in `MOYASAR_WEBHOOK_SECRET`. This activates plans even if the customer closes the tab before the redirect.
4. For Apple Pay, verify your domain in the Moyasar dashboard.

## Tests

The end-to-end test runs against local fixture sites and a fake Moyasar API. It covers our own SEO basics, a bot-protected site, the async anonymous audit, per-browser limits, signup claiming, domain swap and cooldown, payment verification (tampered amount, failed payment, replay, the 29 SAR weekly pass), a Pro multi-page crawl with "what changed", the language toggle, open-redirect protection, cron auth, and the mobile layout.

```bash
node test/fixtures.mjs &
ALLOW_PRIVATE_HOSTS=1 MOYASAR_API_URL=http://127.0.0.1:4013/v1 MOYASAR_SECRET_KEY=sk_test_fake \
  MOYASAR_PUBLISHABLE_KEY=pk_test_fake CRON_SECRET=s3cret DATABASE_PATH=/tmp/tasaddur-e2e.db \
  npm run build && npx next start -p 3100 &
BASE=http://localhost:3100 node test/e2e.mjs
```

## Known gaps

- Auto-renewing subscriptions (Moyasar tokenization) and ZATCA e-invoices.
- Salla and Zid app store listings.
- Password reset by email.
- The Salla/Zid dashboard menu paths in the platform-specific fixes should be checked against the current dashboards.
- On Render's free plan the disk is not persistent: add a disk (paid) or move to Postgres before taking real customers.

# Tasaddur (تصدّر)

Arabic-first SEO audit SaaS for Saudi businesses. Type a domain, get a 0–100 score and a prioritized list of fixes in Arabic (or English) with copy-paste code.

The product decisions (features, SAR pricing, free tier, acquisition) are in the PRD.

## What's in the MVP

- **Audit engine** (`lib/audit/`): 26 checks across technical, content, mobile, and Arabic/Saudi groups (lang/dir, Arabic titles, hreflang, LocalBusiness schema with a Saudi address and +966 phone). It crawls the homepage on Free and up to 100/500 internal pages on Pro/Business. Outbound requests are SSRF-guarded (private IPs blocked on every redirect hop) and size/time limited.
- **Plans** (`lib/plans.ts`): Free 0, Pro 79 SAR/mo (790/yr), Business 199 SAR/mo (1,990/yr), prices VAT-inclusive. Limits on domains, pages per audit, audits per day, and how many fixes are unlocked. Anonymous visitors get 1 audit per day; signing up claims that report.
- **Payments** (`lib/billing.ts`): Moyasar hosted form (Mada, Visa, Mastercard, Apple Pay, STC Pay). The callback never trusts the query string: it fetches the payment from Moyasar with the secret key, checks status, SAR currency, the exact amount for the plan and period, and the user, and is idempotent per payment id. A payment buys 30 or 365 days; there is no auto-renew yet (that's v1.1).
- **Monitoring** (`app/api/cron/weekly`): re-audits paid domains weekly, emails when a score drops 5+ points, and sends renewal reminders (Resend, or logs when no key is set).
- **UI**: Arabic RTL by default with a one-tap English toggle, responsive layout, light/dark themes, share to X/WhatsApp, and a print-to-PDF report (unbranded on Business).
- **Storage**: SQLite via Node's built-in `node:sqlite`, so there are no native dependencies.

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
3. For Apple Pay, verify your domain in the Moyasar dashboard.

## Tests

The end-to-end test runs against local fixture sites and a fake Moyasar API. It covers anonymous audit, limits, signup, payment verification (tampered amount, failed payment, replay), a Pro multi-page crawl, the language toggle, cron auth, and the mobile layout.

```bash
node test/fixtures.mjs &
ALLOW_PRIVATE_HOSTS=1 MOYASAR_API_URL=http://127.0.0.1:4013/v1 MOYASAR_SECRET_KEY=sk_test_fake \
  MOYASAR_PUBLISHABLE_KEY=pk_test_fake CRON_SECRET=s3cret DATABASE_PATH=/tmp/tasaddur-e2e.db \
  npm run build && npx next start -p 3100 &
BASE=http://localhost:3100 node test/e2e.mjs
```

## Known gaps (v1.1 per PRD)

- Auto-renewing subscriptions (Moyasar tokenization) and ZATCA e-invoices.
- Salla and Zid app store listings.
- Login rate limiting and password reset by email.
- The DNS check happens before connecting, so a DNS-rebinding attack is still possible. Pin the resolved IP if you deploy somewhere sensitive.

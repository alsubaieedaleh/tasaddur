import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getT } from "@/lib/i18n";
import { getUser } from "@/lib/auth";
import { appUrl } from "@/lib/request";
import { PLANS } from "@/lib/plans";
import { logoutAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t, lang } = await getT();
  return {
    metadataBase: new URL(appUrl()),
    title: { default: t.metaTitle, template: `%s | ${t.brand}` },
    description: t.tagline,
    openGraph: {
      title: t.metaTitle,
      description: t.tagline,
      siteName: t.brand,
      locale: lang === "ar" ? "ar_SA" : "en_US",
      type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: t.brand }],
    },
    twitter: { card: "summary_large_image", title: t.metaTitle, description: t.tagline, images: ["/og.png"] },
    icons: { icon: "/icon.svg" },
  };
}

function jsonLd(lang: string, description: string) {
  const url = appUrl();
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${url}/#org`, name: "Tasaddur", alternateName: "تصدّر", url, logo: `${url}/icon.svg`, areaServed: "SA" },
      { "@type": "WebSite", "@id": `${url}/#website`, url, name: "تصدّر", inLanguage: lang === "ar" ? "ar-SA" : "en", publisher: { "@id": `${url}/#org` } },
      {
        "@type": "SoftwareApplication",
        name: "تصدّر",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url,
        description,
        offers: [
          { "@type": "Offer", name: "Free", price: "0", priceCurrency: "SAR" },
          { "@type": "Offer", name: "Pro", price: String(PLANS.pro.monthly), priceCurrency: "SAR" },
          { "@type": "Offer", name: "Business", price: String(PLANS.business.monthly), priceCurrency: "SAR" },
        ],
      },
    ],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { t, lang } = await getT();
  const user = await getUser();
  const other = lang === "ar" ? "en" : "ar";
  const supportEmail = process.env.SUPPORT_EMAIL;
  const supportWhatsapp = process.env.SUPPORT_WHATSAPP?.replace(/\D/g, "");
  return (
    <html lang={lang === "ar" ? "ar" : "en"} dir={lang === "ar" ? "rtl" : "ltr"}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(lang, t.tagline)).replace(/</g, "\\u003c") }} />
      </head>
      <body>
        <a href="#main" className="skip">
          {lang === "ar" ? "تخطَّ إلى المحتوى" : "Skip to content"}
        </a>
        <header className="header">
          <div className="container">
            <Link href="/" className="logo">
              <span className="logo-mark" aria-hidden>
                ↑
              </span>
              {t.brand}
            </Link>
            <nav className="nav" aria-label={t.menu}>
              <Link href="/pricing" className="hide-sm">
                {t.pricing}
              </Link>
              {user ? (
                <>
                  <Link href="/dashboard">{t.dashboard}</Link>
                  <form action={logoutAction} className="hide-sm">
                    <button className="linkbtn" type="submit">
                      {t.logout}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login" className="hide-sm">
                    {t.login}
                  </Link>
                  <Link href="/signup" className="btn small">
                    {t.signup}
                  </Link>
                </>
              )}
              <a className="lang hide-sm" href={`/api/lang?to=${other}`} lang={other} rel="nofollow">
                {t.switchLang}
              </a>
              <details className="menu show-sm">
                <summary aria-label={t.menu}>☰</summary>
                <div className="menu-panel">
                  <Link href="/pricing">{t.pricing}</Link>
                  {user ? (
                    <form action={logoutAction}>
                      <button className="linkbtn" type="submit">
                        {t.logout}
                      </button>
                    </form>
                  ) : (
                    <Link href="/login">{t.login}</Link>
                  )}
                  <a href={`/api/lang?to=${other}`} lang={other} rel="nofollow">
                    {t.switchLang}
                  </a>
                </div>
              </details>
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="container">
            <span>
              © {new Date().getFullYear()} {t.footer}
            </span>
            <nav aria-label="footer">
              <Link href="/pricing">{t.pricing}</Link>
              <Link href="/privacy">{t.privacy}</Link>
              <Link href="/terms">{t.terms}</Link>
              {supportWhatsapp ? (
                <a href={`https://wa.me/${supportWhatsapp}`} target="_blank" rel="noopener">
                  {t.contact}
                </a>
              ) : supportEmail ? (
                <a href={`mailto:${supportEmail}`}>{t.contact}</a>
              ) : null}
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}

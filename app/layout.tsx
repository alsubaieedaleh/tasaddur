import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getT } from "@/lib/i18n";
import { getUser } from "@/lib/auth";
import { logoutAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t, lang } = await getT();
  return {
    title: { default: `${t.brand} | ${lang === "ar" ? "فحص سيو مجاني للمواقع السعودية" : "Free SEO audit for Saudi websites"}`, template: `%s | ${t.brand}` },
    description: t.tagline,
    openGraph: { title: t.brand, description: t.tagline, locale: lang === "ar" ? "ar_SA" : "en_US", type: "website" },
    alternates: { languages: { "ar-SA": "/", en: "/" } },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { t, lang } = await getT();
  const user = await getUser();
  return (
    <html lang={lang === "ar" ? "ar" : "en"} dir={lang === "ar" ? "rtl" : "ltr"}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body>
        <header className="header">
          <div className="container">
            <Link href="/" className="logo">
              <span className="logo-mark" aria-hidden>↑</span>
              {t.brand}
            </Link>
            <nav className="nav">
              <Link href="/pricing" className="hide-sm">{t.pricing}</Link>
              {user ? (
                <>
                  <Link href="/dashboard">{t.dashboard}</Link>
                  <form action={logoutAction}>
                    <button className="linkbtn hide-sm" type="submit">{t.logout}</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login">{t.login}</Link>
                  <Link href="/signup" className="btn small">{t.signup}</Link>
                </>
              )}
              <a className="lang" href={`/api/lang?to=${lang === "ar" ? "en" : "ar"}`} lang={lang === "ar" ? "en" : "ar"}>
                {t.switchLang}
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <div className="container">
            <span>© {new Date().getFullYear()} {t.footer}</span>
            <nav>
              <Link href="/pricing">{t.pricing}</Link>
              <Link href="/privacy">{t.privacy}</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}

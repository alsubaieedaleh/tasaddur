"use client";

import Link from "next/link";

// Client error boundary: language cookie isn't readable here, so it shows both languages.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="section">
      <div className="container narrow center">
        <h1>حدث خطأ غير متوقع</h1>
        <p lang="en" dir="ltr">Something went wrong.</p>
        <p className="actions center">
          <button className="btn" type="button" onClick={reset}>
            حاول مجدداً
          </button>
          <Link className="btn secondary" href="/">
            العودة للرئيسية
          </Link>
        </p>
      </div>
    </section>
  );
}

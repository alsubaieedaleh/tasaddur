"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: "Tahoma, sans-serif", textAlign: "center", padding: 48 }}>
        <h1>حدث خطأ غير متوقع</h1>
        <p dir="ltr">Something went wrong.</p>
        <button type="button" onClick={reset} style={{ padding: "12px 24px", fontSize: 16 }}>
          حاول مجدداً
        </button>
      </body>
    </html>
  );
}

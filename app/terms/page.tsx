import type { Metadata } from "next";
import { getT } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t.terms, alternates: { canonical: "/terms" } };
}

export default async function TermsPage() {
  const { lang, t } = await getT();
  return (
    <section className="section">
      <div className="container narrow prose">
        <h1>{t.terms}</h1>
        {lang === "ar" ? (
          <>
            <h2>الاشتراك</h2>
            <p>تدفع مقدماً لأسبوع أو شهر أو سنة. لا يتجدد الاشتراك تلقائياً، ونرسل لك تذكيراً قبل انتهائه بـ 7 أيام ويوم واحد. عند الانتهاء تعود حسابك للخطة المجانية وتبقى تقاريرك محفوظة.</p>
            <h2>الاسترداد</h2>
            <p>إذا لم يفدك التقرير خلال 7 أيام من الدفع، راسلنا وسنعيد لك المبلغ كاملاً إلى وسيلة الدفع نفسها خلال 14 يوم عمل.</p>
            <h2>الترقية والتغيير</h2>
            <p>عند الترقية أو تغيير الخطة نحتسب الأيام المتبقية من اشتراكك الحالي ونضيفها لاشتراكك الجديد، فلا تخسر أي يوم مدفوع.</p>
            <h2>الاستخدام</h2>
            <p>افحص المواقع التي تملكها أو تعمل عليها فقط. نفحص الصفحات العامة كما يراها محرك البحث، ونلتزم بملف robots.txt.</p>
            <p>الأسعار بالريال السعودي شاملة ضريبة القيمة المضافة 15%.</p>
          </>
        ) : (
          <>
            <h2>Subscription</h2>
            <p>You pay upfront for a week, month or year. Plans never auto-renew; we remind you 7 days and 1 day before expiry. When a plan ends your account returns to Free and your reports stay saved.</p>
            <h2>Refunds</h2>
            <p>If the report didn&apos;t help you within 7 days of paying, contact us and we&apos;ll refund you in full to the same payment method within 14 business days.</p>
            <h2>Upgrades and changes</h2>
            <p>When you upgrade or change plans, the unused days of your current plan are credited to the new one, so you never lose paid time.</p>
            <h2>Acceptable use</h2>
            <p>Only audit sites you own or work on. We fetch public pages as a search engine sees them and respect robots.txt.</p>
            <p>Prices are in Saudi riyals and include 15% VAT.</p>
          </>
        )}
      </div>
    </section>
  );
}

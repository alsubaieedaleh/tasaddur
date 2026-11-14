import type { Metadata } from "next";
import { getT } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t.privacy, alternates: { canonical: "/privacy" } };
}

export default async function PrivacyPage() {
  const { lang, t } = await getT();
  return (
    <section className="section">
      <div className="container narrow">
        <h1>{t.privacy}</h1>
        {lang === "ar" ? (
          <>
            <p>نلتزم بنظام حماية البيانات الشخصية في المملكة العربية السعودية. نحتفظ فقط ببريدك الإلكتروني وكلمة مرور مشفرة والمواقع التي تفحصها ونتائج الفحص.</p>
            <p>لا نستخدم أدوات تتبع إعلانية، ولا نبيع بياناتك. تتم معالجة المدفوعات عبر ميسّر ولا نحتفظ ببيانات بطاقتك.</p>
            <p>تقاريرك خاصة ويمكن الوصول لها فقط عبر رابطها الفريد الذي تشاركه أنت. لحذف حسابك وبياناتك راسلنا وسنحذفها خلال 7 أيام.</p>
          </>
        ) : (
          <>
            <p>We follow Saudi Arabia&apos;s Personal Data Protection Law (PDPL). We store only your email, a hashed password, the websites you audit and the audit results.</p>
            <p>We use no advertising trackers and never sell your data. Payments are processed by Moyasar; we never store card details.</p>
            <p>Reports are private and reachable only through their unique link, which you choose to share. To delete your account and data, contact us and we&apos;ll remove it within 7 days.</p>
          </>
        )}
      </div>
    </section>
  );
}

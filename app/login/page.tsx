import Link from "next/link";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getT } from "@/lib/i18n";
import { getUser } from "@/lib/auth";
import { safeNext } from "@/lib/request";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { t } = await getT();
  const next = safeNext((await searchParams).next);
  if (await getUser()) redirect(next);
  return (
    <div className="container">
      <div className="auth card">
        <h1>{t.loginTitle}</h1>
        <AuthForm mode="login" next={next} labels={{ email: t.email, password: t.password, hint: t.passwordHint, submit: t.login }} />
        <p className="hint mt-16">
          {t.noAccount} <Link href={`/signup?next=${encodeURIComponent(next)}`}>{t.signup}</Link>
        </p>
      </div>
    </div>
  );
}

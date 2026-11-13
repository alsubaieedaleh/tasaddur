import Link from "next/link";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getT } from "@/lib/i18n";
import { getUser } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { t } = await getT();
  const { next } = await searchParams;
  if (await getUser()) redirect("/dashboard");
  return (
    <div className="container">
      <div className="auth card">
        <h1>{t.loginTitle}</h1>
        <AuthForm mode="login" next={next} labels={{ email: t.email, password: t.password, hint: t.passwordHint, submit: t.login }} />
        <p className="hint" style={{ marginTop: 16 }}>
          {t.noAccount} <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>{t.signup}</Link>
        </p>
      </div>
    </div>
  );
}

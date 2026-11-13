import Link from "next/link";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getT } from "@/lib/i18n";
import { getUser } from "@/lib/auth";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { t } = await getT();
  const { next } = await searchParams;
  if (await getUser()) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  return (
    <div className="container">
      <div className="auth card">
        <h1>{t.signupTitle}</h1>
        <p className="hint">{t.signupSub}</p>
        <AuthForm mode="signup" next={next} labels={{ email: t.email, password: t.password, hint: t.passwordHint, submit: t.signup }} />
        <p className="hint" style={{ marginTop: 16 }}>
          {t.haveAccount} <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>{t.login}</Link>
        </p>
      </div>
    </div>
  );
}

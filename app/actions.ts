"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb, track, type UserRow } from "@/lib/db";
import { createSession, destroySession, dummyVerify, getUser, hashPassword, isValidEmail, normalizeEmail, rateLimited, verifyPassword } from "@/lib/auth";
import { claimAnonymousAudits, removeDomain, startAudit as start } from "@/lib/audits";
import { normalizeDomain } from "@/lib/audit/fetcher";
import { clientIp, getAnonId, safeNext, appUrl } from "@/lib/request";
import { getT } from "@/lib/i18n";
import { sendEmail } from "@/lib/email";

export interface FormState {
  error?: string;
  /** Show signup / upgrade / change-domain buttons next to the error. */
  signup?: boolean;
  upgrade?: boolean;
  changeDomain?: boolean;
  /** Domain the user typed, to prefill the next step. */
  domain?: string;
}

export async function startAudit(_prev: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const host = normalizeDomain(String(form.get("domain") || ""));
  if (!host) return { error: t.errInvalidDomain };
  const user = await getUser();
  const anonId = user ? null : await getAnonId(true);
  const res = start({ user, anonId, ip: await clientIp() }, host);
  if ("error" in res) {
    if (res.error === "limit_anon") return { error: t.errLimitAnon, signup: true, domain: host };
    if (res.error === "limit_daily") return { error: t.errLimitDaily, upgrade: true };
    if (res.error === "limit_domains") return { error: t.errLimitDomains, upgrade: true, changeDomain: true };
    if (res.error === "in_progress") return { error: t.errInProgress };
    return { error: t.errInvalidDomain };
  }
  redirect(`/audit/${res.id}`);
}

export async function signupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const email = normalizeEmail(String(form.get("email") || ""));
  const password = String(form.get("password") || "");
  if (!isValidEmail(email)) return { error: t.errInvalidEmail };
  if (password.length < 8) return { error: t.errShortPassword };
  if (rateLimited(`signup:${await clientIp()}`, 10, 60 * 60_000)) return { error: t.errTooMany };
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return { error: t.errEmailTaken };
  const info = db.prepare("INSERT INTO users (email, pass_hash, created_at) VALUES (?, ?, ?)").run(email, await hashPassword(password), Date.now());
  const userId = Number(info.lastInsertRowid);
  const anonId = await getAnonId();
  claimAnonymousAudits(userId, anonId);
  track("signup", { userId, anonId });
  await createSession(userId);
  void sendEmail(
    email,
    "أهلاً بك في تصدّر",
    `<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:1.8"><p>أهلاً بك! حسابك المجاني جاهز.</p><p>سنعيد فحص موقعك كل شهر ونرسل لك النتيجة هنا. ابدأ بإصلاح أهم 3 مشاكل في تقريرك.</p><p><a href="${appUrl()}/dashboard">افتح لوحتك</a></p></div>`,
  );
  redirect(safeNext(form.get("next")));
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const email = normalizeEmail(String(form.get("email") || ""));
  const password = String(form.get("password") || "");
  const ip = await clientIp();
  if (rateLimited(`login-ip:${ip}`, 30, 15 * 60_000, false) || rateLimited(`login:${email}`, 10, 15 * 60_000, false)) return { error: t.errTooMany };
  const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  const valid = user ? await verifyPassword(password, user.pass_hash) : await dummyVerify(password);
  if (!user || !valid) {
    rateLimited(`login-ip:${ip}`, Infinity, 15 * 60_000);
    rateLimited(`login:${email}`, Infinity, 15 * 60_000);
    return { error: t.errBadLogin };
  }
  await createSession(user.id);
  redirect(safeNext(form.get("next")));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

export async function removeDomainAction(form: FormData): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login");
  const result = removeDomain(user, Number(form.get("id")));
  revalidatePath("/dashboard");
  redirect(`/dashboard?removed=${result}`);
}

export async function saveAgencyNameAction(form: FormData): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login");
  const name = String(form.get("agency") || "").trim().slice(0, 80);
  getDb().prepare("UPDATE users SET agency_name = ? WHERE id = ?").run(name || null, user.id);
  redirect("/dashboard?saved=1");
}

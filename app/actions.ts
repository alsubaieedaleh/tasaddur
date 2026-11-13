"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { createSession, destroySession, getUser, hashPassword, isValidEmail, normalizeEmail, verifyPassword } from "@/lib/auth";
import { claimAnonymousAudits, performAudit } from "@/lib/audits";
import { normalizeDomain } from "@/lib/audit/fetcher";
import { clientIp } from "@/lib/request";
import { getT } from "@/lib/i18n";
import type { UserRow } from "@/lib/db";

export interface FormState {
  error?: string;
  /** Show a link to signup next to the error (anonymous limit). */
  signup?: boolean;
  upgrade?: boolean;
}

function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/dashboard";
}

export async function startAudit(_prev: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const host = normalizeDomain(String(form.get("domain") || ""));
  if (!host) return { error: t.errInvalidDomain };
  const user = await getUser();
  const res = await performAudit(user, host, await clientIp());
  if ("error" in res) {
    if (res.error === "limit_anon") return { error: t.errLimitAnon, signup: true };
    if (res.error === "limit_daily") return { error: t.errLimitDaily, upgrade: true };
    if (res.error === "limit_domains") return { error: t.errLimitDomains, upgrade: true };
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
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return { error: t.errEmailTaken };
  const info = db.prepare("INSERT INTO users (email, pass_hash, created_at) VALUES (?, ?, ?)").run(email, hashPassword(password), Date.now());
  const userId = Number(info.lastInsertRowid);
  claimAnonymousAudits(userId, await clientIp());
  await createSession(userId);
  redirect(safeNext(form.get("next")));
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const email = normalizeEmail(String(form.get("email") || ""));
  const password = String(form.get("password") || "");
  const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  if (!user || !verifyPassword(password, user.pass_hash)) return { error: t.errBadLogin };
  await createSession(user.id);
  redirect(safeNext(form.get("next")));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

import crypto from "node:crypto";
import { cookies, headers } from "next/headers";

/**
 * Client IP. Behind a reverse proxy (Render, nginx, Cloudflare) the client can prepend fake
 * X-Forwarded-For entries, so we take the entry added by our own proxy: the N-th from the right,
 * where N = TRUSTED_PROXY_HOPS (default 1).
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS || 1));
  const fwd = (h.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fwd.length) return fwd[Math.max(0, fwd.length - hops)];
  return (h.get("x-real-ip") || "local").trim();
}

const ANON_COOKIE = "tsd_anon";

/** Stable random id for an anonymous visitor (httpOnly cookie). Only call from actions/route handlers when creating. */
export async function getAnonId(create = false): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(ANON_COOKIE)?.value;
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  if (!create) return null;
  const id = crypto.randomBytes(16).toString("base64url");
  jar.set(ANON_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return id;
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Returns a same-origin relative path, or the fallback. Rejects //host, /\host, control chars and absolute URLs. */
export function safeNext(v: unknown, fallback = "/dashboard"): string {
  if (typeof v !== "string" || !v.startsWith("/") || /[\x00-\x1f\\]/.test(v)) return fallback;
  try {
    const u = new URL(v, "http://x.invalid");
    return u.origin === "http://x.invalid" ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}

if (process.env.NODE_ENV === "production") {
  for (const k of ["APP_URL", "CRON_SECRET"]) if (!process.env[k]) console.warn(`[config] ${k} is not set`);
  if (!process.env.MOYASAR_SECRET_KEY || !process.env.MOYASAR_PUBLISHABLE_KEY) console.warn("[config] Moyasar keys are not set: payments are disabled");
}

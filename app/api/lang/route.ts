import { NextResponse, type NextRequest } from "next/server";
import { appUrl, safeNext } from "@/lib/request";

/** Switches the UI language and returns the user to the page they were on (relative redirect, same origin only). */
export function GET(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("to") === "en" ? "en" : "ar";
  let back = "/";
  const ref = req.headers.get("referer");
  if (ref) {
    try {
      const u = new URL(ref);
      const ours = new URL(appUrl()).host;
      const reqHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
      if (u.host === ours || u.host === reqHost) back = safeNext(u.pathname + u.search, "/");
    } catch {
      /* keep "/" */
    }
  }
  const res = new NextResponse(null, { status: 303, headers: { Location: back } });
  res.cookies.set("lang", to, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}

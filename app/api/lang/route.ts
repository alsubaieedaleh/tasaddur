import { NextResponse, type NextRequest } from "next/server";

export function GET(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("to") === "en" ? "en" : "ar";
  const ref = req.headers.get("referer");
  let back = "/";
  if (ref) {
    try {
      const u = new URL(ref);
      if (u.host === req.nextUrl.host) back = u.pathname + u.search;
    } catch {
      /* keep "/" */
    }
  }
  const res = NextResponse.redirect(new URL(back, req.url), 303);
  res.cookies.set("lang", to, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}

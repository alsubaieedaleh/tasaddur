import { NextResponse, type NextRequest } from "next/server";
import { applyVerifiedPayment, fetchMoyasarPayment } from "@/lib/billing";

/**
 * Moyasar redirects the customer here after payment with ?id=<payment id>&status=...
 * We never trust the query string: the payment is fetched from Moyasar's API with our secret key.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  let ok = false;
  try {
    const payment = await fetchMoyasarPayment(id);
    const result = payment ? applyVerifiedPayment(payment) : "not_paid";
    ok = result === "activated" || result === "already_processed";
  } catch (e) {
    console.error("[payments] callback failed", e);
  }
  // Relative redirect: correct behind any proxy.
  return new NextResponse(null, { status: 303, headers: { Location: `/dashboard?paid=${ok ? 1 : 0}` } });
}

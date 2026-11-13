import { NextResponse, type NextRequest } from "next/server";
import { applyVerifiedPayment, fetchMoyasarPayment } from "@/lib/billing";
import { appUrl } from "@/lib/request";

/**
 * Moyasar redirects the customer here after payment with ?id=<payment id>&status=...
 * We never trust the query string: the payment is fetched from Moyasar's API with our secret key.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  const payment = await fetchMoyasarPayment(id);
  const result = payment ? applyVerifiedPayment(payment) : "not_paid";
  const ok = result === "activated" || result === "already_processed";
  return NextResponse.redirect(`${appUrl()}/dashboard?paid=${ok ? 1 : 0}`, 303);
}

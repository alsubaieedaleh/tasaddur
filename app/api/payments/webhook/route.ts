import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { applyVerifiedPayment, fetchMoyasarPayment } from "@/lib/billing";

/**
 * Moyasar webhook (Dashboard → Settings → Webhooks, event "payment_paid"), so a plan is activated even if
 * the buyer closes the tab after 3-D Secure. The body is only used for the payment id: the payment itself
 * is re-fetched from Moyasar with our secret key before anything is activated.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.MOYASAR_WEBHOOK_SECRET;
  let body: { secret_token?: string; data?: { id?: string }; id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const token = body.secret_token || "";
  if (!secret || token.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = body.data?.id || "";
  const payment = await fetchMoyasarPayment(id);
  if (!payment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ result: applyVerifiedPayment(payment) });
}

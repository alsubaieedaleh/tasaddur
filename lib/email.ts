/** Sends an email through Resend when RESEND_API_KEY is set; otherwise logs it (development). Never throws. */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email] to=${to} subject=${subject}`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "Tasaddur <alerts@example.com>", to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[email] failed ${res.status}: ${await res.text()}`);
  } catch (e) {
    console.error("[email] failed", e);
  }
}

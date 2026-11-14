"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the server-rendered report until the audit finishes. */
export default function AuditPoller({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      // Stop after 10 minutes so a stuck tab doesn't poll forever.
      if (Date.now() - started > 10 * 60_000) return clearInterval(timer);
      router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}

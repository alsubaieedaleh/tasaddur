"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { startAudit, type FormState } from "@/app/actions";

interface Props {
  placeholder: string;
  cta: string;
  pending: string;
  signupLabel: string;
  upgradeLabel: string;
  defaultValue?: string;
  compact?: boolean;
}

function Submit({ cta, pending }: { cta: string; pending: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={busy} aria-live="polite">
      {busy ? pending : cta}
    </button>
  );
}

export default function AuditForm(p: Props) {
  const [state, action] = useActionState<FormState, FormData>(startAudit, {});
  return (
    <div>
      <form action={action} className="audit-form">
        <input
          type="text"
          name="domain"
          inputMode="url"
          autoComplete="url"
          required
          dir="ltr"
          aria-label={p.placeholder}
          placeholder={p.placeholder}
          defaultValue={p.defaultValue}
        />
        <Submit cta={p.cta} pending={p.pending} />
      </form>
      {state.error && (
        <div className="error" role="alert" style={{ maxWidth: 620, margin: "12px auto 0" }}>
          {state.error}{" "}
          {state.signup && <Link href="/signup">{p.signupLabel}</Link>}
          {state.upgrade && <Link href="/pricing">{p.upgradeLabel}</Link>}
        </div>
      )}
    </div>
  );
}

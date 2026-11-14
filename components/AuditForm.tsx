"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { startAudit, type FormState } from "@/app/actions";

export interface AuditFormLabels {
  label: string;
  placeholder: string;
  cta: string;
  pending: string;
  signup: string;
  upgrade: string;
  changeDomain: string;
}

interface Props {
  labels: AuditFormLabels;
  defaultValue?: string;
  /** Hide the visible label (still announced to screen readers). */
  hideLabel?: boolean;
}

function Submit({ cta, pending }: { cta: string; pending: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={busy} aria-live="polite">
      {busy ? pending : cta}
    </button>
  );
}

export default function AuditForm({ labels, defaultValue, hideLabel }: Props) {
  const [state, action] = useActionState<FormState, FormData>(startAudit, {});
  const id = useId();
  const next = state.domain ? `/dashboard?rerun=${encodeURIComponent(state.domain)}` : "/dashboard";
  return (
    <div>
      <form action={action} className="audit-form">
        <label htmlFor={id} className={hideLabel ? "sr-only" : "field-label"}>
          {labels.label}
        </label>
        <div className="audit-row">
          <input
            id={id}
            type="text"
            name="domain"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            required
            dir="ltr"
            placeholder={labels.placeholder}
            defaultValue={state.domain ?? defaultValue}
          />
          <Submit cta={labels.cta} pending={labels.pending} />
        </div>
      </form>
      {state.error && (
        <div className="error form-error" role="alert">
          <p>{state.error}</p>
          {(state.signup || state.upgrade || state.changeDomain) && (
            <div className="actions">
              {state.signup && (
                <Link className="btn small" href={`/signup?next=${encodeURIComponent(next)}`}>
                  {labels.signup}
                </Link>
              )}
              {state.upgrade && (
                <Link className="btn small" href="/pricing">
                  {labels.upgrade}
                </Link>
              )}
              {state.changeDomain && (
                <Link className="btn small secondary" href="/dashboard#domains">
                  {labels.changeDomain}
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, signupAction, type FormState } from "@/app/actions";

interface Props {
  mode: "login" | "signup";
  next?: string;
  labels: { email: string; password: string; hint: string; submit: string };
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn block" type="submit" disabled={pending}>
      {label}
    </button>
  );
}

export default function AuthForm({ mode, next, labels }: Props) {
  const [state, action] = useActionState<FormState, FormData>(mode === "login" ? loginAction : signupAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next || "/dashboard"} />
      <div className="field">
        <label htmlFor="email">{labels.email}</label>
        <input id="email" name="email" type="email" required autoComplete="email" dir="ltr" />
      </div>
      <div className="field">
        <label htmlFor="password">{labels.password}</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          dir="ltr"
        />
        {mode === "signup" && <div className="hint">{labels.hint}</div>}
      </div>
      {state.error && <div className="error" role="alert">{state.error}</div>}
      <Submit label={labels.submit} />
    </form>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";

export interface PlanCard {
  id: string;
  name: string;
  desc: string;
  monthly: number;
  yearly: number;
  features: string[];
  featured?: boolean;
}

interface Props {
  plans: PlanCard[];
  labels: { monthly: string; yearly: string; perMonth: string; perYear: string; startFree: string; choose: string; current: string };
  currentPlan?: string;
  loggedIn: boolean;
}

export default function Pricing({ plans, labels, currentPlan, loggedIn }: Props) {
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  return (
    <div>
      <div className="toggle" role="tablist">
        {(["monthly", "yearly"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={period === p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
            {labels[p]}
          </button>
        ))}
      </div>
      <div className="grid grid-3">
        {plans.map((plan) => {
          const price = period === "yearly" ? plan.yearly : plan.monthly;
          const isFree = plan.id === "free";
          const isCurrent = currentPlan === plan.id && isFree;
          const checkout = `/checkout?plan=${plan.id}&period=${period}`;
          const href = isFree ? (loggedIn ? "/dashboard" : "/signup") : loggedIn ? checkout : `/signup?next=${encodeURIComponent(checkout)}`;
          return (
            <div key={plan.id} className={`card plan${plan.featured ? " featured" : ""}`}>
              <h3>{plan.name}</h3>
              <p>{plan.desc}</p>
              <div className="price">
                {price.toLocaleString("en-US")} <small>{isFree ? "" : period === "yearly" ? labels.perYear : labels.perMonth}</small>
              </div>
              <ul>
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <span className="btn secondary block" aria-disabled>
                  {labels.current}
                </span>
              ) : (
                <Link href={href} className={`btn block${plan.featured ? "" : " secondary"}`}>
                  {isFree ? labels.startFree : labels.choose}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

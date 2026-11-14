"use client";

import { useState } from "react";
import Link from "next/link";

export interface PlanCard {
  id: string;
  name: string;
  desc: string;
  monthly: number;
  yearly: number;
  weekly?: number;
  /** Precomputed copy (functions can't cross the server/client boundary). */
  yearlyNote?: string;
  weeklyNote?: string;
  features: string[];
  featured?: boolean;
}

export interface PricingLabels {
  monthly: string;
  yearly: string;
  perMonth: string;
  perYear: string;
  startFree: string;
  choose: string;
  current: string;
  free: string;
  popular: string;
}

interface Props {
  plans: PlanCard[];
  labels: PricingLabels;
  currentPlan?: string;
  loggedIn: boolean;
}

const withAuth = (loggedIn: boolean, href: string) => (loggedIn ? href : `/signup?next=${encodeURIComponent(href)}`);

export default function Pricing({ plans, labels, currentPlan, loggedIn }: Props) {
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  return (
    <div>
      <div className="toggle" role="group">
        {(["monthly", "yearly"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={period === p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
            {labels[p]}
          </button>
        ))}
      </div>
      <div className="grid grid-3 plans">
        {plans.map((plan) => {
          const isFree = plan.id === "free";
          const price = period === "yearly" ? plan.yearly : plan.monthly;
          const isCurrent = currentPlan === plan.id;
          const href = isFree ? (loggedIn ? "/dashboard" : "/signup") : withAuth(loggedIn, `/checkout?plan=${plan.id}&period=${period}`);
          return (
            <div key={plan.id} className={`card plan${plan.featured ? " featured" : ""}`}>
              {plan.featured && <span className="popular">{labels.popular}</span>}
              <h3>{plan.name}</h3>
              <p>{plan.desc}</p>
              <div className="price">
                {isFree ? (
                  labels.free
                ) : (
                  <>
                    {price.toLocaleString("en-US")} <small>{period === "yearly" ? labels.perYear : labels.perMonth}</small>
                  </>
                )}
              </div>
              {!isFree && period === "yearly" && <p className="equiv">{plan.yearlyNote}</p>}
              <ul>
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {isCurrent && isFree ? (
                <span className="btn secondary block" aria-disabled>
                  {labels.current}
                </span>
              ) : (
                <Link href={href} className={`btn block${plan.featured ? "" : " secondary"}`}>
                  {isFree ? labels.startFree : labels.choose}
                </Link>
              )}
              {plan.weekly && plan.weeklyNote && (
                <Link className="weekly-link" href={withAuth(loggedIn, `/checkout?plan=${plan.id}&period=weekly`)}>
                  {plan.weeklyNote}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

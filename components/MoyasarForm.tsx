"use client";

import { useEffect, useRef } from "react";

const MPF_VERSION = "1.14.0";

declare global {
  interface Window {
    Moyasar?: { init: (cfg: Record<string, unknown>) => void };
  }
}

interface Props {
  amount: number; // halalas
  description: string;
  publishableKey: string;
  callbackUrl: string;
  metadata: Record<string, string>;
  language: "ar" | "en";
}

export default function MoyasarForm(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `https://cdn.moyasar.com/mpf/${MPF_VERSION}/moyasar.css`;
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = `https://cdn.moyasar.com/mpf/${MPF_VERSION}/moyasar.js`;
    script.onload = () => {
      window.Moyasar?.init({
        element: ".mysr-form",
        amount: p.amount,
        currency: "SAR",
        description: p.description,
        publishable_api_key: p.publishableKey,
        callback_url: p.callbackUrl,
        methods: ["creditcard", "applepay", "stcpay"],
        supported_networks: ["mada", "visa", "mastercard"],
        apple_pay: { country: "SA", label: "Tasaddur", validate_merchant_url: "https://api.moyasar.com/v1/applepay/initiate" },
        metadata: p.metadata,
        language: p.language,
      });
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
      css.remove();
    };
  }, [p.amount, p.description, p.publishableKey, p.callbackUrl, p.metadata, p.language]);
  return <div className="mysr-form" ref={ref} />;
}

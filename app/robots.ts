import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/request";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/checkout", "/audit/"] }],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}

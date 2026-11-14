/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["cheerio"],
  poweredByHeader: false,
  // Render metadata in <head> for every client, so crawlers and link previews see titles without running JS.
  htmlLimitedBots: /.*/,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default nextConfig;

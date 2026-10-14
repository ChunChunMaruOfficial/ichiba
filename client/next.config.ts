import type { NextConfig } from "next";

const API_URL = (process.env.API_URL ?? (process.env.VERCEL ? "" : "http://localhost:4000")).replace(/\/$/, "");
if (!API_URL) throw new Error("API_URL is not set: address of the deployed API, e.g. https://ichiba-api.vercel.app");

const production = process.env.NODE_ENV === "production";

/** Security headers for every page (the API sets its own via helmet). */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The site is never embedded in frames (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Geolocation only for our own pages: sharing a location in chat.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // One address for the site: www.ichiba.by goes to ichiba.by (ichiba.site is redirected by Cloudflare itself).
  async redirects() {
    return [{ source: "/:path*", has: [{ type: "host", value: "www.ichiba.by" }], destination: "https://ichiba.by/:path*", permanent: true }];
  },
  // The browser talks to /api on the same origin, so the session cookie is first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;

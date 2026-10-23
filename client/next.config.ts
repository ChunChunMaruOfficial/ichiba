import type { NextConfig } from "next";
import { PRIVATE_SECTIONS } from "./src/lib/private-routes";

const production = process.env.NODE_ENV === "production";

// The /api rewrite is fixed at build time: a production build without API_URL would bake http://localhost:4000 into
// the deployed site and every request would fail. Local development keeps the localhost default.
const API_URL = (process.env.API_URL ?? (production || process.env.VERCEL ? "" : "http://localhost:4000")).replace(/\/$/, "");
if (!API_URL) throw new Error("API_URL is not set: address of the deployed API, e.g. https://ichiba-api.vercel.app");

/**
 * Scripts only from our own origin: Next's inline bootstrap needs 'unsafe-inline' (nonces would make every page
 * dynamic), but no foreign script, plugin, <base> rewrite or form posting elsewhere gets through.
 * Images, styles and connections are left open: photos, map tiles and realtime live on other hosts.
 * The sign-in buttons load their providers' scripts (auth-modal.tsx): Google, Telegram, Apple.
 */
const SIGN_IN_SCRIPTS = "https://accounts.google.com https://telegram.org https://appleid.cdn-apple.com";
const csp = [
  "frame-ancestors 'none'",
  `script-src 'self' 'unsafe-inline' ${SIGN_IN_SCRIPTS}${production ? "" : " 'unsafe-eval'"}`,
  "script-src-attr 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(production ? ["upgrade-insecure-requests"] : []),
].join("; ");

/** Security headers for every page (the API sets its own via helmet). */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The site is never embedded in frames (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: csp },
  // Geolocation only for our own pages: sharing a location in chat.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const privateHeaders = [
  { key: "Cache-Control", value: "private, no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Personal pages: not kept by the browser, the edge or any proxy, and not indexed (robots.txt is only a hint).
      ...[`/:section(${PRIVATE_SECTIONS.join("|")})/:rest*`, "/item/:id/edit"].map((source) => ({ source, headers: privateHeaders })),
      // Textures, patterns and cloth (public/brand) change rarely: kept for a week instead of rechecked on every page.
      { source: "/brand/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
    ];
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

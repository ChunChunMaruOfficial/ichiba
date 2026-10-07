import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? (process.env.VERCEL ? undefined : "http://localhost:4000");
if (!API_URL) throw new Error("API_URL is not set: URL of the deployed API, e.g. https://ichiba-api.vercel.app");

const nextConfig: NextConfig = {
  // The browser talks to /api on the same origin, so the session cookie is first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL.replace(/\/$/, "")}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;

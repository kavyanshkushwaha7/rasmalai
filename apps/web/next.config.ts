import type { NextConfig } from "next";
import { createSecurityHeaders } from "./lib/security-headers";

const secureVoiceTest = process.env.RASMALAI_SECURE_TEST === "1";
const isolatedAuditBuild = process.env.RASMALAI_AUDIT_BUILD === "1";
const secureTestHostname = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();

const nextConfig: NextConfig = {
  // Keep parallel development and audit builds away from active server output.
  // Next.js documents a separate distDir for isolated builds.
  distDir: isolatedAuditBuild ? ".next-audit-build" : secureVoiceTest ? ".next-secure-test" : ".next",
  transpilePackages: ["@rasmalai/database"],
  // Tailscale Serve gives the secure-test browser a different host from the
  // loopback Next dev server. Allow only that explicit test hostname so the
  // dev HMR/font endpoints can hydrate on the private HTTPS origin.
  ...(secureVoiceTest && secureTestHostname ? { allowedDevOrigins: [secureTestHostname] } : {}),
  // This value is intentionally browser-visible: it is only the Socket.IO
  // endpoint. Do not add credentials or other secrets to Next's `env` config.
  env: {
    NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL ?? "",
  },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: createSecurityHeaders() }];
  },
};

export default nextConfig;

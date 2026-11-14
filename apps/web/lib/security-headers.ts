export type SecurityHeader = { key: string; value: string };

/** Headers that are safe for the current same-origin app and its microphone flow. */
export function createSecurityHeaders(siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ""): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  ];

  if (siteUrl.startsWith("https://")) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  }

  return headers;
}

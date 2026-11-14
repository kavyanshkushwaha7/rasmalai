/** Keep localhost usable over HTTP while requiring Secure cookies for hosted
 * production domains. This option is shared by the browser and SSR clients. */
export function getSupabaseCookieOptions(
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL,
  environment = process.env.NODE_ENV,
): { secure: boolean } {
  if (!siteUrl) return { secure: environment === "production" };

  try {
    const site = new URL(siteUrl);
    const isLocalhost = site.hostname === "localhost" || site.hostname === "127.0.0.1" || site.hostname === "[::1]";
    return { secure: site.protocol === "https:" || (environment === "production" && !isLocalhost) };
  } catch {
    return { secure: environment === "production" };
  }
}

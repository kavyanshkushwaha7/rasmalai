export type RealtimeOriginPolicy = {
  allowedOrigins: readonly string[];
  webOrigins: readonly string[];
  localInterfaceAddresses: readonly string[];
  allowLocalLanOrigins: boolean;
};

export function getRealtimeAllowedOrigins(
  environment: string | undefined,
  configuredOrigins: string | undefined,
  developmentSiteOrigin: string | undefined,
) {
  const production = environment === "production";
  const configured = (configuredOrigins ?? "").split(",").map((value) => value.trim()).filter(Boolean);

  if (production) {
    if (configured.length === 0) throw new Error("REALTIME_ALLOWED_ORIGIN must be configured in production.");
    return [...new Set(configured.map((origin) => {
      let parsed: URL;
      try { parsed = new URL(origin); }
      catch { throw new Error("REALTIME_ALLOWED_ORIGIN must contain valid HTTPS origins."); }
      if (parsed.protocol !== "https:" || parsed.origin !== origin) {
        throw new Error("REALTIME_ALLOWED_ORIGIN must contain exact HTTPS origins without paths.");
      }
      return parsed.origin;
    }))];
  }

  const fallback = developmentSiteOrigin ?? "http://localhost:3000";
  return [...new Set([...configured, fallback].filter(Boolean))];
}

/**
 * Use an exact allowlist in every environment. Local development additionally
 * accepts the active machine's own interface addresses, on the configured web
 * origin's scheme and port, so phones on the same LAN can reach the socket.
 */
export function isRealtimeOriginAllowed(origin: string | undefined, policy: RealtimeOriginPolicy) {
  if (!origin) return true; // Non-browser clients still require a verified socket token.
  let requested: URL;
  try {
    requested = new URL(origin);
  } catch {
    return false;
  }

  if (policy.allowedOrigins.some((entry) => {
    try { return new URL(entry).origin === requested.origin; }
    catch { return false; }
  })) return true;

  if (!policy.allowLocalLanOrigins || !policy.localInterfaceAddresses.includes(requested.hostname)) return false;
  return policy.webOrigins.some((entry) => {
    try {
      const web = new URL(entry);
      return requested.protocol === web.protocol && requested.port === web.port;
    } catch {
      return false;
    }
  });
}

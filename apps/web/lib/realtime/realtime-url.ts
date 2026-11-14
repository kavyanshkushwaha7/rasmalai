const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLanHost(hostname: string) {
  if (hostname.endsWith(".local")) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254);
}

/**
 * Resolve the Socket.IO service for the current browser origin.
 *
 * A configured public endpoint always wins. Loopback endpoints are rewritten
 * only when a device opened this local app through the host computer's LAN
 * address; on a phone, localhost would otherwise point back to the phone.
 */
export function resolveRealtimeUrl(
  configuredUrl: string | undefined,
  page: Pick<Location, "hostname" | "origin" | "protocol">,
) {
  // HTTPS pages cannot open mixed-content ws:// or http:// connections. A
  // private HTTPS test host may reverse-proxy Socket.IO on the same hostname
  // (or on a separately TLS-terminated port), so keep its HTTPS origin.
  const fallback = page.protocol === "https:"
    ? page.origin
    : `${page.protocol}//${page.hostname}:4100`;
  const target = new URL(configuredUrl?.trim() || fallback, page.origin);
  if (page.protocol === "https:") {
    // When the configured value is a local HTTP endpoint, use the HTTPS page
    // origin. The private test proxy routes /socket.io to realtime, avoiding
    // mixed content and avoiding a second browser-visible host/port.
    if (LOOPBACK_HOSTS.has(target.hostname.toLowerCase()) && target.protocol === "http:") return page.origin;
    if (target.protocol === "http:") target.protocol = "https:";
    return target.origin;
  }
  if (isLanHost(page.hostname) && LOOPBACK_HOSTS.has(target.hostname.toLowerCase())) {
    target.hostname = page.hostname;
    target.protocol = page.protocol;
  }
  return target.origin;
}

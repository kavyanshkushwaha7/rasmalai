import type { RealtimeStatus } from "./useRealtimeSocket";

export function getRoomPendingTitle(status: RealtimeStatus, error: string) {
  if (status === "error") return "We couldn’t reach the game service.";
  if (status === "disconnected") return "Your table connection was interrupted.";
  if (status === "connected" && error) return "We couldn’t join this table.";
  if (status === "connected") return "Joining your table…";
  return "Connecting to your table…";
}

export function getRealtimeConnectionError(message: unknown, endpoint?: string) {
  const normalized = typeof message === "string" ? message.toLowerCase() : "";
  const secureTestEndpoint = endpoint?.startsWith("https://") === true;
  if (normalized.includes("unauthorized")) {
    return "This browser’s sign-in could not be verified. Sign in on this device at the current site, then retry.";
  }
  if (secureTestEndpoint) {
    return "The private secure game connection failed. Check that the Mac’s Tailscale test service is running, then retry.";
  }
  return "The game service isn’t reachable from this device. Use the Mac’s Wi-Fi address, keep both devices on the same network, and make sure port 4100 is reachable.";
}

export function getRealtimeSessionError() {
  return "This browser has no active RASMALAI sign-in. Sign in at this site to use online rooms.";
}

export function getRealtimeConnectionTimeout(endpoint?: string) {
  return endpoint?.startsWith("https://")
    ? "The secure game connection is taking too long. Check the private HTTPS test service and retry."
    : "The game connection is taking too long. Check that the realtime service is running, then retry.";
}

/**
 * Make an opaque request/correlation UUID for idempotent realtime actions.
 * `crypto.randomUUID()` is restricted to secure contexts in browsers. RASMALAI
 * is also opened over plain HTTP on a local Wi-Fi address during device tests,
 * so use `getRandomValues()` when randomUUID is unavailable there.
 *
 * This identifier is not an authentication credential. The server still
 * validates the signed-in socket, room membership, turn, quota, and game rules.
 */
type RealtimeCrypto = { getRandomValues: (array: Uint8Array) => Uint8Array; randomUUID?: () => string };

export function createRealtimeActionId(cryptoApi: RealtimeCrypto = globalThis.crypto): string {
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

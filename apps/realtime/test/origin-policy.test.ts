import assert from "node:assert/strict";
import test from "node:test";
import { getRealtimeAllowedOrigins, isRealtimeOriginAllowed } from "../src/origin-policy.js";

const base = {
  allowedOrigins: ["http://localhost:3000"],
  webOrigins: ["http://localhost:3000"],
  localInterfaceAddresses: ["192.168.100.107"],
  allowLocalLanOrigins: true,
};

test("realtime accepts the configured web origin and this host's LAN origin in local development", () => {
  assert.equal(isRealtimeOriginAllowed("http://localhost:3000", base), true);
  assert.equal(isRealtimeOriginAllowed("http://192.168.100.107:3000", base), true);
});

test("realtime local LAN origin is constrained to the active host address and web port", () => {
  assert.equal(isRealtimeOriginAllowed("http://192.168.100.108:3000", base), false);
  assert.equal(isRealtimeOriginAllowed("http://192.168.100.107:4100", base), false);
  assert.equal(isRealtimeOriginAllowed("https://192.168.100.107:3000", base), false);
  assert.equal(isRealtimeOriginAllowed("https://attacker.example", base), false);
});

test("production mode does not expand the exact origin allowlist to LAN hosts", () => {
  const allowedOrigins = getRealtimeAllowedOrigins("production", "https://rasmalai.example", undefined);
  const policy = { ...base, allowedOrigins, webOrigins: allowedOrigins, allowLocalLanOrigins: false };
  assert.equal(isRealtimeOriginAllowed("http://192.168.100.107:3000", policy), false);
  assert.equal(isRealtimeOriginAllowed("http://localhost:3000", policy), false);
  assert.equal(isRealtimeOriginAllowed("https://rasmalai.example", policy), true);
});

test("production origin setup requires explicit exact HTTPS origins and never adds localhost", () => {
  assert.throws(() => getRealtimeAllowedOrigins("production", undefined, undefined), /must be configured/);
  assert.throws(() => getRealtimeAllowedOrigins("production", "http://localhost:3000", undefined), /HTTPS/);
  assert.throws(() => getRealtimeAllowedOrigins("production", "https://rasmalai.example/path", undefined), /without paths/);
  assert.deepEqual(getRealtimeAllowedOrigins("production", "https://rasmalai.example", "http://localhost:3000"), ["https://rasmalai.example"]);
});

test("development keeps its localhost fallback and configured origins", () => {
  assert.deepEqual(getRealtimeAllowedOrigins("development", "http://192.168.1.20:3000", "http://localhost:3000"), [
    "http://192.168.1.20:3000",
    "http://localhost:3000",
  ]);
});

test("malformed origins are rejected", () => {
  assert.equal(isRealtimeOriginAllowed("not-an-origin", base), false);
});

test("private HTTPS test origins are allowed only when explicitly configured", () => {
  const httpsTestOrigin = "https://mac.tailnet.ts.net";
  const policy = {
    allowedOrigins: [httpsTestOrigin],
    webOrigins: [httpsTestOrigin],
    localInterfaceAddresses: [],
    allowLocalLanOrigins: false,
  };
  assert.equal(isRealtimeOriginAllowed(httpsTestOrigin, policy), true);
  assert.equal(isRealtimeOriginAllowed("https://other.tailnet.ts.net", policy), false);
  assert.equal(isRealtimeOriginAllowed("http://mac.tailnet.ts.net", policy), false);
});

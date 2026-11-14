import assert from "node:assert/strict";
import test from "node:test";
import { resolveRealtimeUrl } from "../lib/realtime/realtime-url";

test("realtime defaults to localhost for localhost web sessions", () => {
  assert.equal(resolveRealtimeUrl(undefined, { hostname: "localhost", origin: "http://localhost:3000", protocol: "http:" }), "http://localhost:4100");
});

test("realtime follows a private LAN hostname when the app is opened from a phone", () => {
  assert.equal(resolveRealtimeUrl(undefined, { hostname: "192.168.100.107", origin: "http://192.168.100.107:3000", protocol: "http:" }), "http://192.168.100.107:4100");
});

test("a baked localhost realtime URL is rewritten only for local LAN page origins", () => {
  assert.equal(resolveRealtimeUrl("http://localhost:4100", { hostname: "192.168.100.107", origin: "http://192.168.100.107:3000", protocol: "http:" }), "http://192.168.100.107:4100");
  assert.equal(resolveRealtimeUrl("http://localhost:4100", { hostname: "localhost", origin: "http://localhost:3000", protocol: "http:" }), "http://localhost:4100");
});

test("an explicit hosted realtime endpoint is preserved", () => {
  assert.equal(resolveRealtimeUrl("https://realtime.example.test", { hostname: "192.168.100.107", origin: "http://192.168.100.107:3000", protocol: "http:" }), "https://realtime.example.test");
});

test("secure pages default Socket.IO to the same HTTPS origin for a private reverse proxy", () => {
  assert.equal(resolveRealtimeUrl(undefined, { hostname: "mac.tailnet.ts.net", origin: "https://mac.tailnet.ts.net", protocol: "https:" }), "https://mac.tailnet.ts.net");
});

test("secure pages map a configured local HTTP realtime endpoint to the HTTPS page origin", () => {
  assert.equal(resolveRealtimeUrl("http://localhost:4100", { hostname: "mac.tailnet.ts.net", origin: "https://mac.tailnet.ts.net", protocol: "https:" }), "https://mac.tailnet.ts.net");
});

test("secure pages preserve an explicitly configured HTTPS realtime endpoint", () => {
  assert.equal(resolveRealtimeUrl("https://realtime.tailnet.ts.net:8443", { hostname: "mac.tailnet.ts.net", origin: "https://mac.tailnet.ts.net", protocol: "https:" }), "https://realtime.tailnet.ts.net:8443");
});

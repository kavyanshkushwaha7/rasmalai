import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecurityHeaders } from "../lib/security-headers.js";

test("security headers set safe defaults and allow same-origin opt-in microphone access", () => {
  const headers = new Map(createSecurityHeaders("http://localhost:3000").map(({ key, value }) => [key, value]));
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("Permissions-Policy"), "camera=(), microphone=(self), geolocation=()");
  assert.equal(headers.has("Strict-Transport-Security"), false, "HTTP localhost must not receive HSTS");
});

test("HTTPS sites receive HSTS without asserting ownership of every subdomain", () => {
  const headers = new Map(createSecurityHeaders("https://games.example.test").map(({ key, value }) => [key, value]));
  assert.equal(headers.get("Strict-Transport-Security"), "max-age=31536000");
});

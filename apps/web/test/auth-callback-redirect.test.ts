import assert from "node:assert/strict";
import test from "node:test";
import { getSafeAuthCallbackPath } from "../lib/supabase/auth-callback-redirect";

const requestUrl = "http://0.0.0.0:3000/auth/callback?code=redacted";

test("auth callback keeps an internal target as a relative browser path", () => {
  assert.equal(getSafeAuthCallbackPath("/profile/setup?welcome=1", requestUrl), "/profile/setup?welcome=1");
});

test("auth callback accepts absolute same-origin targets but returns only their path", () => {
  assert.equal(getSafeAuthCallbackPath("http://0.0.0.0:3000/reset-password", requestUrl), "/reset-password");
});

test("auth callback rejects external and protocol-relative redirect targets", () => {
  assert.equal(getSafeAuthCallbackPath("https://attacker.example/steal", requestUrl), "/playground");
  assert.equal(getSafeAuthCallbackPath("//attacker.example/steal", requestUrl), "/playground");
});

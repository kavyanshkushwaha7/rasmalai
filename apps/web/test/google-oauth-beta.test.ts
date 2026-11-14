import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAuthUserAllowed, readAuthBetaConfig } from "@rasmalai/database/auth-beta-policy";
import { getSafeAuthCallbackPath } from "../lib/supabase/auth-callback-redirect.js";
import {
  getAuthCallbackRejectionReason,
  logAuthCallbackRejection,
} from "../lib/supabase/auth-callback-diagnostics.js";

const webRoot = new URL("../", import.meta.url);

test("Google OAuth action requests only basic identity scopes and uses the existing PKCE callback", async () => {
  const actions = await readFile(new URL("app/actions/auth.ts", webRoot), "utf8");
  assert.match(actions, /signInWithOAuth\(\{[\s\S]*provider: "google"/);
  assert.match(actions, /scopes: "openid email profile"/);
  assert.match(actions, /\/auth\/callback\?next=\/profile\/setup/);
  const callback = await readFile(new URL("app/auth/callback/route.ts", webRoot), "utf8");
  assert.match(callback, /exchangeCodeForSession\(code\)/);
  assert.match(callback, /getAuthCallbackRejectionReason\(user, error, config\)/);
  assert.match(callback, /logAuthCallbackRejection\(rejectionReason\)/);
  assert.match(callback, /catch\s*\{\s*rejectionReason = "supabase_get_user_error"/);
  assert.match(callback, /signOut\(\{ scope: "local" \}\)/);
  assert.match(callback, /\/login\?auth=beta-access/);
  assert.doesNotMatch(callback, /console\.(?:log|warn|error).*user\.email/);
  assert.equal(getSafeAuthCallbackPath("/profile/setup", "https://rasmalai.example/auth/callback"), "/profile/setup");
  assert.equal(getSafeAuthCallbackPath("https://bad.example/steal", "https://rasmalai.example/auth/callback"), "/playground");
});

test("callback distinguishes getUser errors from a missing authenticated user", () => {
  const config = readAuthBetaConfig({
    AUTH_BETA_MODE: "invite-only-google",
    GOOGLE_OAUTH_ENABLED: "true",
    BETA_ALLOWED_EMAILS: "player@example.com",
  });
  assert.equal(getAuthCallbackRejectionReason(null, new Error("redacted"), config), "supabase_get_user_error");
  assert.equal(getAuthCallbackRejectionReason(null, null, config), "user_missing");
  assert.equal(getAuthCallbackRejectionReason({ email: "player@example.com" }, null, config), "email_not_verified");
});

test("callback diagnostics contain only a correlation ID and a fixed reason code", () => {
  const originalWarn = console.warn;
  let message = "";
  console.warn = (...args: unknown[]) => { message = args.map(String).join(" "); };
  try {
    const requestId = logAuthCallbackRejection("email_not_in_beta_allowlist");
    const event = JSON.parse(message) as Record<string, unknown>;
    assert.match(requestId, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(Object.keys(event).sort(), ["reason", "requestId"]);
    assert.equal(event.requestId, requestId);
    assert.equal(event.reason, "email_not_in_beta_allowlist");
    assert.doesNotMatch(message, /@|token|password|cookie|session|secret|authorization/i);
  } finally {
    console.warn = originalWarn;
  }
});

test("beta pages hide password recovery/signup while the server actions retain server-side guards", async () => {
  const authUi = await readFile(new URL("components/AuthForms.tsx", webRoot), "utf8");
  assert.match(authUi, /betaMode === "invite-only-google"/);
  assert.match(authUi, /Continue with Google/);
  assert.match(authUi, /<GoogleSignInButton enabled=\{googleEnabled\} \/>/, "the Google option remains visible when disabled by the server flag");
  for (const page of ["login", "sign-up", "forgot-password", "reset-password"]) {
    const source = await readFile(new URL(`app/${page}/page.tsx`, webRoot), "utf8");
    assert.match(source, /dynamic = "force-dynamic"/, `${page} must read the server's current beta settings at request time`);
  }
  const actions = await readFile(new URL("app/actions/auth.ts", webRoot), "utf8");
  assert.match(actions, /signUpEmail[\s\S]*isPasswordAuthAvailable/);
  assert.match(actions, /signInEmail[\s\S]*isPasswordAuthAvailable/);
  assert.match(actions, /requestPasswordReset[\s\S]*isPasswordAuthAvailable/);
  assert.match(actions, /updatePassword[\s\S]*isPasswordAuthAvailable/);
  const config = readAuthBetaConfig({ AUTH_BETA_MODE: "invite-only-google", GOOGLE_OAUTH_ENABLED: "true", BETA_ALLOWED_EMAILS: "player@example.com" });
  assert.equal(isAuthUserAllowed({ email: "player@example.com", confirmed_at: "now", identities: [{ provider: "google" }] }, config), true);
});

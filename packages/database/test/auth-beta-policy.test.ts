import assert from "node:assert/strict";
import test from "node:test";
import {
  isAuthUserAllowed,
  isGoogleOAuthAvailable,
  isPasswordAuthAvailable,
  readAuthBetaConfig,
} from "../src/auth-beta-policy.js";

const googleUser = {
  email: "Player@Example.com",
  email_confirmed_at: "2026-11-01T00:00:00.000Z",
  app_metadata: { provider: "google", providers: ["google"] },
};

test("local default preserves email/password and keeps Google disabled", () => {
  const config = readAuthBetaConfig({});
  assert.equal(config.mode, "email-password");
  assert.equal(isPasswordAuthAvailable(config), true);
  assert.equal(isGoogleOAuthAvailable(config), false);
  assert.equal(isAuthUserAllowed({ email: "anyone@example.com" }, config), true);
});

test("invite-only Google beta fails closed until Google and a non-empty allowlist are configured", () => {
  const missingGoogle = readAuthBetaConfig({ AUTH_BETA_MODE: "invite-only-google", BETA_ALLOWED_EMAILS: "player@example.com" });
  const missingList = readAuthBetaConfig({ AUTH_BETA_MODE: "invite-only-google", GOOGLE_OAUTH_ENABLED: "true" });
  assert.equal(isGoogleOAuthAvailable(missingGoogle), false);
  assert.equal(isAuthUserAllowed(googleUser, missingGoogle), false);
  assert.equal(isGoogleOAuthAvailable(missingList), false);
  assert.equal(isAuthUserAllowed(googleUser, missingList), false);
  assert.equal(isPasswordAuthAvailable(readAuthBetaConfig({ AUTH_BETA_MODE: "invite-only-google" })), false);
});

test("invite allowlist is case-insensitive and accepts only a verified Google identity", () => {
  const config = readAuthBetaConfig({
    AUTH_BETA_MODE: "invite-only-google",
    GOOGLE_OAUTH_ENABLED: "true",
    BETA_ALLOWED_EMAILS: "  PLAYER@example.com, second@example.com ",
  });
  assert.equal(isAuthUserAllowed(googleUser, config), true);
  assert.equal(isAuthUserAllowed({ ...googleUser, email: "stranger@example.com" }, config), false);
  assert.equal(isAuthUserAllowed({ ...googleUser, email_confirmed_at: null, confirmed_at: null }, config), false);
  assert.equal(isAuthUserAllowed({ ...googleUser, app_metadata: { provider: "email", providers: ["email"] } }, config), false);
  assert.equal(isAuthUserAllowed({ ...googleUser, app_metadata: { provider: "email" }, identities: [{ provider: "google" }] }, config), true);
});

test("unknown beta modes disable access rather than falling back to public signup", () => {
  const config = readAuthBetaConfig({ AUTH_BETA_MODE: "typo", GOOGLE_OAUTH_ENABLED: "true", BETA_ALLOWED_EMAILS: "player@example.com" });
  assert.equal(config.mode, "disabled");
  assert.equal(isPasswordAuthAvailable(config), false);
  assert.equal(isGoogleOAuthAvailable(config), false);
  assert.equal(isAuthUserAllowed(googleUser, config), false);
});

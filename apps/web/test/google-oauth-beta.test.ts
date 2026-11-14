import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAuthUserAllowed, readAuthBetaConfig } from "@rasmalai/database/auth-beta-policy";
import { getSafeAuthCallbackPath } from "../lib/supabase/auth-callback-redirect.js";

const webRoot = new URL("../", import.meta.url);

test("Google OAuth action requests only basic identity scopes and uses the existing PKCE callback", async () => {
  const actions = await readFile(new URL("app/actions/auth.ts", webRoot), "utf8");
  assert.match(actions, /signInWithOAuth\(\{[\s\S]*provider: "google"/);
  assert.match(actions, /scopes: "openid email profile"/);
  assert.match(actions, /\/auth\/callback\?next=\/profile\/setup/);
  const callback = await readFile(new URL("app/auth/callback/route.ts", webRoot), "utf8");
  assert.match(callback, /exchangeCodeForSession\(code\)/);
  assert.match(callback, /isAuthUserAllowed\(user, config\)/);
  assert.match(callback, /signOut\(\{ scope: "local" \}\)/);
  assert.equal(getSafeAuthCallbackPath("/profile/setup", "https://rasmalai.example/auth/callback"), "/profile/setup");
  assert.equal(getSafeAuthCallbackPath("https://bad.example/steal", "https://rasmalai.example/auth/callback"), "/playground");
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

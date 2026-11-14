import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthVerificationUnavailableError,
  isDefinitiveAuthFailure,
  readVerifiedAuthContext,
} from "../lib/supabase/auth-session-policy";
import { isOfflineGameRoute } from "../lib/supabase/offline-route-policy";
import { getSupabaseCookieOptions } from "../lib/supabase/cookie-options";

const user = { id: "user-a", email: "hidden@example.invalid" };
const session = { access_token: "test-token", user: { id: user.id } };

test("server auth uses verified getUser identity and the matching session token", async () => {
  const result = await readVerifiedAuthContext(
    async () => ({ user, error: null }),
    async () => ({ session, error: null }),
  );
  assert.deepEqual(result, { user, accessToken: "test-token" });
});

test("missing, expired, revoked, and invalid sessions resolve as unauthenticated", async () => {
  const missing = await readVerifiedAuthContext(
    async () => ({ user: null, error: { name: "AuthSessionMissingError" } }),
    async () => ({ session: null }),
  );
  assert.equal(missing, null);

  for (const code of ["bad_jwt", "session_expired", "session_not_found", "user_not_found", "user_banned"]) {
    assert.equal(isDefinitiveAuthFailure({ name: "AuthApiError", code, status: 401 }), true, `${code} is terminal`);
    const result = await readVerifiedAuthContext(
      async () => ({ user: null, error: { name: "AuthApiError", code, status: 401 } }),
      async () => ({ session: null }),
    );
    assert.equal(result, null, `${code} cannot authenticate`);
  }
});

test("transient Auth API/network failures preserve the session path instead of returning signed out", async () => {
  for (const error of [
    { name: "AuthRetryableFetchError", status: 503 },
    { name: "AuthApiError", code: "unexpected_failure", status: 503 },
    { name: "AuthApiError", code: "refresh_token_already_used", status: 400 },
    { name: "AuthApiError", code: "refresh_token_not_found", status: 400 },
    new TypeError("network unavailable"),
  ]) {
    await assert.rejects(
      readVerifiedAuthContext(
        async () => ({ user: null, error }),
        async () => ({ session }),
      ),
      AuthVerificationUnavailableError,
    );
  }
});

test("a refresh-token error is only signed out after Supabase confirms its session is gone", async () => {
  const refreshError = { name: "AuthApiError", code: "refresh_token_not_found", status: 400 };
  await assert.rejects(readVerifiedAuthContext(
    async () => ({ user: null, error: refreshError }),
    async () => ({ session }),
  ), AuthVerificationUnavailableError, "the stored bearer token is not trusted without a successful getUser call");

  const clearedBySupabase = await readVerifiedAuthContext(
    async () => ({ user: null, error: refreshError }),
    async () => ({ session: null }),
  );
  assert.equal(clearedBySupabase, null);
});

test("session storage errors and user/session identity mismatches never authenticate", async () => {
  await assert.rejects(
    readVerifiedAuthContext(
      async () => ({ user, error: null }),
      async () => ({ session: null, error: { name: "AuthRetryableFetchError", status: 503 } }),
    ),
    AuthVerificationUnavailableError,
  );

  const mismatch = await readVerifiedAuthContext(
    async () => ({ user, error: null }),
    async () => ({ session: { ...session, user: { id: "user-b" } } }),
  );
  assert.equal(mismatch, null);
});

test("SSR proxy skips only offline game pages; online rooms still refresh auth cookies", () => {
  for (const path of ["/games", "/games/", "/games/ludo", "/games/tic-tac-toe", "/games/snakes-and-ladders"]) {
    assert.equal(isOfflineGameRoute(path), true, `${path} stays available offline`);
  }
  for (const path of ["/games/online", "/games/online/history", "/games/online/123/watch", "/games/ludo/online"]) {
    assert.equal(isOfflineGameRoute(path), false, `${path} must pass through Supabase SSR`);
  }
});

test("auth cookie security follows HTTPS hosting while preserving local HTTP development", () => {
  assert.deepEqual(getSupabaseCookieOptions("http://localhost:3000", "development"), { secure: false });
  assert.deepEqual(getSupabaseCookieOptions("http://localhost:3000", "production"), { secure: false });
  assert.deepEqual(getSupabaseCookieOptions("https://rasmalai.example", "production"), { secure: true });
  assert.deepEqual(getSupabaseCookieOptions("http://rasmalai.example", "production"), { secure: true }, "hosted production must require HTTPS cookies");
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Socket } from "socket.io";
import { createSocketAuthMiddleware } from "../src/socket-auth.js";
import { authorizeRoomMembership, authorizeSocketRoomMembership, type RoomMembershipLookup } from "../src/room-access.js";
import { verifySupabaseAccessToken } from "../src/supabase-auth.js";

const userId = "a21aa111-5d0b-4e12-9a80-82db9ec88f03";
const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const originalAuthMode = process.env.AUTH_BETA_MODE;
const originalGoogleFlag = process.env.GOOGLE_OAUTH_ENABLED;
const originalBetaEmails = process.env.BETA_ALLOWED_EMAILS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
  else process.env.SUPABASE_PUBLISHABLE_KEY = originalKey;
  if (originalAuthMode === undefined) delete process.env.AUTH_BETA_MODE;
  else process.env.AUTH_BETA_MODE = originalAuthMode;
  if (originalGoogleFlag === undefined) delete process.env.GOOGLE_OAUTH_ENABLED;
  else process.env.GOOGLE_OAUTH_ENABLED = originalGoogleFlag;
  if (originalBetaEmails === undefined) delete process.env.BETA_ALLOWED_EMAILS;
  else process.env.BETA_ALLOWED_EMAILS = originalBetaEmails;
});

test("realtime invite-only beta accepts only a verified, allowlisted Google identity", async () => {
  process.env.SUPABASE_URL = "https://project.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  process.env.AUTH_BETA_MODE = "invite-only-google";
  process.env.GOOGLE_OAUTH_ENABLED = "true";
  process.env.BETA_ALLOWED_EMAILS = "player@example.com";
  globalThis.fetch = (async () => Response.json({
    id: userId,
    email: "player@example.com",
    email_confirmed_at: "2026-11-01T00:00:00.000Z",
    app_metadata: { provider: "google", providers: ["google"] },
  })) as typeof fetch;
  assert.deepEqual(await verifySupabaseAccessToken("valid-token-long-enough"), { id: userId });

  globalThis.fetch = (async () => Response.json({
    id: userId,
    email: "other@example.com",
    email_confirmed_at: "2026-11-01T00:00:00.000Z",
    app_metadata: { provider: "google", providers: ["google"] },
  })) as typeof fetch;
  assert.equal(await verifySupabaseAccessToken("valid-token-long-enough"), null);

  globalThis.fetch = (async () => Response.json({ id: userId, email: "player@example.com", email_confirmed_at: "now", app_metadata: { provider: "email" } })) as typeof fetch;
  assert.equal(await verifySupabaseAccessToken("valid-token-long-enough"), null);
});

test("realtime public Google mode accepts verified Google identities without an allowlist", async () => {
  process.env.SUPABASE_URL = "https://project.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  process.env.AUTH_BETA_MODE = "public-google";
  process.env.GOOGLE_OAUTH_ENABLED = "true";
  process.env.BETA_ALLOWED_EMAILS = "";
  globalThis.fetch = (async () => Response.json({
    id: userId,
    email: "new-player@example.net",
    email_confirmed_at: "2026-11-01T00:00:00.000Z",
    app_metadata: { provider: "google", providers: ["google"] },
  })) as typeof fetch;
  assert.deepEqual(await verifySupabaseAccessToken("valid-public-google-token"), { id: userId });

  globalThis.fetch = (async () => Response.json({
    id: userId,
    email: "unverified@example.net",
    email_confirmed_at: null,
    confirmed_at: null,
    app_metadata: { provider: "google", providers: ["google"] },
  })) as typeof fetch;
  assert.equal(await verifySupabaseAccessToken("unverified-google-token"), null);

  globalThis.fetch = (async () => Response.json({
    id: userId,
    email: "email-only@example.net",
    email_confirmed_at: "2026-11-01T00:00:00.000Z",
    app_metadata: { provider: "email", providers: ["email"] },
  })) as typeof fetch;
  assert.equal(await verifySupabaseAccessToken("email-only-token-123456"), null);
});

test("realtime validates a token with Supabase Auth and rejects invalid sessions", async () => {
  process.env.SUPABASE_URL = "https://project.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  let authorization = "";
  globalThis.fetch = (async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({ id: userId });
  }) as typeof fetch;
  assert.deepEqual(await verifySupabaseAccessToken("valid-token-long-enough"), { id: userId });
  assert.equal(authorization, "Bearer valid-token-long-enough");

  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  assert.equal(await verifySupabaseAccessToken("invalid-token-long-enough"), null);

});

function runMiddleware(token: string | undefined, verify: (token: string) => Promise<{ id: string } | null>) {
  const socket = {
    handshake: { auth: token ? { accessToken: token } : {} },
    data: {} as Record<string, unknown>,
  } as unknown as Socket;
  return new Promise<{ error?: Error; data: Record<string, unknown> }>((resolve) => {
    createSocketAuthMiddleware(verify)(socket, (error) => resolve({ error, data: socket.data }));
  });
}

test("socket authentication rejects missing and invalid Supabase sessions", async () => {
  let calls = 0;
  const verify = async () => { calls += 1; return null; };
  const missing = await runMiddleware(undefined, verify);
  const invalid = await runMiddleware("invalid-access-token-long-enough", verify);
  assert.equal(missing.error?.message, "unauthorized");
  assert.equal(invalid.error?.message, "unauthorized");
  assert.equal(calls, 1);
});

test("socket middleware stores only the identity returned by the verifier", async () => {
  const result = await runMiddleware("verified-access-token-long-enough", async () => ({ id: userId }));
  assert.equal(result.error, undefined);
  assert.equal(result.data.userId, userId);
  assert.equal(result.data.supabaseAccessToken, "verified-access-token-long-enough");
});

test("players retain player access if a stale spectator row overlaps; spectators stay read-only", async () => {
  const lookup: RoomMembershipLookup = {
    isPlayer: async (_room, id) => id === "player" || id === "both",
    isSpectator: async (_room, id) => id === "spectator" || id === "both",
  };
  assert.deepEqual(await authorizeRoomMembership("room-1", "player", lookup), {
    role: "player", permissions: { readState: true, submitAction: true, playerChat: true, playerVoice: true, spectatorChat: false },
  });
  assert.deepEqual(await authorizeRoomMembership("room-1", "spectator", lookup), {
    role: "spectator", permissions: { readState: true, submitAction: false, playerChat: false, playerVoice: false, spectatorChat: true },
  });
  assert.equal(await authorizeRoomMembership("room-1", "stranger", lookup), null);
  assert.equal((await authorizeRoomMembership("room-1", "both", lookup))?.role, "player");
  assert.equal(await authorizeRoomMembership("", "player", lookup), null);
});

test("a confirmed room player is not rejected by an unavailable spectator roster lookup", async () => {
  const access = await authorizeRoomMembership("room-1", "player", {
    isPlayer: async () => true,
    isSpectator: async () => { throw new Error("spectator lookup unavailable"); },
  });
  assert.equal(access?.role, "player");
  assert.equal(access?.permissions.playerChat, true);
});

test("socket room authorization revalidates identity and asks RLS-backed roster endpoints", async () => {
  process.env.SUPABASE_URL = "https://project.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  const roomId = "c31aa111-5d0b-4e12-9a80-82db9ec88f03";
  const token = "verified-access-token-long-enough";
  const requests: string[] = [];
  const apiFetch = (async (input) => {
    const endpoint = new URL(String(input));
    if (endpoint.pathname === "/auth/v1/user") return Response.json({ id: userId });
    requests.push(endpoint.pathname);
    return endpoint.pathname.endsWith("/room_players") ? Response.json([]) : Response.json([{ id: "roster-row" }]);
  }) as typeof fetch;

  assert.deepEqual(await authorizeSocketRoomMembership(roomId, { userId, supabaseAccessToken: token }, apiFetch), {
    role: "spectator", permissions: { readState: true, submitAction: false, playerChat: false, playerVoice: false, spectatorChat: true },
  });
  assert.deepEqual(requests.sort(), ["/rest/v1/room_players", "/rest/v1/spectators"]);
  assert.equal(await authorizeSocketRoomMembership(roomId, { userId: "b21aa111-5d0b-4e12-9a80-82db9ec88f03", supabaseAccessToken: token }, apiFetch), null);
  assert.equal(await authorizeSocketRoomMembership("not-a-room-id", { userId, supabaseAccessToken: token }, apiFetch), null);

  const revokedFetch = (async (input) => new URL(String(input)).pathname === "/auth/v1/user"
    ? Response.json({ id: userId })
    : Response.json([])) as typeof fetch;
  assert.equal(await authorizeSocketRoomMembership(roomId, { userId, supabaseAccessToken: token }, revokedFetch), null);
});

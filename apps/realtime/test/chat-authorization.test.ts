import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server, Socket } from "socket.io";
import { registerGameRoomSocket } from "../src/game-room-socket.js";
import { verifySocketRoomMembership } from "../src/room-access.js";

const roomId = "d31aa111-5d0b-4e12-9a80-82db9ec88f03";
const playerA = "a21aa111-5d0b-4e12-9a80-82db9ec88f03";
const playerB = "b21aa111-5d0b-4e12-9a80-82db9ec88f03";
const spectator = "c21aa111-5d0b-4e12-9a80-82db9ec88f03";
const outsider = "e21aa111-5d0b-4e12-9a80-82db9ec88f03";

type TokenRecord = { userId: string };
const tokenUsers = new Map<string, TokenRecord>([
  ["access-token-player-a-initial", { userId: playerA }],
  ["access-token-player-a-refreshed", { userId: playerA }],
  ["access-token-player-b-initial", { userId: playerB }],
  ["access-token-spectator", { userId: spectator }],
  ["access-token-outsider", { userId: outsider }],
]);
const roomPlayers = new Set([playerA, playerB]);
const roomSpectators = new Set([spectator]);

function makeFetch(options: { failMembership?: boolean } = {}): typeof fetch {
  return (async (input, init) => {
    const endpoint = new URL(String(input));
    const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (endpoint.pathname === "/auth/v1/user") {
      const user = tokenUsers.get(token);
      return user ? Response.json({ id: user.userId }) : Response.json({}, { status: 401 });
    }
    if (options.failMembership) return Response.json({}, { status: 503 });
    const profileId = endpoint.searchParams.get("profile_id")?.slice(3) ?? "";
    if (endpoint.pathname.endsWith("/room_players")) {
      return Response.json(roomPlayers.has(profileId) ? [{ id: "player-roster-row" }] : []);
    }
    if (endpoint.pathname.endsWith("/spectators")) {
      return Response.json(roomSpectators.has(profileId) ? [{ id: "spectator-roster-row" }] : []);
    }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
}

function makeSocket(userId: string, supabaseAccessToken: string) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const socket = {
    data: { userId, supabaseAccessToken, eventWindows: new Map() },
    on(name: string, handler: (...args: unknown[]) => unknown) { handlers.set(name, handler); return this; },
    emit() { return this; },
    join() { return Promise.resolve(); },
    leave() { return Promise.resolve(); },
    to() { return { emit() {} }; },
  } as unknown as Socket;
  return { socket, handlers };
}

async function invoke(handler: ((...args: unknown[]) => unknown) | undefined, ...args: unknown[]) {
  assert.ok(handler);
  return await handler(...args);
}

test("both room players can still chat after reconnects and rematches with spectator mode disabled", async () => {
  process.env.SUPABASE_URL = "https://project.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  const fetcher = makeFetch();
  const emitted: Array<{ channel: string; event: string; payload: unknown }> = [];
  const sent: Array<{ userId: string; body: string }> = [];
  const io = {
    to(channel: string) { return { emit(event: string, payload: unknown) { emitted.push({ channel, event, payload }); } }; },
  } as unknown as Server;
  let matchRound = 1;

  async function sendAs(userId: string, token: string, body: string) {
    const { socket, handlers } = makeSocket(userId, token);
    registerGameRoomSocket(io, socket, {
      verifyRoomMembership: (id, data) => verifySocketRoomMembership(id, data, fetcher),
      checkSharedLimit: async () => true,
      spectatorModeEnabled: () => false,
      sendPlayerChat: async (_token, id, messageBody) => {
        sent.push({ userId, body: messageBody });
        return { id: `message-${sent.length}`, roomId: id, authorId: userId, body: messageBody };
      },
    });
    let result: Record<string, unknown> | undefined;
    await invoke(handlers.get("chat:send"), { roomId, body }, (ack: Record<string, unknown>) => { result = ack; });
    return result;
  }

  assert.equal((await sendAs(playerA, "access-token-player-a-initial", "Safari first round"))?.ok, true);
  assert.equal((await sendAs(playerB, "access-token-player-b-initial", "Chrome first round"))?.ok, true);

  // A refreshed bearer token and a new Socket.IO connection must be accepted
  // for the same signed-in profile, as happens after a reconnect.
  assert.equal((await sendAs(playerA, "access-token-player-a-refreshed", "Safari after reconnect"))?.ok, true);

  // Rematches reuse the room roster; starting a later round must not invalidate
  // either existing player's room-scoped chat authorization.
  matchRound += 1;
  assert.equal(matchRound, 2);
  assert.equal((await sendAs(playerB, "access-token-player-b-initial", "Chrome rematch"))?.ok, true);

  assert.equal(sent.length, 4);
  assert.equal(emitted.filter((entry) => entry.channel === `game:${roomId}` && entry.event === "chat:new").length, 4);
});

test("spectators, unrelated users, stale sessions, and unavailable membership lookups cannot send player chat", async () => {
  process.env.SUPABASE_URL = "https://project.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  const fetcher = makeFetch();
  let databaseWrites = 0;
  const io = { to() { return { emit() {} }; } } as unknown as Server;

  async function attempt(userId: string, token: string, testFetch = fetcher) {
    const { socket, handlers } = makeSocket(userId, token);
    registerGameRoomSocket(io, socket, {
      verifyRoomMembership: (id, data) => verifySocketRoomMembership(id, data, testFetch),
      checkSharedLimit: async () => true,
      sendPlayerChat: async () => { databaseWrites += 1; return {}; },
    });
    let result: Record<string, unknown> | undefined;
    await invoke(handlers.get("chat:send"), { roomId, body: "must remain private" }, (ack: Record<string, unknown>) => { result = ack; });
    return result;
  }

  const spectatorResult = await attempt(spectator, "access-token-spectator");
  assert.equal(spectatorResult?.ok, false);
  assert.match(String(spectatorResult?.error), /available only to current players/);

  const outsiderResult = await attempt(outsider, "access-token-outsider");
  assert.equal(outsiderResult?.ok, false);
  assert.match(String(outsiderResult?.error), /available only to current players/);

  const expiredResult = await attempt(playerB, "expired-access-token-not-known");
  assert.equal(expiredResult?.ok, false);
  assert.match(String(expiredResult?.error), /session could not be verified/);

  const unavailableResult = await attempt(playerB, "access-token-player-b-initial", makeFetch({ failMembership: true }));
  assert.equal(unavailableResult?.ok, false);
  assert.match(String(unavailableResult?.error), /could not verify your room seat/);
  assert.equal(databaseWrites, 0);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Server, Socket } from "socket.io";
import { registerGameRoomSocket } from "../src/game-room-socket.js";

const socketSource = readFileSync("src/game-room-socket.ts", "utf8");
const repositorySource = readFileSync("src/game-repository.ts", "utf8");
const rematchMigration = readFileSync("../../packages/database/prisma/migrations/0010_online_rematches/migration.sql", "utf8");

test("spam-sensitive realtime actions use the shared PostgreSQL budget", () => {
  for (const action of [
    "room_create", "game_action", "room_invite", "room_list",
    "player_chat_send", "player_chat_react", "match_reaction", "spectator_join",
    "spectator_accept", "spectator_invite", "spectator_list", "spectator_chat_send",
    "spectator_chat_react", "voice_join", "voice_signal", "rematch_request", "rematch_response",
  ]) {
    const limiterCall = `checkSharedLimit(socket, "${action}")`;
    assert.ok(socketSource.includes(limiterCall), `${action} must use the shared limiter`);
  }
  assert.match(socketSource, /withinSharedLimit\(socket, "room_join"\)/, "room join must use the shared limiter before the database join");
  assert.match(socketSource, /async function withinSharedLimit[\s\S]*catch\s*\{[\s\S]*return false;/);
});

test("shared budgets are consumed before room membership checks for sensitive socket actions", () => {
  const actions = [
    ["game:action", 'checkSharedLimit(socket, "game_action")', "playerAccess(socket, roomId)"],
    ["rematch:request", 'checkSharedLimit(socket, "rematch_request")', "playerAccess(socket, roomId)"],
    ["rematch:respond", 'checkSharedLimit(socket, "rematch_response")', "playerAccess(socket, roomId)"],
    ["match:reaction", 'checkSharedLimit(socket, "match_reaction")', "playerAccess(socket, roomId)"],
    ["chat:send", 'checkSharedLimit(socket, "player_chat_send")', "verifyRoomMembership(roomId, socket.data)"],
    ["chat:react", 'checkSharedLimit(socket, "player_chat_react")', "playerAccess(socket, roomId)"],
    ["voice:join", 'checkSharedLimit(socket, "voice_join")', "playerAccess(socket, roomId)"],
    ["voice:authorize", 'checkSharedLimit(socket, "voice_join")', "playerAccess(socket, roomId)"],
    ["voice:signal", 'checkSharedLimit(socket, "voice_signal")', "playerAccess(socket, roomId)"],
    ["spectator:invites", 'checkSharedLimit(socket, "spectator_list")', "playerAccess(socket, roomId)"],
    ["spectator:revoke", 'checkSharedLimit(socket, "spectator_invite")', "playerAccess(socket, roomId)"],
  ] as const;

  for (const [eventName, limitCall, authorizationCall] of actions) {
    const start = socketSource.indexOf(`socket.on("${eventName}"`);
    assert.notEqual(start, -1, `${eventName} handler must exist`);
    const next = socketSource.indexOf('socket.on("', start + 1);
    const handler = socketSource.slice(start, next === -1 ? undefined : next);
    assert.ok(handler.includes(limitCall), `${eventName} must charge the shared budget`);
    assert.ok(handler.includes(authorizationCall), `${eventName} must keep its authorization check`);
    assert.ok(handler.indexOf(limitCall) < handler.indexOf(authorizationCall), `${eventName} must charge before authorization lookups`);
  }
});

test("a new socket cannot bypass a shared denied-action budget by reconnecting", async () => {
  const roomId = "d31aa111-5d0b-4e12-9a80-82db9ec88f03";
  let sharedAttempts = 0;
  let membershipLookups = 0;
  const io = { to() { return { emit() {} }; } } as unknown as Server;

  for (let connection = 0; connection < 2; connection += 1) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const socket = {
      data: { userId: `user-${connection}`, supabaseAccessToken: "test-token", eventWindows: new Map() },
      on(name: string, handler: (...args: unknown[]) => unknown) { handlers.set(name, handler); return this; },
      emit() { return this; },
    } as unknown as Socket;
    registerGameRoomSocket(io, socket, {
      checkSharedLimit: async () => ++sharedAttempts < 2,
      verifyRoomMembership: async () => {
        membershipLookups += 1;
        return { access: null, denial: "not_a_member" };
      },
    });

    let result: Record<string, unknown> | undefined;
    await handlers.get("chat:send")?.({ roomId, body: "limited attempt" }, (ack: Record<string, unknown>) => { result = ack; });
    assert.equal(result?.ok, false);
    if (connection === 1) assert.match(String(result?.error), /temporarily limited/);
  }

  assert.equal(sharedAttempts, 2);
  assert.equal(membershipLookups, 1, "the reconnect denied by the shared budget must not repeat authorization work");
});

test("rematch socket actions require player membership, shared limits, and a guarded database RPC", () => {
  const requestHandler = socketSource.slice(socketSource.indexOf('socket.on("rematch:request"'), socketSource.indexOf('socket.on("rematch:respond"'));
  const responseHandler = socketSource.slice(socketSource.indexOf('socket.on("rematch:respond"'), socketSource.indexOf('socket.on("match:reaction"'));
  assert.match(requestHandler, /playerAccess\(socket, roomId\)/);
  assert.match(requestHandler, /checkSharedLimit\(socket, "rematch_request"\)/);
  assert.match(responseHandler, /playerAccess\(socket, roomId\)/);
  assert.match(responseHandler, /checkSharedLimit\(socket, "rematch_response"\)/);
  assert.match(repositorySource, /rasmalai_realtime_rematch_action/);
  assert.match(rematchMigration, /SELECT \* INTO v_room FROM public\.game_rooms WHERE id = p_room_id FOR UPDATE/);
  assert.match(rematchMigration, /REVOKE ALL ON FUNCTION public\.rasmalai_realtime_rematch_action[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(rematchMigration, /GRANT EXECUTE ON FUNCTION public\.rasmalai_realtime_rematch_action[\s\S]*TO prisma/);
  assert.match(rematchMigration, /CREATE UNIQUE INDEX rematch_requests_one_pending_per_match[\s\S]*WHERE status = 'PENDING'/);
});

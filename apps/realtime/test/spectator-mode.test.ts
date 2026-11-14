import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server, Socket } from "socket.io";
import { isFeatureFlagEnabled, SPECTATOR_MODE_DISABLED_MESSAGE } from "@rasmalai/game-engine/feature-flags";
import { registerGameRoomSocket } from "../src/game-room-socket.js";

const roomId = "c31aa111-5d0b-4e12-9a80-82db9ec88f03";
const userId = "e21aa111-5d0b-4e12-9a80-82db9ec88f03";

function makeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const events: Array<{ event: string; payload: unknown }> = [];
  const left: string[] = [];
  const socket = {
    data: { userId, supabaseAccessToken: "verified-test-token", spectatorRoomIds: new Set<string>(), eventWindows: new Map() },
    on(event: string, handler: (...args: unknown[]) => unknown) { handlers.set(event, handler); return this; },
    emit(event: string, payload: unknown) { events.push({ event, payload }); return this; },
    async join() {},
    async leave(channel: string) { left.push(channel); },
    to() { return { emit() {} }; },
  } as unknown as Socket;
  return { socket, handlers, events, left };
}

const noBroadcastIo = {
  to() { return { emit() {} }; },
  in() { return { async fetchSockets() { return []; } }; },
} as unknown as Server;

test("spectator feature flag is opt-in and defaults to disabled", () => {
  assert.equal(isFeatureFlagEnabled(undefined), false);
  assert.equal(isFeatureFlagEnabled(""), false);
  assert.equal(isFeatureFlagEnabled("false"), false);
  assert.equal(isFeatureFlagEnabled("TRUE"), true);
  assert.equal(isFeatureFlagEnabled(" true "), true);
  assert.equal(isFeatureFlagEnabled("1"), false);
});

test("disabled spectator sockets reject listing, joins, invitations, chat, and reactions", async () => {
  const { socket, handlers } = makeSocket();
  let sharedLimitChecks = 0;
  let membershipChecks = 0;
  registerGameRoomSocket(noBroadcastIo, socket, {
    spectatorModeEnabled: () => false,
    checkSharedLimit: async () => { sharedLimitChecks += 1; return true; },
    verifyRoomMembership: async () => { membershipChecks += 1; return { access: null, denial: "not_a_member" }; },
  });

  const attempts: Array<[string, unknown]> = [
    ["spectator:list", undefined],
    ["spectator:join", roomId],
    ["spectator:invite-info", roomId],
    ["spectator:accept", roomId],
    ["spectator:invite", { roomId, username: "player_name" }],
    ["spectator:invites", roomId],
    ["spectator:revoke", { roomId, inviteId: roomId }],
    ["spectator:chat:send", { roomId, body: "not available" }],
    ["spectator:chat:react", { roomId, messageId: roomId, emoji: "👏" }],
  ];

  for (const [event, payload] of attempts) {
    const result = await new Promise<Record<string, unknown>>((resolve) => {
      const handler = handlers.get(event);
      assert.ok(handler, `registered ${event}`);
      if (event === "spectator:list") void handler(resolve);
      else void handler(payload, resolve);
    });
    assert.equal(result.ok, false, `${event} must be rejected`);
    assert.equal(result.error, SPECTATOR_MODE_DISABLED_MESSAGE, `${event} should return the safe launch message`);
  }

  assert.equal(sharedLimitChecks, 0, "disabled requests do not reach spectator RPC or quota work");
  assert.equal(membershipChecks, 0, "disabled requests do not perform membership lookups");
});

test("an already-connected spectator is removed on heartbeat as soon as the flag is disabled", async () => {
  const { socket, handlers, events, left } = makeSocket();
  const spectatorRooms = (socket.data as { spectatorRoomIds: Set<string> }).spectatorRoomIds;
  spectatorRooms.add(roomId);
  let enabled = true;
  registerGameRoomSocket(noBroadcastIo, socket, { spectatorModeEnabled: () => enabled });
  enabled = false;

  await handlers.get("spectator:heartbeat")?.();

  assert.deepEqual(left, [`spectator:${roomId}`]);
  assert.equal(spectatorRooms.size, 0);
  assert.deepEqual(events.find((entry) => entry.event === "spectator:disabled")?.payload, {
    roomId,
    message: SPECTATOR_MODE_DISABLED_MESSAGE,
  });
});

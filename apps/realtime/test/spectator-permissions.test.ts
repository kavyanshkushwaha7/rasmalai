import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Server, Socket } from "socket.io";
import { registerGameRoomSocket } from "../src/game-room-socket.js";

const userId = "e21aa111-5d0b-4e12-9a80-82db9ec88f03";
const roomId = "c31aa111-5d0b-4e12-9a80-82db9ec88f03";
const accessToken = "a-long-enough-verified-test-access-token";
const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
  else process.env.SUPABASE_PUBLISHABLE_KEY = originalKey;
});

function mockSocket() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const events: Array<{ name: string; payload: unknown }> = [];
  const socket = {
    data: { userId, supabaseAccessToken: accessToken, spectatorRoomIds: new Set([roomId]) },
    on(name: string, handler: (...args: unknown[]) => unknown) { handlers.set(name, handler); return this; },
    emit(name: string, payload: unknown) { events.push({ name, payload }); return this; },
    join() { return Promise.resolve(); },
    leave() { return Promise.resolve(); },
    to() { return { emit() {} }; },
  } as unknown as Socket;
  return { socket, handlers, events };
}

async function invoke(handler: ((...args: unknown[]) => unknown) | undefined, ...args: unknown[]) {
  assert.ok(handler);
  return await handler(...args);
}

test("a spectator cannot use player game actions, private chat, or voice authorization", async () => {
  process.env.SUPABASE_URL = "https://project.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    if (url.pathname.endsWith("/rpc/rasmalai_consume_rate_limit")) return Response.json([{ result: true }]);
    if (url.pathname.endsWith("/room_players")) return Response.json([]);
    if (url.pathname.endsWith("/spectators")) return Response.json([{ id: "active-spectator-row" }]);
    return Response.json([], { status: 404 });
  }) as typeof fetch;

  const { socket, handlers } = mockSocket();
  registerGameRoomSocket({} as Server, socket, { checkSharedLimit: async () => true });

  const gameAction = new Promise<Record<string, unknown>>((resolve) => {
    void invoke(handlers.get("game:action"), {
      roomId, version: 0, actionId: "a21aa111-5d0b-4e12-9a80-82db9ec88f03", action: { type: "roll" },
    }, resolve);
  });
  const actionResult = await gameAction;
  assert.equal(actionResult.ok, false);
  assert.match(String(actionResult.error), /Only room players can make a move/);

  const privateChat = new Promise<Record<string, unknown>>((resolve) => {
    void invoke(handlers.get("chat:send"), { roomId, body: "spectator must not reach player chat" }, resolve);
  });
  const chatResult = await privateChat;
  assert.equal(chatResult.ok, false);
  assert.match(String(chatResult.error), /available only to current players/);

  const voice = new Promise<Record<string, unknown>>((resolve) => {
    void invoke(handlers.get("voice:authorize"), roomId, resolve);
  });
  const voiceResult = await voice;
  assert.equal(voiceResult.ok, false);
  assert.match(String(voiceResult.error), /Only match players can join voice chat/);

  const matchReaction = new Promise<Record<string, unknown>>((resolve) => {
    void invoke(handlers.get("match:reaction"), { roomId, emoji: "🎉" }, resolve);
  });
  const reactionResult = await matchReaction;
  assert.equal(reactionResult.ok, false);
  assert.match(String(reactionResult.error), /Only match players can react to the game/);
});

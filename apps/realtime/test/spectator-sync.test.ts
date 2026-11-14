import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server, Socket } from "socket.io";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";
import { syncSnapshot } from "../src/game-room-socket.js";

const roomId = "c31aa111-5d0b-4e12-9a80-82db9ec88f03";
const playerId = "e21aa111-5d0b-4e12-9a80-82db9ec88f03";

test("authoritative room snapshots and player presence are broadcast to the spectator channel", async () => {
  const broadcasts: Array<{ channel: string; event: string; payload: unknown }> = [];
  const direct: Array<{ event: string; payload: unknown }> = [];
  const socket = {
    data: { userId: playerId, supabaseAccessToken: "test-token" },
    emit(event: string, payload: unknown) { direct.push({ event, payload }); },
  } as unknown as Parameters<typeof syncSnapshot>[1] & Socket;
  const io = {
    to(channel: string) {
      return { emit(event: string, payload: unknown) { broadcasts.push({ channel, event, payload }); } };
    },
    in() {
      return { async fetchSockets() { return [{ data: { userId: playerId } }]; } };
    },
  } as unknown as Server;
  const snapshot: OnlineRoomSnapshot = {
    roomId,
    roomCode: "WATCH123",
    gameType: "TIC_TAC_TOE",
    visibility: "PUBLIC",
    status: "IN_PROGRESS",
    creatorId: playerId,
    maxPlayers: 2,
    matchId: "d31aa111-5d0b-4e12-9a80-82db9ec88f03",
    version: 4,
    state: null,
    players: [{ profileId: playerId, seatIndex: 0, name: "Player one", avatarUrl: null, connected: true }],
    spectatorCount: 2,
  };

  await syncSnapshot(io, socket, snapshot, () => true);

  assert.ok(broadcasts.some((event) => event.channel === `game:${roomId}` && event.event === "room:snapshot" && event.payload === snapshot));
  const spectatorSnapshot = broadcasts.find((event) => event.channel === `spectator:${roomId}` && event.event === "room:snapshot")?.payload;
  assert.deepEqual(spectatorSnapshot, { ...snapshot, rematch: null });
  const spectatorPresence = broadcasts.find((event) => event.channel === `spectator:${roomId}` && event.event === "room:presence");
  assert.deepEqual(spectatorPresence?.payload, { roomId, connectedPlayerIds: [playerId] });
  assert.ok(direct.some((event) => event.event === "room:snapshot" && event.payload === snapshot));
});

test("spectator snapshots omit private rematch consent state", async () => {
  const broadcasts: Array<{ channel: string; event: string; payload: unknown }> = [];
  const socket = { data: { userId: playerId }, emit() {} } as unknown as Parameters<typeof syncSnapshot>[1] & Socket;
  const io = {
    to(channel: string) { return { emit(event: string, payload: unknown) { broadcasts.push({ channel, event, payload }); } }; },
    in() { return { async fetchSockets() { return []; } }; },
  } as unknown as Server;
  const snapshot: OnlineRoomSnapshot = {
    roomId, roomCode: "WATCH123", gameType: "TIC_TAC_TOE", visibility: "PUBLIC", status: "COMPLETED",
    creatorId: playerId, maxPlayers: 2, matchId: null, version: 1, state: null,
    players: [], rematch: { requestId: "f31aa111-5d0b-4e12-9a80-82db9ec88f03", previousMatchId: "d31aa111-5d0b-4e12-9a80-82db9ec88f03", requesterId: playerId, status: "PENDING", acceptedPlayerIds: [playerId], requiredPlayers: 2 },
  };
  await syncSnapshot(io, socket, snapshot, () => true);
  const spectatorEvent = broadcasts.find((entry) => entry.channel === `spectator:${roomId}` && entry.event === "room:snapshot");
  assert.deepEqual((spectatorEvent?.payload as OnlineRoomSnapshot).rematch, null);
});

test("disabled spectator mode evicts existing viewers and never broadcasts player snapshots to them", async () => {
  const broadcasts: Array<{ channel: string; event: string; payload: unknown }> = [];
  const watcherEvents: Array<{ event: string; payload: unknown }> = [];
  const leftChannels: string[] = [];
  const watcher = {
    data: { userId: "spectator-user", spectatorRoomIds: new Set([roomId]) },
    emit(event: string, payload: unknown) { watcherEvents.push({ event, payload }); },
    async leave(channel: string) { leftChannels.push(channel); },
  };
  let spectatorSockets = [watcher];
  const playerSocket = {
    data: { userId: playerId, supabaseAccessToken: "test-token" },
    emit(event: string, payload: unknown) { broadcasts.push({ channel: "direct", event, payload }); },
  } as unknown as Parameters<typeof syncSnapshot>[1] & Socket;
  const io = {
    to(channel: string) {
      return { emit(event: string, payload: unknown) { broadcasts.push({ channel, event, payload }); } };
    },
    in(channel: string) {
      return {
        async fetchSockets() {
          if (channel === `spectator:${roomId}`) {
            const current = spectatorSockets;
            spectatorSockets = [];
            return current;
          }
          if (channel === `game:${roomId}`) return [{ data: { userId: playerId } }];
          return [];
        },
      };
    },
  } as unknown as Server;
  const snapshot: OnlineRoomSnapshot = {
    roomId, roomCode: "WATCH123", gameType: "SNAKES_AND_LADDERS", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: playerId, maxPlayers: 2, matchId: "d31aa111-5d0b-4e12-9a80-82db9ec88f03", version: 5, state: null,
    players: [{ profileId: playerId, seatIndex: 0, name: "Player one", avatarUrl: null, connected: true }],
  };

  await syncSnapshot(io, playerSocket, snapshot, () => false);

  assert.ok(broadcasts.some((entry) => entry.channel === `game:${roomId}` && entry.event === "room:snapshot"));
  assert.ok(!broadcasts.some((entry) => entry.channel === `spectator:${roomId}`));
  assert.ok(watcherEvents.some((entry) => entry.event === "spectator:disabled" && (entry.payload as { message?: string }).message === "Spectator Mode is coming soon."));
  assert.deepEqual(leftChannels, [`spectator:${roomId}`]);
  assert.equal(watcher.data.spectatorRoomIds.size, 0);
});

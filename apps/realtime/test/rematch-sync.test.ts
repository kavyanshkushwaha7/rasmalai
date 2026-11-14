import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server, Socket } from "socket.io";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";
import { syncSnapshot } from "../src/game-room-socket.js";

test("rematch request snapshots broadcast to every player and the requester", async () => {
  const roomId = "e21aa111-5d0b-4e12-9a80-82db9ec88f03";
  const requesterId = "a21aa111-5d0b-4e12-9a80-82db9ec88f03";
  const snapshot: OnlineRoomSnapshot = {
    roomId,
    roomCode: "T3STROOM",
    gameType: "TIC_TAC_TOE",
    visibility: "PUBLIC",
    status: "COMPLETED",
    creatorId: requesterId,
    maxPlayers: 2,
    matchId: "f21aa111-5d0b-4e12-9a80-82db9ec88f03",
    startingSeat: 0,
    rematch: { requestId: "d21aa111-5d0b-4e12-9a80-82db9ec88f03", previousMatchId: "f21aa111-5d0b-4e12-9a80-82db9ec88f03", requesterId, status: "PENDING", acceptedPlayerIds: [requesterId], requiredPlayers: 2 },
    version: 5,
    state: null,
    players: [],
  };
  const events: Array<{ channel?: string; event: string; payload: unknown }> = [];
  const io = {
    to: (channel: string) => ({ emit: (event: string, payload: unknown) => events.push({ channel, event, payload }) }),
    in: () => ({ fetchSockets: async () => [{ data: { userId: requesterId } }] }),
  } as unknown as Server;
  const direct: Array<{ event: string; payload: unknown }> = [];
  const socket = { data: { userId: requesterId }, emit: (event: string, payload: unknown) => direct.push({ event, payload }) } as unknown as Socket;

  await syncSnapshot(io, socket, snapshot, () => true);

  assert.ok(events.some((entry) => entry.channel === `game:${roomId}` && entry.event === "room:snapshot" && entry.payload === snapshot));
  assert.ok(direct.some((entry) => entry.event === "room:snapshot" && entry.payload === snapshot));
});

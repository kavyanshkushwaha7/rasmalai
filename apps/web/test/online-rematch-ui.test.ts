import assert from "node:assert/strict";
import { test } from "node:test";
import type { OnlineGameType, OnlineRoomSnapshot } from "@rasmalai/game-engine/online";
import { getOnlineRematchPanelState } from "../lib/online-rematch.js";

const playerA = "a21aa111-5d0b-4e12-9a80-82db9ec88f03";
const playerB = "b21aa111-5d0b-4e12-9a80-82db9ec88f03";

function completedRoom(gameType: OnlineGameType, playerCount: number): OnlineRoomSnapshot {
  return {
    roomId: "e21aa111-5d0b-4e12-9a80-82db9ec88f03",
    roomCode: "T3STROOM",
    gameType,
    visibility: "PUBLIC",
    status: "COMPLETED",
    creatorId: playerA,
    maxPlayers: playerCount,
    matchId: "f21aa111-5d0b-4e12-9a80-82db9ec88f03",
    startingSeat: 0,
    rematch: null,
    version: 5,
    state: null,
    players: Array.from({ length: playerCount }, (_, seatIndex) => ({
      profileId: seatIndex === 0 ? playerA : seatIndex === 1 ? playerB : `${seatIndex}21aa1111-5d0b-4e12-9a80-82db9ec88f03`,
      seatIndex,
      name: `Player ${seatIndex + 1}`,
      avatarUrl: null,
      connected: true,
    })),
  };
}

test("completed match snapshots show Play Again for every online game after a page refresh", () => {
  const games: Array<[OnlineGameType, number]> = [["TIC_TAC_TOE", 2], ["LUDO", 4], ["SNAKES_AND_LADDERS", 3]];
  for (const [gameType, playerCount] of games) {
    const state = getOnlineRematchPanelState(completedRoom(gameType, playerCount), playerA);
    assert.deepEqual(state, { type: "request", wasDeclined: false }, gameType);
  }
});

test("a pending request gives an unvoted player accept and decline state and the requester waiting state", () => {
  const room = completedRoom("TIC_TAC_TOE", 2);
  room.rematch = {
    requestId: "d21aa111-5d0b-4e12-9a80-82db9ec88f03",
    previousMatchId: room.matchId!,
    requesterId: playerA,
    status: "PENDING",
    acceptedPlayerIds: [playerA],
    requiredPlayers: 2,
  };
  assert.deepEqual(getOnlineRematchPanelState(room, playerB), { type: "respond", rematch: room.rematch });
  assert.deepEqual(getOnlineRematchPanelState(room, playerA), { type: "waiting", rematch: room.rematch });
});

test("declined requests return Play Again and incomplete or active rooms hide rematch controls", () => {
  const room = completedRoom("TIC_TAC_TOE", 2);
  room.rematch = {
    requestId: "d21aa111-5d0b-4e12-9a80-82db9ec88f03",
    previousMatchId: room.matchId!,
    requesterId: playerA,
    status: "DECLINED",
    acceptedPlayerIds: [playerA],
    requiredPlayers: 2,
  };
  assert.deepEqual(getOnlineRematchPanelState(room, playerA), { type: "request", wasDeclined: true });
  room.status = "IN_PROGRESS";
  assert.equal(getOnlineRematchPanelState(room, playerA), null);
  room.status = "COMPLETED";
  room.matchId = null;
  assert.equal(getOnlineRematchPanelState(room, playerA), null);
});

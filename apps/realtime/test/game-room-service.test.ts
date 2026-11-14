import assert from "node:assert/strict";
import { test } from "node:test";
import { getLudoTrackIndex, type LudoState } from "@rasmalai/game-engine/ludo";
import type { OnlineGameType, OnlinePlayer, OnlineRoomSnapshot } from "@rasmalai/game-engine/online";
import { applyAuthoritativeGameAction, createOnlineGameState } from "../src/game-room-service.js";

const ids = [
  "a21aa111-5d0b-4e12-9a80-82db9ec88f03",
  "b21aa111-5d0b-4e12-9a80-82db9ec88f03",
  "c21aa111-5d0b-4e12-9a80-82db9ec88f03",
  "d21aa111-5d0b-4e12-9a80-82db9ec88f03",
];

function players(count: number): OnlinePlayer[] {
  return ids.slice(0, count).map((profileId, seatIndex) => ({ profileId, seatIndex, name: `Player ${seatIndex + 1}`, avatarUrl: null, connected: true }));
}

function room(gameType: OnlineGameType, roster = players(gameType === "TIC_TAC_TOE" ? 2 : 4)): OnlineRoomSnapshot {
  return {
    roomId: "e21aa111-5d0b-4e12-9a80-82db9ec88f03",
    roomCode: "T3STROOM",
    gameType,
    visibility: "PUBLIC",
    status: "IN_PROGRESS",
    creatorId: roster[0].profileId,
    maxPlayers: roster.length,
    matchId: "f21aa111-5d0b-4e12-9a80-82db9ec88f03",
    version: 0,
    state: createOnlineGameState(gameType, roster),
    players: roster,
  };
}

test("online Ludo uses seat order, six launch and the shared color routes", () => {
  const table = room("LUDO");
  for (let seat = 0; seat < 4; seat += 1) {
    const current = { ...table, state: { ...table.state! , turnIndex: seat } as LudoState };
    const rolled = applyAuthoritativeGameAction(current, ids[seat], { type: "roll" }, () => 6, "validated-roll-action");
    assert.equal((rolled.state as LudoState).pendingRoll, 6);
    assert.deepEqual((rolled.state as LudoState).lastRoll, { actionId: "validated-roll-action", value: 6 });
    const launched = applyAuthoritativeGameAction({ ...current, state: rolled.state, version: 1 }, ids[seat], { type: "move", tokenIndex: 0 }, () => 2);
    const ludo = launched.state as LudoState;
    assert.equal(getLudoTrackIndex(ludo.players[seat], 0), ludo.players[seat].startIndex);
    assert.equal(ludo.players[seat].tokens[0], 0);
  }
});

test("online Ludo persists each server-validated no-move die and action identity", () => {
  const table = room("LUDO");
  for (let die = 1; die <= 5; die += 1) {
    const result = applyAuthoritativeGameAction(table, ids[0], { type: "roll" }, () => die, `no-move-${die}`);
    const state = result.state as LudoState;
    assert.equal(state.pendingRoll, null);
    assert.equal(state.turnIndex, 1, `roll ${die} passes the turn using the existing rule`);
    assert.deepEqual(state.lastRoll, { actionId: `no-move-${die}`, value: die }, `roll ${die} remains displayable on every room snapshot`);
  }
});

test("online Ludo honors the selected token when all four are already out", () => {
  const base = room("LUDO");
  const original = base.state as LudoState;
  for (let seat = 0; seat < 4; seat += 1) {
    for (let selected = 0; selected < 4; selected += 1) {
      const active = { ...original.players[seat], tokens: [0, 4, 9, 14] };
      const state: LudoState = { ...original, turnIndex: seat, pendingRoll: 2, players: original.players.map((entry, index) => index === seat ? active : { ...entry, tokens: [-1, -1, -1, -1] }) };
      const applied = applyAuthoritativeGameAction({ ...base, version: 3, state }, ids[seat], { type: "move", tokenIndex: selected });
      const expected = [0, 4, 9, 14];
      expected[selected] += 2;
      assert.deepEqual((applied.state as LudoState).players[seat].tokens, expected, `seat ${seat}, token ${selected}`);
      assert.throws(() => applyAuthoritativeGameAction({ ...base, state }, ids[(seat + 1) % 4], { type: "move", tokenIndex: selected }), /not your turn/);
    }
  }
});

test("the online service injects its server die and rejects actions from other seats", () => {
  const table = room("SNAKES_AND_LADDERS", players(2));
  let calls = 0;
  const result = applyAuthoritativeGameAction(table, ids[0], { type: "roll" }, () => { calls += 1; return 4; });
  assert.equal(calls, 1);
  assert.deepEqual(result.action, { type: "roll", die: 4 });
  assert.equal((result.state as { players: Array<{ position: number }> }).players[0].position, 4);
  assert.throws(() => applyAuthoritativeGameAction(table, ids[1], { type: "roll" }, () => 6), /not your turn/);
});

test("online Tic Tac Toe shares the engine's legal move and winner rules", () => {
  let table = room("TIC_TAC_TOE", players(2));
  const actions = [0, 3, 1, 4, 2];
  for (const cell of actions) {
    const actor = table.players[(table.state as { turnIndex: number }).turnIndex];
    const applied = applyAuthoritativeGameAction(table, actor.profileId, { type: "move", cell });
    table = { ...table, state: applied.state, version: (table.version ?? 0) + 1 };
  }
  assert.equal((table.state as { winnerIndex: number | null }).winnerIndex, 0);
  assert.throws(() => applyAuthoritativeGameAction(table, ids[0], { type: "move", cell: 8 }), /round is over/);
});

test("rematch starting seats alternate for every online game and Tic Tac Toe assigns X fairly", () => {
  const tttPlayers = players(2);
  const first = createOnlineGameState("TIC_TAC_TOE", tttPlayers, 0) as import("@rasmalai/game-engine/tic-tac-toe").TicTacToeState;
  const second = createOnlineGameState("TIC_TAC_TOE", tttPlayers, 1) as import("@rasmalai/game-engine/tic-tac-toe").TicTacToeState;
  assert.equal(first.turnIndex, 0);
  assert.equal(first.xPlayerIndex, 0);
  assert.equal(second.turnIndex, 1);
  assert.equal(second.xPlayerIndex, 1);
  assert.deepEqual(second.board, Array(9).fill(null));

  let table = room("TIC_TAC_TOE", tttPlayers);
  table = { ...table, state: second };
  for (const cell of [0, 3, 1, 4, 2]) {
    const state = table.state as import("@rasmalai/game-engine/tic-tac-toe").TicTacToeState;
    const actor = table.players[state.turnIndex];
    const applied = applyAuthoritativeGameAction(table, actor.profileId, { type: "move", cell });
    table = { ...table, state: applied.state, version: (table.version ?? 0) + 1 };
  }
  const won = table.state as import("@rasmalai/game-engine/tic-tac-toe").TicTacToeState;
  assert.equal(won.winnerIndex, 1);
  assert.deepEqual(won.board.slice(0, 3), ["X", "X", "X"]);

  for (const type of ["LUDO", "SNAKES_AND_LADDERS"] as const) {
    const count = type === "LUDO" ? 4 : 3;
    const state = createOnlineGameState(type, players(count), 2) as { turnIndex: number; winnerIndex: number | null };
    assert.equal(state.turnIndex, 2, `${type} starts the next round at the next seat`);
    assert.equal(state.winnerIndex, null);
  }
  assert.throws(() => createOnlineGameState("TIC_TAC_TOE", tttPlayers, 2), /outside the room roster/);
});

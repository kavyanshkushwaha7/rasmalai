import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OnlineGameBoards } from "../components/games/OnlineGameBoards.js";
import { DiceFace } from "../components/games/DiceFace.js";
import { createLudoGame, moveLudoToken, rollLudoDie } from "../lib/games/ludo.js";
import { createSnakesAndLaddersGame, rollSnakesAndLadders } from "../lib/games/snakes-and-ladders.js";
import { getValidatedOnlineMoveAnimation } from "../lib/games/online-move-animation.js";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";

function roomPlayers(names: string[]) {
  return names.map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true }));
}

test("both player identities render the online Snakes mover overlay above the final snapshot", () => {
  const names = ["A", "B"];
  const players = roomPlayers(names);
  const initial = createSnakesAndLaddersGame(names);
  const next: OnlineRoomSnapshot = {
    roomId: "room-1", roomCode: "ABCD", gameType: "SNAKES_AND_LADDERS", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: "user-0", maxPlayers: 2, matchId: "match-1", version: 1, state: rollSnakesAndLadders(initial, 4), players,
  };
  const previous: OnlineRoomSnapshot = { ...next, version: 0, state: initial };
  const event = getValidatedOnlineMoveAnimation(previous, next);
  assert.ok(event);
  const renderFor = (userId: string) => renderToStaticMarkup(createElement(OnlineGameBoards, {
    room: next, userId, onAction: () => {}, moveAnimations: [event], onMoveAnimationComplete: () => {},
  }));
  const actor = renderFor("user-0");
  const opponent = renderFor("user-1");
  for (const html of [actor, opponent]) {
    assert.match(html, /class="[^"]*snakes-moving-token/);
    assert.match(html, /data-motion-count="4"/);
    assert.match(html, /data-motion-player="0"/);
    assert.match(html, /jester-coin-art--red/);
    assert.doesNotMatch(html, /<animateMotion/);
    assert.equal(html.includes('class="snakes-static-token is-current"'), false, "the final snapshot token is suppressed while the mover is sequenced");
  }
});

test("the dice component renders the exact pip layout and accessible result for all six faces", () => {
  const expected = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
  for (let value = 1; value <= 6; value += 1) {
    const html = renderToStaticMarkup(createElement(DiceFace, { value }));
    const visibleSlots = [...html.matchAll(/<i class="dice-pip is-visible" data-pip-index="(\d+)"/g)].map((match) => Number(match[1]));
    assert.equal(visibleSlots.length, value, `face ${value} has ${value} pips`);
    assert.deepEqual(visibleSlots, expected[value - 1], `face ${value} uses the correct pip positions`);
    assert.match(html, new RegExp(`aria-label="Die shows ${value}"`));
    assert.match(html, /data-dice-state="result"/);
    assert.match(html, new RegExp(`<b class="dice-face-number" aria-hidden="true">${value}<\\/b>`), `face ${value} shows a readable number as well as its pips`);
  }
});

test("idle and rolling dice use a neutral icon without displaying a fabricated result", () => {
  const idle = renderToStaticMarkup(createElement(DiceFace, { value: null }));
  const rolling = renderToStaticMarkup(createElement(DiceFace, { value: 5, rolling: true, animationId: "validated-roll-1" }));
  assert.match(idle, /data-dice-state="idle"/);
  assert.match(idle, /class="game-dice-idle-icon"/);
  assert.doesNotMatch(idle, /is-visible/);
  assert.match(rolling, /data-dice-state="rolling"/);
  assert.match(rolling, /Die rolling; result pending/);
  assert.match(rolling, /class="game-dice-idle-icon"/);
  assert.doesNotMatch(rolling, /is-visible/);
});

test("online dice labels and turn messages distinguish the current player from opponents", () => {
  const ludoNames = ["Paras", "Asha", "Mina", "Dev"];
  const ludoPlayers = roomPlayers(ludoNames);
  const ludo: OnlineRoomSnapshot = {
    roomId: "dice-ludo", roomCode: "LUDO", gameType: "LUDO", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: "user-0", maxPlayers: 4, matchId: "ludo-match", version: 0, state: createLudoGame(ludoNames), players: ludoPlayers,
  };
  const snakesNames = ["Paras", "Asha"];
  const snakes: OnlineRoomSnapshot = {
    roomId: "dice-snakes", roomCode: "SNAK", gameType: "SNAKES_AND_LADDERS", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: "user-0", maxPlayers: 2, matchId: "snakes-match", version: 0, state: createSnakesAndLaddersGame(snakesNames), players: roomPlayers(snakesNames),
  };

  for (const room of [ludo, snakes]) {
    const active = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: "user-0", onAction: () => {} }));
    const waiting = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: "user-1", onAction: () => {} }));
    assert.match(active, /Your turn — Roll the dice!/);
    assert.match(active, /Roll Dice/);
    assert.doesNotMatch(active, /Roll server dice/);
    assert.doesNotMatch(active, /server dice/i);
    assert.match(waiting, /Waiting for Paras to roll\./);
    assert.match(waiting, /Roll Dice/);
    assert.match(waiting, /class="button (?:ludo-roll-button|snakes-roll-button)[^"]*" type="button" disabled=""/);
  }
});

test("online Ludo shows a validated no-legal-move die result, then hides stale turn feedback after refresh", () => {
  const names = ["Paras", "Asha", "Mina", "Dev"];
  const players = roomPlayers(names);
  const initial = createLudoGame(names);
  const afterRoll = rollLudoDie(initial, 4, "no-move-roll-action");
  const room: OnlineRoomSnapshot = {
    roomId: "ludo-no-move", roomCode: "NOMV", gameType: "LUDO", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: "user-0", maxPlayers: 4, matchId: "no-move-match", version: 5, state: afterRoll, players,
  };
  const cue = { id: "no-move-match:5:dice", gameType: "LUDO" as const, value: 4, noLegalMove: true };
  const withFreshResult = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: "user-1", onAction: () => {}, diceRollResult: cue }));
  assert.match(withFreshResult, /aria-label="Die shows 4"/);
  assert.equal([...withFreshResult.matchAll(/class="dice-pip is-visible"/g)].length, 4, "the exact four-pip face is visible after the short roll animation ends");
  assert.match(withFreshResult, /Rolled 4 · no legal move/);
  assert.match(withFreshResult, /No legal move\. The turn passes\./);
  assert.match(withFreshResult, /Your turn — Roll the dice!/);
  assert.match(withFreshResult, /Roll Dice/);
  assert.doesNotMatch(withFreshResult, /Roll Again/, "the next player receives the normal roll control after the turn passes");
  for (let seat = 0; seat < 4; seat += 1) {
    const view = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: `user-${seat}`, onAction: () => {}, diceRollResult: cue }));
    assert.match(view, /aria-label="Die shows 4"/, `seat ${seat} sees the validated four`);
    assert.equal([...view.matchAll(/class="dice-pip is-visible"/g)].length, 4, `seat ${seat} sees four pips`);
    if (seat === 1) assert.match(view, /Your turn — Roll the dice!/);
    else assert.match(view, /Waiting for Asha to roll\./, `seat ${seat} sees the correct next turn`);
  }

  const afterRefresh = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: "user-1", onAction: () => {} }));
  assert.match(afterRefresh, /aria-label="Die ready to roll"/);
  assert.doesNotMatch(afterRefresh, /No legal move\. The turn passes\./, "refreshing does not replay the prior result or show stale feedback");
  assert.match(afterRefresh, /Your turn — Roll the dice!/);
});

test("a no-legal six keeps the same Ludo player and offers Roll Again only to that player", () => {
  const names = ["Paras", "Asha", "Mina", "Dev"];
  const players = roomPlayers(names);
  const initial = createLudoGame(names);
  const nearHome = { ...initial, players: initial.players.map((player) => ({ ...player, tokens: [54, 54, 54, 54] })) };
  const afterRoll = rollLudoDie(nearHome, 6, "near-home-six");
  const room: OnlineRoomSnapshot = {
    roomId: "ludo-no-legal-six", roomCode: "SIX6", gameType: "LUDO", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: "user-0", maxPlayers: 4, matchId: "no-legal-six-match", version: 3, state: afterRoll, players,
  };
  assert.equal(afterRoll.turnIndex, 0);
  const active = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: "user-0", onAction: () => {}, diceRollResult: { id: "no-legal-six-match:3:dice", gameType: "LUDO", value: 6, noLegalMove: true } }));
  const other = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: "user-1", onAction: () => {}, diceRollResult: { id: "no-legal-six-match:3:dice", gameType: "LUDO", value: 6, noLegalMove: true } }));
  assert.match(active, /Roll Again/);
  assert.doesNotMatch(other, /Roll Again/);
  assert.match(other, /Waiting for Paras to roll\./);
});

test("online Ludo makes connection loss and pending rolls visible and prevents duplicate roll taps", () => {
  const names = ["Paras", "Asha", "Mina", "Dev"];
  const room: OnlineRoomSnapshot = {
    roomId: "ludo-roll-state", roomCode: "ROLL", gameType: "LUDO", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: "user-0", maxPlayers: 4, matchId: "roll-state-match", version: 0, state: createLudoGame(names), players: roomPlayers(names),
  };
  const disconnected = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: "user-0", onAction: () => {}, realtimeConnected: false }));
  assert.match(disconnected, /Not connected — tap Retry connection before rolling\./);
  assert.match(disconnected, /Retry connection/);
  assert.match(disconnected, /class="button ludo-roll-button[^\"]*" type="button" disabled=""/);

  const pending = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: "user-0", onAction: () => {}, actionBusy: true, pendingActionType: "roll", diceRollAnimationId: "request-roll" }));
  assert.match(pending, /class="button ludo-roll-button[^\"]*" type="button" disabled=""/);
  assert.match(pending, /Rolling…/);
  assert.doesNotMatch(pending, /Your turn — Roll the dice!/);

  const retry = renderToStaticMarkup(createElement(OnlineGameBoards, { room, userId: "user-0", onAction: () => {}, rollRetryAvailable: true }));
  assert.match(retry, /Retry Roll/);
});

test("both Ludo client views render the same selected-token move overlay", () => {
  const names = ["A", "B", "C", "D"];
  const players = roomPlayers(names);
  const initial = createLudoGame(names);
  const beforeState = {
    ...initial,
    pendingRoll: 2,
    players: initial.players.map((player, index) => index === 0 ? { ...player, tokens: [4, 7, 12, 51] } : player),
  };
  const afterState = moveLudoToken(beforeState, 2);
  const previous: OnlineRoomSnapshot = {
    roomId: "room-2", roomCode: "EFGH", gameType: "LUDO", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: "user-0", maxPlayers: 4, matchId: "match-2", version: 8, state: beforeState, players,
  };
  const next: OnlineRoomSnapshot = { ...previous, version: 9, state: afterState };
  const event = getValidatedOnlineMoveAnimation(previous, next);
  assert.ok(event);
  const renderFor = (userId: string) => renderToStaticMarkup(createElement(OnlineGameBoards, {
    room: next, userId, onAction: () => {}, moveAnimations: [event], onMoveAnimationComplete: () => {},
  }));
  const actor = renderFor("user-0");
  const opponent = renderFor("user-3");
  for (const html of [actor, opponent]) {
    assert.match(html, /class="[^"]*ludo-moving-coin/);
    assert.match(html, /data-motion-count="2"/);
    assert.match(html, /data-motion-token="2"/);
    assert.match(html, /jester-coin-art--yellow/);
  }
});

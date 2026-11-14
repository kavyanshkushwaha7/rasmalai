import assert from "node:assert/strict";
import { test } from "node:test";
import { createTicTacToeGame, getTicTacToeWinner, getTicTacToeWinningLine, TIC_TAC_TOE_WINNING_LINES, playTicTacToeMove, type TicTacToeState } from "../lib/games/tic-tac-toe.js";
import { createSnakesAndLaddersGame, getSnakesBoardCell, LADDERS, rollSnakesAndLadders, SNAKES } from "../lib/games/snakes-and-ladders.js";
import { advanceSnakesMotion, getSnakesMoveAnimationPlan, getSnakesMovementPath, getSnakesSquarePath, getSnakesTokenPlacements } from "../lib/games/snakes-token-layout.js";
import { createLudoGame, getLegalLudoTokenIndexes, getLudoTrackIndex, isLudoSafeSquare, LUDO_COLOR_ORDER, LUDO_FINISHED, LUDO_FINISH_CELL, LUDO_HOME_LANES, LUDO_SAFE_TRACK_INDEXES, LUDO_START_INDEXES, LUDO_TRACK, LUDO_YARD_GRID, moveLudoToken, rollLudoDie, type LudoColor, type LudoPlayer, type LudoState } from "../lib/games/ludo.js";
import { getLudoCaptureReturnPoints, getLudoCapturedTokens, getLudoMoveSteps, getLudoProgressCell, getValidatedOnlineLudoMove } from "../lib/games/ludo-token-motion.js";
import { getValidatedOnlineMoveAnimation, getValidatedOnlineRollCue, getValidatedOnlineTicTacToeCue } from "../lib/games/online-move-animation.js";
import { getLadderRouteGeometry, getSnakeRouteGeometry } from "../lib/games/snakes-route-geometry.js";
import { createCueDeduper, playArcadeSound } from "../lib/games/arcade-audio.js";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";

test("Tic Tac Toe alternates legal turns and rejects occupied or out-of-range cells", () => {
  let game = createTicTacToeGame(["Ada", "Lin"]);
  assert.equal(game.turnIndex, 0);
  game = playTicTacToeMove(game, 4);
  assert.equal(game.board[4], "X");
  assert.equal(game.turnIndex, 1);
  assert.throws(() => playTicTacToeMove(game, 4), /empty square/);
  assert.throws(() => playTicTacToeMove(game, 9), /empty square/);
});

test("Tic Tac Toe resolves all eight winning line overlays for the victory animation", () => {
  for (const line of TIC_TAC_TOE_WINNING_LINES) {
    const board = Array.from({ length: 9 }, (_, index) => line.some((cell) => cell === index) ? "O" as const : null);
    assert.deepEqual(getTicTacToeWinningLine(board), line);
    assert.equal(getTicTacToeWinner(board), "O");
  }
  let game = createTicTacToeGame();
  for (const cell of [0, 3, 1, 4, 2]) game = playTicTacToeMove(game, cell);
  assert.equal(game.winnerIndex, 0);
  assert.equal(game.turnIndex, 0);
  assert.throws(() => playTicTacToeMove(game, 2), /round is over/);
});

test("Tic Tac Toe recognizes a draw with a full board", () => {
  let game = createTicTacToeGame();
  for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) game = playTicTacToeMove(game, cell);
  assert.equal(game.isDraw, true);
  assert.equal(game.winnerIndex, null);
});

test("Snakes & Ladders supports two to four players and alternates turns", () => {
  for (const count of [2, 3, 4]) assert.equal(createSnakesAndLaddersGame(Array.from({ length: count }, (_, i) => `P${i + 1}`)).players.length, count);
  assert.throws(() => createSnakesAndLaddersGame(["Solo"]), /2–4 players/);
  const start = createSnakesAndLaddersGame(["A", "B"]);
  const moved = rollSnakesAndLadders(start, 3);
  assert.equal(moved.players[0].position, 3);
  assert.equal(moved.turnIndex, 1);
  const six = rollSnakesAndLadders(start, 6);
  assert.equal(six.players[0].position, 6);
  assert.equal(six.turnIndex, 1, "six does not grant an extra turn");
});

test("Snakes & Ladders applies ladders and snakes immediately", () => {
  const start = createSnakesAndLaddersGame(["A", "B"]);
  const ladder = rollSnakesAndLadders(start, 2);
  assert.equal(ladder.players[0].position, 23);
  assert.equal(ladder.lastMove?.transport, "ladder");
  const onSnake = { ...start, players: [{ name: "A", position: 23 }, { name: "B", position: 0 }] };
  const snake = rollSnakesAndLadders(onSnake, 6);
  assert.equal(snake.players[0].position, 9);
  assert.equal(snake.lastMove?.transport, "snake");
});

test("Snakes & Ladders requires an exact finish and honors the winner lock", () => {
  const nearFinish = { ...createSnakesAndLaddersGame(["A", "B"]), players: [{ name: "A", position: 99 }, { name: "B", position: 0 }] };
  const tooFar = rollSnakesAndLadders(nearFinish, 2);
  assert.equal(tooFar.players[0].position, 99);
  assert.equal(tooFar.winnerIndex, null);
  assert.equal(tooFar.turnIndex, 1, "an overshoot still ends the turn");
  const win = rollSnakesAndLadders(nearFinish, 1);
  assert.equal(win.players[0].position, 100);
  assert.equal(win.winnerIndex, 0);
  assert.throws(() => rollSnakesAndLadders(win, 1), /game is over/);
  assert.deepEqual([getSnakesBoardCell(1), getSnakesBoardCell(10), getSnakesBoardCell(11), getSnakesBoardCell(100)], [
    { row: 9, col: 0 }, { row: 9, col: 9 }, { row: 8, col: 9 }, { row: 0, col: 0 },
  ]);
});

test("Snakes and ladders visual routes connect the configured endpoint squares", () => {
  assert.equal(Object.keys(LADDERS).length, 7);
  for (const [startText, end] of Object.entries(LADDERS)) {
    const start = Number(startText);
    assert.ok(start < end, `ladder ${start} should climb to ${end}`);
    assert.ok(getSnakesBoardCell(start));
    assert.ok(getSnakesBoardCell(end));
  }
  assert.equal(Object.keys(SNAKES).length, 8);
  for (const [headText, tail] of Object.entries(SNAKES)) {
    const head = Number(headText);
    assert.ok(head > tail, `snake head ${head} should connect down to ${tail}`);
    assert.ok(getSnakesBoardCell(head));
    assert.ok(getSnakesBoardCell(tail));
  }
});

test("Snakes & Ladders token layout keeps every player visible on a shared square", () => {
  const placements = getSnakesTokenPlacements([42, 42, 42, 42]);
  assert.equal(placements.length, 4);
  assert.deepEqual(placements.map(({ playerIndex }) => playerIndex), [0, 1, 2, 3]);
  assert.equal(new Set(placements.map(({ x, y }) => `${x},${y}`)).size, 4);
  assert.ok(placements.every(({ square, size }) => square === 42 && size > 0));
  const moving = getSnakesTokenPlacements([42, 42, 42, 42], 2);
  assert.equal(moving.length, 3);
  assert.ok(!moving.some(({ playerIndex }) => playerIndex === 2));
  assert.equal(getSnakesTokenPlacements([0, 8, 100]).length, 2, "players at start stay off-board while finished tokens remain visible");
});

test("Snakes & Ladders coin animation visits each rolled square and follows transports", () => {
  const ordinary = getSnakesMovementPath({ from: 5, rolled: 3, landed: 8, final: 34, transport: "ladder" });
  assert.ok(ordinary);
  for (const square of [5, 6, 7, 8, 34]) {
    const { row, col } = getSnakesBoardCell(square);
    assert.ok(ordinary.includes(`${col * 100 + 50} ${row * 100 + 50}`), `path includes square ${square}`);
  }
  const snake = getSnakesMovementPath({ from: 23, rolled: 6, landed: 29, final: 9, transport: "snake" });
  assert.ok(snake?.includes(" C "), "snake descent curves from its head to tail");
  assert.equal(getSnakesMovementPath({ from: 99, rolled: 2, landed: 101, final: 99, transport: null }), null, "overshoots do not animate a false move");
});

test("Snakes & Ladders animation plans expose two or six separate zigzag steps before transports", () => {
  const two = getSnakesMoveAnimationPlan({ from: 5, rolled: 2, landed: 7, final: 7, transport: null });
  assert.deepEqual(two?.steps, [6, 7]);
  assert.equal(two?.steps.map((square, index) => getSnakesSquarePath(index === 0 ? 5 : two.steps[index - 1], square)).length, 2, "a two-roll is rendered as two independent one-square paths");
  const six = getSnakesMoveAnimationPlan({ from: 23, rolled: 6, landed: 29, final: 9, transport: "snake" });
  assert.deepEqual(six?.steps, [24, 25, 26, 27, 28, 29]);
  assert.equal(six?.steps.map((square, index) => getSnakesSquarePath(index === 0 ? 23 : six.steps[index - 1], square)).length, 6, "a six-roll is rendered as six independent one-square paths");
  assert.ok(getSnakesSquarePath(10, 11).includes("950 950 L 950 850"), "the row transition follows the alternating zigzag edge");
  assert.ok(six?.transportPath?.startsWith("M "), "the snake slide is a separate second phase");
  const ladder = getSnakesMoveAnimationPlan({ from: 5, rolled: 3, landed: 8, final: 34, transport: "ladder" });
  assert.deepEqual(ladder?.steps, [6, 7, 8]);
  assert.ok(ladder?.transportPath?.includes(" L "), "the ladder climb follows all three dice steps");
  if (!ladder) throw new Error("Expected the configured ladder move to produce an animation plan.");
  const phases: string[] = [];
  let cursor: ReturnType<typeof advanceSnakesMotion> = { phase: "dice", stepIndex: 0 };
  while (cursor) {
    phases.push(`${cursor.phase}:${cursor.stepIndex + 1}`);
    cursor = advanceSnakesMotion(ladder, cursor);
  }
  assert.deepEqual(phases, ["dice:1", "dice:2", "dice:3", "transport:3"], "transport starts only after the final dice hop");
  assert.equal(advanceSnakesMotion({ steps: [6, 7], transportPath: null, transportPoints: [] }, { phase: "dice", stepIndex: 1 }), null, "ordinary moves finish after the dice steps");
  assert.equal(getSnakesMoveAnimationPlan({ from: 99, rolled: 2, landed: 101, final: 99, transport: null }), null);
  assert.equal(getSnakesMoveAnimationPlan({ from: 5, rolled: 2, landed: 7, final: 34, transport: "ladder" }), null, "inconsistent server transport claims are never animated");
  const rowSteps = [9, 10, 11, 20, 21].map((square) => getSnakesBoardCell(square).col);
  assert.deepEqual(rowSteps, [8, 9, 9, 0, 0], "successive board rows alternate direction");
});

test("snake slides and ladder climbs use the exact same route geometry as the board artwork", () => {
  const snakePlan = getSnakesMoveAnimationPlan({ from: 23, rolled: 6, landed: 29, final: 9, transport: "snake" });
  const snakeArt = getSnakeRouteGeometry(29, 9);
  assert.equal(snakePlan?.transportPath, snakeArt.path);
  assert.deepEqual(snakePlan?.transportPoints, snakeArt.points, "the coin samples the painted cubic snake centerline");
  assert.deepEqual(snakePlan?.transportPoints?.[0], { x: 850, y: 750 });
  assert.deepEqual(snakePlan?.transportPoints?.at(-1), { x: 850, y: 950 });

  const ladderPlan = getSnakesMoveAnimationPlan({ from: 5, rolled: 3, landed: 8, final: 34, transport: "ladder" });
  const ladderArt = getLadderRouteGeometry(8, 34);
  assert.equal(ladderPlan?.transportPath, ladderArt.path);
  assert.deepEqual(ladderPlan?.transportPoints, ladderArt.points, "each visible ladder rung has a matching coin climb waypoint");
  assert.equal(ladderPlan?.transportPoints.length, 10, "eight rung waypoints plus foot and top");
  assert.deepEqual(ladderPlan?.transportPoints[0], { x: 750, y: 950 });
  assert.deepEqual(ladderPlan?.transportPoints.at(-1), { x: 650, y: 650 });
});

test("passing a snake head or ladder foot during dice movement does not trigger transport", () => {
  const base = createSnakesAndLaddersGame(["A", "B"]);
  const pastSnake = { ...base, players: [{ name: "A", position: 27 }, { name: "B", position: 0 }] };
  const snakeResult = rollSnakesAndLadders(pastSnake, 3);
  assert.equal(snakeResult.lastMove?.landed, 30);
  assert.equal(snakeResult.lastMove?.transport, null, "the token crossed head 29 but landed after it");
  assert.equal(getSnakesMoveAnimationPlan(snakeResult.lastMove!)?.transportPath, null);

  const pastLadder = { ...base, players: [{ name: "A", position: 18 }, { name: "B", position: 0 }] };
  const ladderResult = rollSnakesAndLadders(pastLadder, 3);
  assert.equal(ladderResult.lastMove?.landed, 21);
  assert.equal(ladderResult.lastMove?.transport, null, "the token crossed foot 20 but landed after it");
  assert.equal(getSnakesMoveAnimationPlan(ladderResult.lastMove!)?.transportPath, null);
});

test("online move snapshots produce validated two-, six-, ladder-, and snake-step events", () => {
  const roster = (names: string[]) => names.map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true }));
  const room = (state: OnlineRoomSnapshot["state"], version: number): OnlineRoomSnapshot => ({
    roomId: "room-1", roomCode: "ABCD", gameType: "SNAKES_AND_LADDERS", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: "user-0", maxPlayers: 2, matchId: "match-1", version, state, players: roster(["A", "B"]),
  });
  const start = createSnakesAndLaddersGame(["A", "B"]);
  const two = getValidatedOnlineMoveAnimation(room(start, 0), room(rollSnakesAndLadders(start, 2), 1));
  assert.equal(two?.gameType, "SNAKES_AND_LADDERS");
  if (two?.gameType !== "SNAKES_AND_LADDERS") throw new Error("Expected a validated Snakes & Ladders event.");
  assert.deepEqual(two.steps, [1, 2]);

  const six = getValidatedOnlineMoveAnimation(room(start, 0), room(rollSnakesAndLadders(start, 6), 1));
  if (six?.gameType !== "SNAKES_AND_LADDERS") throw new Error("Expected a validated six-step event.");
  assert.deepEqual(six.steps, [1, 2, 3, 4, 5, 6]);

  const ladder = getValidatedOnlineMoveAnimation(room(start, 0), room(rollSnakesAndLadders(start, 2), 1));
  if (ladder?.gameType !== "SNAKES_AND_LADDERS") throw new Error("Expected the ladder event.");
  assert.equal(ladder.transport, "ladder");
  assert.ok(ladder.transportPath);

  const snakeStart = { ...start, players: [{ name: "A", position: 23 }, { name: "B", position: 0 }] };
  const snake = getValidatedOnlineMoveAnimation(room(snakeStart, 7), room(rollSnakesAndLadders(snakeStart, 6), 8));
  if (snake?.gameType !== "SNAKES_AND_LADDERS") throw new Error("Expected the snake event.");
  assert.deepEqual(snake.steps, [24, 25, 26, 27, 28, 29]);
  assert.equal(snake.transport, "snake");
  assert.ok(snake.transportPath);
});

test("online snapshot animation ignores initial hydration, reconnects, stale snapshots, and version gaps", () => {
  const players = ["A", "B"].map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true }));
  const state = createSnakesAndLaddersGame(["A", "B"]);
  const snapshot = (version: number, matchId = "match-1"): OnlineRoomSnapshot => ({ roomId: "room-1", roomCode: "ABCD", gameType: "SNAKES_AND_LADDERS", visibility: "PUBLIC", status: "IN_PROGRESS", creatorId: "user-0", maxPlayers: 2, matchId, version, state, players });
  const moved = { ...state, ...rollSnakesAndLadders(state, 4) };
  const next = { ...snapshot(11), state: moved };
  assert.equal(getValidatedOnlineMoveAnimation(snapshot(10), next)?.gameType, "SNAKES_AND_LADDERS");
  assert.equal(getValidatedOnlineMoveAnimation(snapshot(9), next), null, "a missed intermediate version must snap to authoritative state");
  assert.equal(getValidatedOnlineMoveAnimation(snapshot(11), next), null, "duplicate/reconnect state must not replay");
  assert.equal(getValidatedOnlineMoveAnimation(snapshot(10, "old-match"), next), null, "old match events cannot animate into a rematch");
});

test("online dice cues require a new validated server roll and duplicate cue ids are suppressed", () => {
  const roster = ["A", "B"].map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true }));
  const snakes = createSnakesAndLaddersGame(["A", "B"]);
  const makeRoom = (gameType: "SNAKES_AND_LADDERS" | "LUDO", state: OnlineRoomSnapshot["state"], version: number): OnlineRoomSnapshot => ({
    roomId: "dice-room", roomCode: "DICE", gameType, visibility: "PUBLIC", status: "IN_PROGRESS", creatorId: "user-0", maxPlayers: 2,
    matchId: "dice-match", version, state, players: roster,
  });
  const snakesBefore = makeRoom("SNAKES_AND_LADDERS", snakes, 1);
  const snakesAfter = makeRoom("SNAKES_AND_LADDERS", rollSnakesAndLadders(snakes, 4), 2);
  const snakesCue = getValidatedOnlineRollCue(snakesBefore, snakesAfter);
  assert.deepEqual(snakesCue, { id: "dice-match:2:dice", gameType: "SNAKES_AND_LADDERS", value: 4, noLegalMove: false });
  assert.equal(getValidatedOnlineRollCue(snakesAfter, snakesAfter), null, "duplicate snapshots do not retrigger the dice cue");
  assert.equal(getValidatedOnlineRollCue(snakesBefore, { ...snakesAfter, version: 3 }), null, "version gaps are not guessed as a new roll");

  const ludo = createLudoGame(["A", "B"]);
  const ludoBefore = makeRoom("LUDO", ludo, 7);
  const ludoAfter = makeRoom("LUDO", rollLudoDie(ludo, 6, "roll-six-action"), 8);
  assert.equal(getValidatedOnlineRollCue(ludoBefore, ludoAfter)?.id, "dice-match:8:dice");
  assert.deepEqual(getValidatedOnlineRollCue(ludoBefore, ludoAfter), { id: "dice-match:8:dice", gameType: "LUDO", value: 6, noLegalMove: false });

  const fourPlayerRoom = (state: LudoState, version: number): OnlineRoomSnapshot => ({
    ...makeRoom("LUDO", state, version), maxPlayers: 4,
    players: ["A", "B", "C", "D"].map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true })),
  });
  const lockedTokens = createLudoGame(["A", "B", "C", "D"]);
  for (let die = 1; die <= 5; die += 1) {
    const rolled = rollLudoDie(lockedTokens, die, `roll-${die}-action`);
    const cue = getValidatedOnlineRollCue(fourPlayerRoom(lockedTokens, 20), fourPlayerRoom(rolled, 21));
    assert.deepEqual(cue, { id: "dice-match:21:dice", gameType: "LUDO", value: die, noLegalMove: true }, `validated no-move roll ${die} retains its actual die value`);
    assert.equal(rolled.turnIndex, 1, `existing turn rule remains intact after a no-move ${die}`);
  }
  const sixUnlocks = rollLudoDie(lockedTokens, 6, "six-unlock-action");
  const sixCue = getValidatedOnlineRollCue(fourPlayerRoom(lockedTokens, 20), fourPlayerRoom(sixUnlocks, 21));
  assert.deepEqual(sixCue, { id: "dice-match:21:dice", gameType: "LUDO", value: 6, noLegalMove: false });
  assert.equal(sixUnlocks.pendingRoll, 6, "a legal six remains available for a deliberate token selection");
  const alteredDie = { ...sixUnlocks, lastRoll: { actionId: "six-unlock-action", value: 5 } };
  assert.equal(getValidatedOnlineRollCue(fourPlayerRoom(lockedTokens, 20), fourPlayerRoom(alteredDie, 21)), null, "clients reject roll metadata that does not match an engine-validated state transition");

  const acceptCue = createCueDeduper();
  const landingIds = Array.from({ length: 4 }, (_, index) => `move-1:landing:${index}`);
  assert.deepEqual(landingIds.map((id) => acceptCue(id)), [true, true, true, true]);
  assert.deepEqual(landingIds.map((id) => acceptCue(id)), [false, false, false, false], "rerenders cannot play a landing pop twice");
});

test("online Tic Tac Toe audio events require a fresh engine-validated move, win, or draw", () => {
  const players = ["A", "B"].map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true }));
  const room = (state: TicTacToeState, version: number): OnlineRoomSnapshot => ({
    roomId: "ttt-cues", roomCode: "CUES", gameType: "TIC_TAC_TOE", visibility: "PUBLIC", status: "IN_PROGRESS",
    creatorId: "user-0", maxPlayers: 2, matchId: "ttt-match", version, state, players,
  });
  let before = createTicTacToeGame(["A", "B"]);
  for (const cell of [0, 3, 1, 4]) before = playTicTacToeMove(before, cell);
  const won = playTicTacToeMove(before, 2);
  const cue = getValidatedOnlineTicTacToeCue(room(before, 12), room(won, 13));
  assert.deepEqual(cue, { id: "ttt-match:13", result: "victory" });
  assert.equal(getValidatedOnlineTicTacToeCue(room(won, 13), room(won, 13)), null, "refresh snapshots do not replay win sounds");
  assert.equal(getValidatedOnlineTicTacToeCue(room(before, 12), room(won, 14)), null, "a version gap is not guessed as a new sound event");

  let drawBefore = createTicTacToeGame(["A", "B"]);
  for (const cell of [0, 1, 2, 4, 3, 5, 7, 6]) drawBefore = playTicTacToeMove(drawBefore, cell);
  const draw = playTicTacToeMove(drawBefore, 8);
  assert.equal(getValidatedOnlineTicTacToeCue(room(drawBefore, 30), room(draw, 31))?.result, "draw");
  const invalid = { ...draw, board: [...draw.board.slice(0, 8), null] } as TicTacToeState;
  assert.equal(getValidatedOnlineTicTacToeCue(room(drawBefore, 30), room(invalid, 31)), null, "unvalidated board snapshots cannot trigger special audio");
});

test("arcade audio stays quiet while disabled and plays each pop and dice cue once", () => {
  let starts = 0;
  let createdContexts = 0;
  const popFrequencyPairs: number[][] = [];
  class FakeParam {
    constructor(private record?: (value: number) => void) {}
    setValueAtTime(value: number) { this.record?.(value); }
    linearRampToValueAtTime(value: number) { this.record?.(value); }
    exponentialRampToValueAtTime(value: number) { this.record?.(value); }
  }
  class FakeNode {
    connect() { return this; }
    start() { starts += 1; }
    stop() {}
  }
  class FakeOscillator extends FakeNode {
    type = "sine";
    frequency: FakeParam;
    constructor() { super(); this.frequency = new FakeParam((value) => { if (value === 510 || value === 260) { const current = popFrequencyPairs.at(-1); if (!current || current.length === 2) popFrequencyPairs.push([]); popFrequencyPairs.at(-1)!.push(value); } }); }
  }
  class FakeAudioContext {
    currentTime = 0;
    sampleRate = 8000;
    state = "running";
    destination = {};
    constructor() { createdContexts += 1; }
    createOscillator() { return new FakeOscillator(); }
    createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
    createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return Object.assign(new FakeNode(), { buffer: null as unknown }); }
    createBiquadFilter() { return Object.assign(new FakeNode(), { type: "lowpass", frequency: new FakeParam() }); }
  }
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let enabled = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: () => enabled ? "true" : "false" },
    AudioContext: FakeAudioContext,
  } });
  try {
    assert.equal(playArcadeSound("silent", "pop"), false);
    assert.equal(starts, 0, "sound is silent until the user enables it");
    enabled = true;
    assert.equal(playArcadeSound("move-a:landing:0", "pop"), true);
    assert.equal(playArcadeSound("move-a:landing:0", "pop"), false, "the same landing ID cannot play twice");
    assert.equal(playArcadeSound("move-a:landing:1", "pop"), true);
    assert.equal(playArcadeSound("move-a:dice", "dice"), true);
    assert.equal(playArcadeSound("move-a:dice", "dice"), false, "a duplicated roll snapshot cannot rattle twice");
    assert.equal(starts, 7, "two soft pops and one distinct dice rattle each create their expected Web Audio voices");
    const specialSounds = ["unlock", "capture", "snake", "ladder", "place", "victory", "draw"] as const;
    for (const sound of specialSounds) {
      assert.equal(playArcadeSound(`special:${sound}`, sound), true, `${sound} cue is synthesized when enabled`);
      assert.equal(playArcadeSound(`special:${sound}`, sound), false, `${sound} cue is deduped across repeated snapshots`);
    }
    assert.equal(starts, 25, "all original special effects are short synthesized Web Audio cues");
    assert.equal(createdContexts, 1);
    assert.deepEqual(popFrequencyPairs, [[510, 260], [510, 260]], "all landing pops use the identical soft tone");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as Record<string, unknown>).window;
  }
});


test("Ludo initializes the right player counts and needs a six to launch", () => {
  assert.throws(() => createLudoGame(["Solo"]), /2–4 players/);
  assert.equal(createLudoGame(["A", "B"]).players.length, 2);
  assert.equal(createLudoGame(["A", "B", "C"]).players.length, 3);
  assert.equal(createLudoGame(["A", "B", "C", "D"]).players.length, 4);
  const game = createLudoGame(["Yellow", "Red"]);
  const passed = rollLudoDie(game, 4);
  assert.equal(passed.turnIndex, 1);
  assert.deepEqual(passed.players[0].tokens, [-1, -1, -1, -1]);
});

test("Ludo launches on six, requires token selection, and grants another turn", () => {
  const game = createLudoGame(["Yellow", "Red"]);
  const rolled = rollLudoDie(game, 6);
  assert.equal(rolled.pendingRoll, 6);
  assert.deepEqual(getLegalLudoTokenIndexes(rolled), [0, 1, 2, 3]);
  assert.throws(() => rollLudoDie(rolled, 2), /Choose a token/);
  const moved = moveLudoToken(rolled, 0);
  assert.equal(moved.players[0].tokens[0], 0);
  assert.equal(moved.turnIndex, 0);
  assert.equal(moved.pendingRoll, null);
  assert.throws(() => moveLudoToken(moved, 1), /Roll the die/);
});

test("Ludo exposes every legal token outside the yard and moves only the selected token", () => {
  const base = createLudoGame(["Yellow", "Red"]);
  const player = { ...base.players[0], tokens: [3, 7, 12, 51] };
  const state: LudoState = { ...base, players: [player, base.players[1]], pendingRoll: 2 };
  assert.deepEqual(getLegalLudoTokenIndexes(state), [0, 1, 2, 3]);
  const moved = moveLudoToken(state, 2);
  assert.deepEqual(moved.players[0].tokens, [3, 7, 14, 51]);
  assert.equal(moved.turnIndex, 1);
  assert.equal(moved.pendingRoll, null);
});

test("Ludo sends opponents to the yard on unsafe squares but protects safe squares", () => {
  const base = createLudoGame(["Yellow", "Red"]);
  const safePlayers: [LudoPlayer, LudoPlayer] = [
    { ...base.players[0], tokens: [25, -1, -1, -1] },
    { ...base.players[1], tokens: [0, -1, -1, -1] },
  ];
  const safeState: LudoState = { ...base, players: safePlayers, pendingRoll: 1 };
  const safeMove = moveLudoToken(safeState, 0);
  assert.equal(getLudoTrackIndex(safeMove.players[0], 26), 26);
  assert.equal(isLudoSafeSquare(26), true);
  assert.equal(safeMove.players[1].tokens[0], 0);

  const unsafePlayers: [LudoPlayer, LudoPlayer] = [
    { ...base.players[0], tokens: [26, -1, -1, -1] },
    { ...base.players[1], tokens: [1, -1, -1, -1] },
  ];
  const unsafeState: LudoState = { ...base, players: unsafePlayers, pendingRoll: 1 };
  const capture = moveLudoToken(unsafeState, 0);
  assert.equal(capture.players[1].tokens[0], -1);
  assert.match(capture.message, /Captured 1 token/);
});

test("Ludo special-move facts come only from validated launch and capture transitions", () => {
  const base = createLudoGame(["Yellow", "Red"]);
  const launchBefore = rollLudoDie(base, 6);
  const launchAfter = moveLudoToken(launchBefore, 0);
  const launch = getValidatedOnlineLudoMove(launchBefore, launchAfter);
  assert.equal(launch?.unlocked, true, "selected yard token launches on a legal six move");
  assert.deepEqual(launch?.captures, []);

  const safeBefore: LudoState = {
    ...base,
    pendingRoll: 1,
    players: [
      { ...base.players[0], tokens: [25, -1, -1, -1] },
      { ...base.players[1], tokens: [0, -1, -1, -1] },
    ],
  };
  const safeAfter = moveLudoToken(safeBefore, 0);
  assert.deepEqual(getLudoCapturedTokens(safeBefore, safeAfter, 0), [], "safe-square landing never animates a knockout");
  assert.equal(safeAfter.players[1].tokens[0], 0);

  const captureBefore: LudoState = {
    ...base,
    pendingRoll: 1,
    players: [
      { ...base.players[0], tokens: [26, -1, -1, -1] },
      { ...base.players[1], tokens: [1, -1, -1, -1] },
    ],
  };
  const captureAfter = moveLudoToken(captureBefore, 0);
  const capture = getValidatedOnlineLudoMove(captureBefore, captureAfter);
  assert.deepEqual(capture?.captures, [{ playerIndex: 1, tokenIndex: 0, fromProgress: 1 }]);
  assert.equal(capture?.unlocked, false, "an already active token does not play the unlock cue");

  const returnPath = getLudoCaptureReturnPoints({ left: 10, top: 50 }, { left: 90, top: 20 });
  assert.equal(returnPath.length, 13);
  assert.deepEqual(returnPath[0], { left: 10, top: 50 });
  assert.deepEqual(returnPath.at(-1), { left: 90, top: 20 });
  assert.ok(returnPath.some((point) => point.top < 20), "the captured token takes a visible arc into its own yard");
});

test("Ludo requires exact home moves and declares a win after all four tokens finish", () => {
  const base = createLudoGame(["Yellow", "Red"]);
  const player = { ...base.players[0], tokens: [56, LUDO_FINISHED, LUDO_FINISHED, LUDO_FINISHED] };
  const state: LudoState = { ...base, players: [player, base.players[1]], pendingRoll: 1 };
  const winner = moveLudoToken(state, 0);
  assert.equal(winner.players[0].tokens[0], LUDO_FINISHED);
  assert.equal(winner.winnerIndex, 0);
  assert.throws(() => moveLudoToken(winner, 0), /Roll the die/);

  const tooFar: LudoState = { ...state, pendingRoll: null };
  const roll = rollLudoDie(tooFar, 2);
  assert.deepEqual(getLegalLudoTokenIndexes({ ...roll, pendingRoll: 2 }), []);
  assert.equal(roll.players[0].tokens[0], 56);
});

test("Ludo track has 52 distinct cells and safe starts are protected", () => {
  assert.equal(LUDO_TRACK.length, 52);
  assert.equal(new Set(LUDO_TRACK.map((cell) => `${cell.row},${cell.col}`)).size, 52);
  for (const index of [0, 13, 26, 39]) assert.equal(isLudoSafeSquare(index), true);
});

test("Ludo clockwise route starts and home entries match all four colored bases", () => {
  let signedArea = 0;
  LUDO_TRACK.forEach((square, index) => {
    const next = LUDO_TRACK[(index + 1) % LUDO_TRACK.length];
    signedArea += square.col * next.row - next.col * square.row;
  });
  assert.ok(signedArea > 0, "screen coordinates should trace the loop clockwise");
  assert.deepEqual(LUDO_COLOR_ORDER, ["yellow", "blue", "red", "green"]);

  const starts: Record<LudoColor, { row: number; col: number }> = {
    yellow: { row: 8, col: 13 }, blue: { row: 13, col: 6 },
    red: { row: 6, col: 1 }, green: { row: 1, col: 8 },
  };
  const entries: Record<LudoColor, { row: number; col: number }> = {
    yellow: { row: 7, col: 14 }, blue: { row: 14, col: 7 },
    red: { row: 7, col: 0 }, green: { row: 0, col: 7 },
  };
  const yardExits: Record<LudoColor, { row: number; col: number }> = {
    yellow: { row: 9, col: 13 }, blue: { row: 13, col: 5 },
    red: { row: 5, col: 1 }, green: { row: 1, col: 9 },
  };
  const distance = (a: { row: number; col: number }, b: { row: number; col: number }) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);

  for (const color of ["red", "green", "yellow", "blue"] as const) {
    const startIndex = LUDO_START_INDEXES[color];
    const start = LUDO_TRACK[startIndex];
    const homeEntry = LUDO_TRACK[(startIndex + 50) % LUDO_TRACK.length];
    const homeLane = LUDO_HOME_LANES[color];
    const yard = LUDO_YARD_GRID[color];
    assert.deepEqual(start, starts[color], color + " exits its matching base onto its safe start");
    assert.ok(LUDO_SAFE_TRACK_INDEXES.has(startIndex), color + " start is safe");
    assert.equal(distance(start, yardExits[color]), 1, color + " start is adjacent to its base exit");
    assert.ok(yard.row === 0 || yard.row === 9, color + " yard stays in its corner");
    assert.deepEqual(homeEntry, entries[color], color + " completes the outer loop at its lane entrance");
    assert.equal(distance(homeEntry, homeLane[0]), 1, color + " home lane joins the shared loop");
    assert.equal(homeLane.length, 6);
    for (let index = 1; index < homeLane.length; index += 1) {
      assert.equal(distance(homeLane[index - 1], homeLane[index]), 1, color + " lane step " + (index + 1) + " follows the previous step");
    }
    assert.equal(distance(homeLane[homeLane.length - 1], LUDO_FINISH_CELL), 1, color + " lane finishes beside the center");
  }

  const fourPlayerGame = createLudoGame(["Yellow", "Blue", "Red", "Green"]);
  assert.deepEqual(fourPlayerGame.players.map((player) => player.color), LUDO_COLOR_ORDER);
  for (let playerIndex = 0; playerIndex < fourPlayerGame.players.length; playerIndex += 1) {
    const player = fourPlayerGame.players[playerIndex];
    const rolled = rollLudoDie({ ...fourPlayerGame, turnIndex: playerIndex }, 6);
    const launched = moveLudoToken(rolled, 0);
    assert.equal(getLudoTrackIndex(launched.players[playerIndex], 0), LUDO_START_INDEXES[player.color]);
  }
});

test("Ludo animation plans produce one destination per die step on every color route", () => {
  const players = createLudoGame(["Yellow", "Blue", "Red", "Green"]).players;
  for (const player of players) {
    const two = getLudoMoveSteps(player, 10, 2);
    assert.deepEqual(two.map((step) => step.progress), [11, 12]);
    const six = getLudoMoveSteps(player, 10, 6);
    assert.deepEqual(six.map((step) => step.progress), [11, 12, 13, 14, 15, 16]);
    assert.deepEqual(six.map((step) => step.cell), six.map((step) => LUDO_TRACK[getLudoTrackIndex(player, step.progress)]));

    const homeEntry = getLudoMoveSteps(player, 48, 6);
    assert.deepEqual(homeEntry.map((step) => step.progress), [49, 50, 51, 52, 53, 54]);
    assert.deepEqual(homeEntry.slice(2).map((step) => step.cell), LUDO_HOME_LANES[player.color].slice(0, 4));
    assert.deepEqual(getLudoMoveSteps(player, 54, 3).map((step) => step.cell), [
      LUDO_HOME_LANES[player.color][4], LUDO_HOME_LANES[player.color][5], LUDO_FINISH_CELL,
    ]);
    assert.deepEqual(getLudoMoveSteps(player, -1, 6).map((step) => step.cell), [LUDO_TRACK[player.startIndex]]);
  }
  assert.equal(getLudoMoveSteps(players[0], 56, 2).length, 0, "overshooting the finish is not a legal animated route");
});

test("online Ludo animation only recognizes one validated selected-token move", () => {
  const base = createLudoGame(["Yellow", "Red"]);
  const ready = { ...base, players: base.players.map((player, index) => index === 0 ? { ...player, tokens: [8, -1, -1, -1] } : player) };
  const rolled = rollLudoDie(ready, 2);
  const moved = moveLudoToken(rolled, 0);
  const validated = getValidatedOnlineLudoMove(rolled, moved);
  assert.equal(validated?.tokenIndex, 0);
  assert.deepEqual(validated?.steps.map((step) => step.progress), [9, 10]);
  assert.equal(getValidatedOnlineLudoMove(rolled, { ...moved, players: moved.players.map((player, index) => index === 0 ? { ...player, tokens: [9, 10, -1, -1] } : player) }), null, "ambiguous multi-token deltas are not animated");
  assert.equal(getLudoProgressCell(base.players[0], 0).row, LUDO_TRACK[base.players[0].startIndex].row);
  const launchRoll = rollLudoDie(base, 6);
  const launched = moveLudoToken(launchRoll, 3);
  const launchAnimation = getValidatedOnlineLudoMove(launchRoll, launched);
  assert.equal(launchAnimation?.tokenIndex, 3);
  assert.equal(launchAnimation?.unlocked, true);
  assert.deepEqual(launchAnimation?.steps.map((step) => step.progress), [0], "a server-validated yard exit animates only the selected token onto its start square");

  const roster = ["Yellow", "Blue", "Red", "Green"].map((name, seatIndex) => ({ profileId: `user-${seatIndex}`, seatIndex, name, avatarUrl: null, connected: true }));
  const fourPlayerStart = createLudoGame(roster.map((entry) => entry.name));
  const captureBefore: LudoState = { ...fourPlayerStart, pendingRoll: 1, players: fourPlayerStart.players.map((player, index) => index === 0 ? { ...player, tokens: [26, -1, -1, -1] } : index === 2 ? { ...player, tokens: [1, -1, -1, -1] } : player) };
  const captureAfter = moveLudoToken(captureBefore, 0);
  const snapshot = (state: LudoState, version: number): OnlineRoomSnapshot => ({ roomId: "capture", roomCode: "KNOCK", gameType: "LUDO", visibility: "PUBLIC", status: "IN_PROGRESS", creatorId: "user-0", maxPlayers: 4, matchId: "capture-match", version, state, players: roster });
  const captureAnimation = getValidatedOnlineMoveAnimation(snapshot(captureBefore, 20), snapshot(captureAfter, 21));
  assert.equal(captureAnimation?.gameType, "LUDO");
  if (captureAnimation?.gameType !== "LUDO") throw new Error("Expected the engine-validated Ludo knockout animation.");
  assert.deepEqual(captureAnimation.captures, [{ playerIndex: 2, tokenIndex: 0, fromProgress: 1 }]);
  assert.equal(getValidatedOnlineMoveAnimation(snapshot(captureBefore, 20), snapshot({ ...captureAfter, players: captureAfter.players.map((player, index) => index === 2 ? { ...player, tokens: [1, -1, -1, -1] } : player) }, 21)), null, "a claimed capture not produced by the engine is never animated");
});

test("Ludo moves only the selected off-yard token for every color", () => {
  const base = createLudoGame(["Yellow", "Blue", "Red", "Green"]);
  for (let playerIndex = 0; playerIndex < base.players.length; playerIndex += 1) {
    const player = { ...base.players[playerIndex], tokens: [0, 3, 7, 11] };
    const state: LudoState = {
      ...base,
      turnIndex: playerIndex,
      pendingRoll: 2,
      players: base.players.map((entry, index) => index === playerIndex ? player : { ...entry, tokens: [-1, -1, -1, -1] }),
    };
    assert.deepEqual(getLegalLudoTokenIndexes(state), [0, 1, 2, 3]);
    const moved = moveLudoToken(state, 2);
    assert.deepEqual(moved.players[playerIndex].tokens, [0, 3, 9, 11]);
    assert.equal(getLudoTrackIndex(moved.players[playerIndex], 9), (player.startIndex + 9) % LUDO_TRACK.length);
    for (let index = 0; index < moved.players.length; index += 1) {
      if (index !== playerIndex) assert.deepEqual(moved.players[index].tokens, [-1, -1, -1, -1]);
    }
  }
});

test("all four Ludo tokens remain individually selectable after leaving the yard", () => {
  const base = createLudoGame(["Yellow", "Blue", "Red", "Green"]);
  for (let playerIndex = 0; playerIndex < base.players.length; playerIndex += 1) {
    for (let selectedToken = 0; selectedToken < 4; selectedToken += 1) {
      const progress = [0, 4, 9, 14];
      const activePlayer = { ...base.players[playerIndex], tokens: [...progress] };
      const state: LudoState = {
        ...base,
        turnIndex: playerIndex,
        pendingRoll: 2,
        players: base.players.map((player, index) => index === playerIndex ? activePlayer : { ...player, tokens: [-1, -1, -1, -1] }),
      };
      assert.deepEqual(getLegalLudoTokenIndexes(state), [0, 1, 2, 3]);
      const result = moveLudoToken(state, selectedToken);
      const expected = [...progress];
      expected[selectedToken] += 2;
      assert.deepEqual(result.players[playerIndex].tokens, expected, `only selected token ${selectedToken + 1} moves for ${activePlayer.color}`);
      assert.equal(getLudoTrackIndex(result.players[playerIndex], expected[selectedToken]), (activePlayer.startIndex + expected[selectedToken]) % LUDO_TRACK.length);
    }
  }
});

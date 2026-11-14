import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";
import { rollLudoDie, type LudoColor, type LudoState } from "@rasmalai/game-engine/ludo";
import { rollSnakesAndLadders, type SnakesAndLaddersState } from "@rasmalai/game-engine/snakes-and-ladders";
import { playTicTacToeMove, type TicTacToeState } from "@rasmalai/game-engine/tic-tac-toe";
import { getLudoMoveSteps, getValidatedOnlineLudoMove, type LudoCapturedToken } from "@/lib/games/ludo-token-motion";
import { getSnakesMoveAnimationPlan } from "@/lib/games/snakes-token-layout";

type OnlineMoveBase = { id: string; roomId: string; matchId: string; version: number };

export type OnlineSnakesMoveAnimation = OnlineMoveBase & {
  gameType: "SNAKES_AND_LADDERS";
  playerIndex: number;
  from: number;
  landed: number;
  to: number;
  rolled: number;
  transport: "snake" | "ladder" | null;
  steps: number[];
  transportPath: string | null;
  transportPoints: { x: number; y: number }[];
  won: boolean;
};

export type OnlineLudoMoveAnimation = OnlineMoveBase & {
  gameType: "LUDO";
  playerIndex: number;
  tokenIndex: number;
  color: LudoColor;
  fromProgress: number;
  toProgress: number;
  die: number;
  steps: ReturnType<typeof getLudoMoveSteps>;
  unlocked: boolean;
  captures: LudoCapturedToken[];
  won: boolean;
};

export type OnlineMoveAnimation = OnlineSnakesMoveAnimation | OnlineLudoMoveAnimation;
export type OnlineRollCue = { id: string; gameType: "LUDO" | "SNAKES_AND_LADDERS"; value: number; noLegalMove: boolean };
export type OnlineTicTacToeCue = { id: string; result: "place" | "victory" | "draw" };

function sameSnakesState(left: SnakesAndLaddersState, right: SnakesAndLaddersState) {
  const leftMove = left.lastMove;
  const rightMove = right.lastMove;
  return left.turnIndex === right.turnIndex
    && left.winnerIndex === right.winnerIndex
    && left.players.length === right.players.length
    && left.players.every((player, index) => player.name === right.players[index]?.name && player.position === right.players[index]?.position)
    && (leftMove === null ? rightMove === null : !!rightMove && leftMove.playerIndex === rightMove.playerIndex && leftMove.from === rightMove.from
      && leftMove.rolled === rightMove.rolled && leftMove.landed === rightMove.landed && leftMove.final === rightMove.final && leftMove.transport === rightMove.transport);
}

function sameLudoState(left: LudoState, right: LudoState) {
  return left.turnIndex === right.turnIndex && left.pendingRoll === right.pendingRoll && left.winnerIndex === right.winnerIndex
    && (left.lastRoll?.actionId ?? null) === (right.lastRoll?.actionId ?? null) && (left.lastRoll?.value ?? null) === (right.lastRoll?.value ?? null)
    && left.message === right.message && left.players.length === right.players.length
    && left.players.every((player, index) => {
      const other = right.players[index];
      return !!other && player.name === other.name && player.color === other.color && player.startIndex === other.startIndex
        && player.tokens.length === other.tokens.length && player.tokens.every((progress, token) => progress === other.tokens[token]);
    });
}

function sameTicTacToeState(left: TicTacToeState, right: TicTacToeState) {
  return left.turnIndex === right.turnIndex && left.winnerIndex === right.winnerIndex && left.isDraw === right.isDraw
    && (left.xPlayerIndex ?? 0) === (right.xPlayerIndex ?? 0)
    && left.players.length === right.players.length && left.players.every((name, index) => name === right.players[index])
    && left.board.length === right.board.length && left.board.every((mark, index) => mark === right.board[index]);
}

/** A one-cell transition is audible only after it matches the shared game engine. */
export function getValidatedOnlineTicTacToeCue(previous: OnlineRoomSnapshot, next: OnlineRoomSnapshot): OnlineTicTacToeCue | null {
  if (previous.roomId !== next.roomId || previous.gameType !== "TIC_TAC_TOE" || next.gameType !== "TIC_TAC_TOE"
    || !previous.matchId || previous.matchId !== next.matchId || previous.version === null || next.version !== previous.version + 1
    || !previous.state || !next.state) return null;
  const before = previous.state as TicTacToeState;
  const after = next.state as TicTacToeState;
  const changed = before.board.flatMap((mark, cell) => mark === after.board[cell] ? [] : [cell]);
  if (changed.length !== 1) return null;
  let expected: TicTacToeState;
  try { expected = playTicTacToeMove(before, changed[0]); } catch { return null; }
  if (!sameTicTacToeState(expected, after)) return null;
  const result = after.winnerIndex !== null ? "victory" : after.isDraw ? "draw" : "place";
  return { id: `${next.matchId}:${next.version}`, result };
}

/** A validated roll cue is separate from movement: Ludo rolls before selection. */
export function getValidatedOnlineRollCue(previous: OnlineRoomSnapshot, next: OnlineRoomSnapshot): OnlineRollCue | null {
  if (previous.roomId !== next.roomId || previous.gameType !== next.gameType || !previous.matchId || previous.matchId !== next.matchId) return null;
  if (previous.version === null || next.version !== previous.version + 1 || !previous.state || !next.state) return null;
  const id = `${next.matchId}:${next.version}:dice`;
  if (next.gameType === "SNAKES_AND_LADDERS") {
    const before = previous.state as SnakesAndLaddersState;
    const after = next.state as SnakesAndLaddersState;
    const move = after.lastMove;
    if (!move || move.playerIndex !== before.turnIndex || before.players[move.playerIndex]?.position !== move.from) return null;
    try { return sameSnakesState(rollSnakesAndLadders(before, move.rolled), after) ? { id, gameType: next.gameType, value: move.rolled, noLegalMove: false } : null; }
    catch { return null; }
  }
  if (next.gameType === "LUDO") {
    const before = previous.state as LudoState;
    const after = next.state as LudoState;
    if (before.pendingRoll !== null) return null;
    const validatedRoll = after.lastRoll;
    if (!validatedRoll?.actionId || !Number.isInteger(validatedRoll.value) || validatedRoll.value < 1 || validatedRoll.value > 6) return null;
    try {
      const expected = rollLudoDie(before, validatedRoll.value, validatedRoll.actionId);
      if (sameLudoState(expected, after)) return { id, gameType: next.gameType, value: validatedRoll.value, noLegalMove: expected.pendingRoll === null };
    } catch { return null; }
  }
  return null;
}

/**
 * Turn two consecutive, authoritative snapshots into a presentation-only move.
 * Initial hydration, reconnect snapshots, version gaps, and non-move actions
 * deliberately produce no animation event.
 */
export function getValidatedOnlineMoveAnimation(previous: OnlineRoomSnapshot, next: OnlineRoomSnapshot): OnlineMoveAnimation | null {
  if (previous.roomId !== next.roomId || previous.gameType !== next.gameType || !previous.matchId || previous.matchId !== next.matchId) return null;
  if (previous.version === null || next.version !== previous.version + 1 || !previous.state || !next.state) return null;
  const id = `${next.matchId}:${next.version}`;

  if (next.gameType === "SNAKES_AND_LADDERS") {
    const before = previous.state as SnakesAndLaddersState;
    const after = next.state as SnakesAndLaddersState;
    const move = after.lastMove;
    if (!move || move.playerIndex !== before.turnIndex || before.players[move.playerIndex]?.position !== move.from) return null;
    const plan = getSnakesMoveAnimationPlan(move);
    if (!plan) return null;
    // Verify the full server transition, including the untouched players, turn,
    // exact-finish handling, winner, and snake/ladder result.
    let expected: SnakesAndLaddersState;
    try { expected = rollSnakesAndLadders(before, move.rolled); } catch { return null; }
    if (!sameSnakesState(expected, after)) return null;
    return {
      id, roomId: next.roomId, matchId: next.matchId, version: next.version,
      gameType: "SNAKES_AND_LADDERS", playerIndex: move.playerIndex, from: move.from,
      landed: move.landed, to: move.final, rolled: move.rolled, transport: move.transport,
      steps: plan.steps, transportPath: plan.transportPath, transportPoints: plan.transportPoints,
      won: after.winnerIndex === move.playerIndex,
    };
  }

  if (next.gameType === "LUDO") {
    const before = previous.state as LudoState;
    const after = next.state as LudoState;
    const move = getValidatedOnlineLudoMove(before, after);
    if (!move) return null;
    const player = before.players[move.playerIndex];
    return {
      id, roomId: next.roomId, matchId: next.matchId, version: next.version,
      gameType: "LUDO", playerIndex: move.playerIndex, tokenIndex: move.tokenIndex,
      color: player.color, fromProgress: move.fromProgress, toProgress: move.toProgress,
      die: move.die, steps: move.steps, unlocked: move.unlocked, captures: move.captures, won: move.won,
    };
  }

  return null;
}

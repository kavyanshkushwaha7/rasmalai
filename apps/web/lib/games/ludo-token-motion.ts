import {
  LUDO_FINISHED,
  LUDO_FINISH_CELL,
  LUDO_HOME_LANES,
  LUDO_TRACK,
  LUDO_YARD_GRID,
  getLudoTrackIndex,
  moveLudoToken,
  type LudoPlayer,
  type LudoState,
} from "@rasmalai/game-engine/ludo";

export const LUDO_STEP_DURATION_MS = 250;

export type LudoCell = { row: number; col: number };
export type LudoMotionPoint = { left: number; top: number };
export type LudoMoveStep = { progress: number; cell: LudoCell };
export type LudoValidatedMove = {
  playerIndex: number;
  tokenIndex: number;
  fromProgress: number;
  toProgress: number;
  die: number;
  unlocked: boolean;
  captures: LudoCapturedToken[];
  won: boolean;
  steps: LudoMoveStep[];
};
export type LudoCapturedToken = { playerIndex: number; tokenIndex: number; fromProgress: number };

/** Derive knockout animation targets only from a committed engine result. */
export function getLudoCapturedTokens(before: LudoState, after: LudoState, movingPlayerIndex: number): LudoCapturedToken[] {
  return before.players.flatMap((player, playerIndex) => {
    if (playerIndex === movingPlayerIndex) return [];
    const next = after.players[playerIndex];
    if (!next || next.color !== player.color || next.tokens.length !== player.tokens.length) return [];
    return player.tokens.flatMap((fromProgress, tokenIndex) => fromProgress >= 0 && fromProgress <= 50 && next.tokens[tokenIndex] === -1
      ? [{ playerIndex, tokenIndex, fromProgress }]
      : []);
  });
}

/** An arcing return to the captured coin's own yard, sampled for visible movement. */
export function getLudoCaptureReturnPoints(start: LudoMotionPoint, end: LudoMotionPoint, segments = 12): LudoMotionPoint[] {
  const count = Math.max(2, Math.floor(segments));
  const control = { left: (start.left + end.left) / 2, top: Math.max(1, Math.min(start.top, end.top) - 12) };
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const one = 1 - t;
    return {
      left: one * one * start.left + 2 * one * t * control.left + t * t * end.left,
      top: one * one * start.top + 2 * one * t * control.top + t * t * end.top,
    };
  });
}

export function getLudoProgressCell(player: LudoPlayer, progress: number): LudoCell {
  if (progress < 0 || progress > LUDO_FINISHED) throw new Error("Ludo progress is outside the board.");
  if (progress <= 50) return LUDO_TRACK[getLudoTrackIndex(player, progress)];
  if (progress < LUDO_FINISHED) return LUDO_HOME_LANES[player.color][progress - 51];
  return LUDO_FINISH_CELL;
}

/** Return every destination reached by the selected token, in engine progress order. */
export function getLudoMoveSteps(player: LudoPlayer, fromProgress: number, die: number): LudoMoveStep[] {
  if (!Number.isInteger(die) || die < 1 || die > 6) return [];
  if (fromProgress === -1) return die === 6 ? [{ progress: 0, cell: getLudoProgressCell(player, 0) }] : [];
  if (fromProgress < 0 || fromProgress + die > LUDO_FINISHED) return [];
  return Array.from({ length: die }, (_, index) => {
    const progress = fromProgress + index + 1;
    return { progress, cell: getLudoProgressCell(player, progress) };
  });
}

/** Recognize one completed, engine-legal token move between consecutive snapshots. */
export function getValidatedOnlineLudoMove(before: LudoState, after: LudoState): LudoValidatedMove | null {
  const die = before.pendingRoll;
  const playerIndex = before.turnIndex;
  if (die === null || before.winnerIndex !== null || !after.players[playerIndex]) return null;
  const priorPlayer = before.players[playerIndex];
  const nextPlayer = after.players[playerIndex];
  if (priorPlayer.color !== nextPlayer.color || priorPlayer.tokens.length !== nextPlayer.tokens.length) return null;

  const changed: number[] = [];
  for (let tokenIndex = 0; tokenIndex < priorPlayer.tokens.length; tokenIndex += 1) {
    if (priorPlayer.tokens[tokenIndex] !== nextPlayer.tokens[tokenIndex]) changed.push(tokenIndex);
  }
  if (changed.length !== 1) return null;
  const tokenIndex = changed[0];
  const fromProgress = priorPlayer.tokens[tokenIndex];
  const toProgress = fromProgress === -1 ? 0 : fromProgress + die;
  if (toProgress > LUDO_FINISHED || nextPlayer.tokens[tokenIndex] !== toProgress || after.pendingRoll !== null) return null;
  const steps = getLudoMoveSteps(priorPlayer, fromProgress, die);
  if (!steps.length || steps.at(-1)?.progress !== toProgress) return null;

  // The animation is a presentation of a committed engine transition. Validate
  // captures, extra turns, winner and all non-selected tokens as well as the
  // selected token's destination before exposing a visual move.
  let expected: LudoState;
  try { expected = moveLudoToken(before, tokenIndex); } catch { return null; }
  if (expected.turnIndex !== after.turnIndex || expected.pendingRoll !== after.pendingRoll || expected.winnerIndex !== after.winnerIndex || expected.message !== after.message) return null;
  if (expected.players.length !== after.players.length || !expected.players.every((expectedPlayer, index) => {
    const actual = after.players[index];
    return !!actual && expectedPlayer.name === actual.name && expectedPlayer.color === actual.color
      && expectedPlayer.startIndex === actual.startIndex
      && expectedPlayer.tokens.length === actual.tokens.length
      && expectedPlayer.tokens.every((progress, token) => progress === actual.tokens[token]);
  })) return null;
  return {
    playerIndex, tokenIndex, fromProgress, toProgress, die, steps,
    unlocked: fromProgress === -1,
    captures: getLudoCapturedTokens(before, after, playerIndex),
    won: after.winnerIndex === playerIndex,
  };
}

export function getLudoGridPoint(cell: LudoCell): LudoMotionPoint {
  return { left: ((cell.col + .5) / 15) * 100, top: ((cell.row + .5) / 15) * 100 };
}

/** Fallback origin used before a rendered token's exact position has been measured. */
export function getLudoYardPoint(player: LudoPlayer, tokenIndex: number): LudoMotionPoint {
  const yard = LUDO_YARD_GRID[player.color];
  const columnOffset = tokenIndex % 2 === 0 ? 1.9 : 4.1;
  const rowOffset = tokenIndex < 2 ? 2.8 : 4.8;
  return getLudoGridPoint({ row: yard.row + rowOffset, col: yard.col + columnOffset });
}

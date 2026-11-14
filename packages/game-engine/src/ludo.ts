export type LudoColor = "yellow" | "green" | "red" | "blue";
export type LudoPlayer = { name: string; color: LudoColor; startIndex: number; tokens: number[] };
export type LudoState = {
  players: LudoPlayer[];
  turnIndex: number;
  pendingRoll: number | null;
  /** Most recent validated roll, including its online action identity when available. */
  lastRoll?: { actionId: string | null; value: number } | null;
  winnerIndex: number | null;
  message: string;
};

/**
 * 52 shared squares in clockwise order. Index zero is the yellow start on the
 * lower-right base; each color is 13 squares apart and joins its own home lane
 * after 50 shared-track moves.
 */
export const LUDO_TRACK: ReadonlyArray<{ row: number; col: number }> = [
  { row: 8, col: 13 }, { row: 8, col: 12 }, { row: 8, col: 11 }, { row: 8, col: 10 }, { row: 8, col: 9 },
  { row: 9, col: 8 }, { row: 10, col: 8 }, { row: 11, col: 8 }, { row: 12, col: 8 }, { row: 13, col: 8 }, { row: 14, col: 8 },
  { row: 14, col: 7 }, { row: 14, col: 6 }, { row: 13, col: 6 }, { row: 12, col: 6 }, { row: 11, col: 6 }, { row: 10, col: 6 }, { row: 9, col: 6 },
  { row: 8, col: 5 }, { row: 8, col: 4 }, { row: 8, col: 3 }, { row: 8, col: 2 }, { row: 8, col: 1 }, { row: 8, col: 0 },
  { row: 7, col: 0 }, { row: 6, col: 0 }, { row: 6, col: 1 }, { row: 6, col: 2 }, { row: 6, col: 3 }, { row: 6, col: 4 }, { row: 6, col: 5 },
  { row: 5, col: 6 }, { row: 4, col: 6 }, { row: 3, col: 6 }, { row: 2, col: 6 }, { row: 1, col: 6 }, { row: 0, col: 6 },
  { row: 0, col: 7 }, { row: 0, col: 8 }, { row: 1, col: 8 }, { row: 2, col: 8 }, { row: 3, col: 8 }, { row: 4, col: 8 }, { row: 5, col: 8 },
  { row: 6, col: 9 }, { row: 6, col: 10 }, { row: 6, col: 11 }, { row: 6, col: 12 }, { row: 6, col: 13 }, { row: 6, col: 14 },
  { row: 7, col: 14 }, { row: 8, col: 14 },
];

export const LUDO_SAFE_TRACK_INDEXES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const LUDO_FINISHED = 57;
export const LUDO_COLOR_ORDER: ReadonlyArray<LudoColor> = ["yellow", "blue", "red", "green"];
export const LUDO_START_INDEXES: Readonly<Record<LudoColor, number>> = Object.freeze({ yellow: 0, blue: 13, red: 26, green: 39 });
export const LUDO_HOME_LANES: Readonly<Record<LudoColor, ReadonlyArray<{ row: number; col: number }>>> = Object.freeze({
  yellow: Array.from({ length: 6 }, (_, index) => ({ row: 7, col: 13 - index })),
  blue: Array.from({ length: 6 }, (_, index) => ({ row: 13 - index, col: 7 })),
  red: Array.from({ length: 6 }, (_, index) => ({ row: 7, col: index + 1 })),
  green: Array.from({ length: 6 }, (_, index) => ({ row: index + 1, col: 7 })),
});
export const LUDO_YARD_GRID: Readonly<Record<LudoColor, { row: number; col: number }>> = Object.freeze({
  red: { row: 0, col: 0 }, green: { row: 0, col: 9 }, blue: { row: 9, col: 0 }, yellow: { row: 9, col: 9 },
});
export const LUDO_FINISH_CELL = Object.freeze({ row: 7, col: 7 });

export function createLudoGame(names: string[]): LudoState {
  if (names.length < 2 || names.length > 4) throw new Error("Ludo needs 2–4 players.");
  const colors: LudoColor[] = names.length === 2 ? ["yellow", "red"] : names.length === 3 ? ["yellow", "blue", "red"] : [...LUDO_COLOR_ORDER];
  return {
    players: names.map((name, index) => ({ name, color: colors[index], startIndex: LUDO_START_INDEXES[colors[index]], tokens: [-1, -1, -1, -1] })),
    turnIndex: 0,
    pendingRoll: null,
    lastRoll: null,
    winnerIndex: null,
    message: "Roll a six to bring a token onto the board.",
  };
}

export function getLudoTrackIndex(player: LudoPlayer, progress: number): number {
  if (progress < 0 || progress > 50) throw new Error("Only shared-track progress has a track square.");
  return (player.startIndex + progress) % LUDO_TRACK.length;
}

export function isLudoSafeSquare(trackIndex: number): boolean {
  return LUDO_SAFE_TRACK_INDEXES.has(trackIndex);
}

export function getLegalLudoTokenIndexes(state: LudoState, die = state.pendingRoll): number[] {
  if (die === null || state.winnerIndex !== null) return [];
  const tokens = state.players[state.turnIndex].tokens;
  return tokens.flatMap((progress, index) => {
    if (progress === -1) return die === 6 ? [index] : [];
    return progress + die <= LUDO_FINISHED ? [index] : [];
  });
}

export function rollLudoDie(state: LudoState, die: number, actionId: string | null = null): LudoState {
  if (state.winnerIndex !== null) throw new Error("This game is over.");
  if (state.pendingRoll !== null) throw new Error("Choose a token before rolling again.");
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error("The die must show 1–6.");

  const rolled = { ...state, pendingRoll: die, lastRoll: { actionId, value: die }, message: `${state.players[state.turnIndex].name} rolled ${die}.` };
  if (getLegalLudoTokenIndexes(rolled).length > 0) return rolled;
  return {
    ...rolled,
    pendingRoll: null,
    turnIndex: die === 6 ? state.turnIndex : (state.turnIndex + 1) % state.players.length,
    message: die === 6 ? "No legal move. Roll again for the six." : "No legal move. The turn passes.",
  };
}

export function moveLudoToken(state: LudoState, tokenIndex: number): LudoState {
  const die = state.pendingRoll;
  if (die === null) throw new Error("Roll the die before choosing a token.");
  if (!getLegalLudoTokenIndexes(state).includes(tokenIndex)) throw new Error("That token cannot move with this roll.");

  const playerIndex = state.turnIndex;
  const player = state.players[playerIndex];
  const priorProgress = player.tokens[tokenIndex];
  const progress = priorProgress === -1 ? 0 : priorProgress + die;
  const players = state.players.map((entry) => ({ ...entry, tokens: [...entry.tokens] }));
  players[playerIndex].tokens[tokenIndex] = progress;

  let captured = 0;
  if (progress <= 50) {
    const trackIndex = getLudoTrackIndex(player, progress);
    if (!isLudoSafeSquare(trackIndex)) {
      for (let index = 0; index < players.length; index += 1) {
        if (index === playerIndex) continue;
        players[index].tokens = players[index].tokens.map((otherProgress) => {
          if (otherProgress >= 0 && otherProgress <= 50 && getLudoTrackIndex(players[index], otherProgress) === trackIndex) {
            captured += 1;
            return -1;
          }
          return otherProgress;
        });
      }
    }
  }

  const won = players[playerIndex].tokens.every((tokenProgress) => tokenProgress === LUDO_FINISHED);
  const nextTurn = won || die === 6 ? playerIndex : (playerIndex + 1) % players.length;
  const parts = [captured ? `Captured ${captured} token${captured === 1 ? "" : "s"}.` : "Token moved."];
  if (progress === LUDO_FINISHED) parts.push("Token reached home.");
  if (won) parts.push(`${player.name} wins!`);
  else if (die === 6) parts.push("Roll again for the six.");

  return {
    players,
    turnIndex: nextTurn,
    pendingRoll: null,
    winnerIndex: won ? playerIndex : null,
    message: parts.join(" "),
  };
}

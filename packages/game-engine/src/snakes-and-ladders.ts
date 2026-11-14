export type SnakesPlayer = { name: string; position: number };
export type SnakesAndLaddersState = {
  players: SnakesPlayer[];
  turnIndex: number;
  winnerIndex: number | null;
  lastMove: { playerIndex: number; from: number; rolled: number; landed: number; final: number; transport: "snake" | "ladder" | null } | null;
};

// These fixed transitions use conventional, well-separated board locations.
export const SNAKES: Readonly<Record<number, number>> = Object.freeze({ 29: 9, 38: 15, 47: 5, 53: 33, 62: 37, 86: 54, 92: 70, 97: 25 });
export const LADDERS: Readonly<Record<number, number>> = Object.freeze({ 2: 23, 8: 34, 20: 77, 32: 68, 41: 79, 74: 88, 82: 100 });

export function createSnakesAndLaddersGame(names: string[]): SnakesAndLaddersState {
  if (names.length < 2 || names.length > 4) throw new Error("Snakes & Ladders needs 2–4 players.");
  return { players: names.map((name) => ({ name, position: 0 })), turnIndex: 0, winnerIndex: null, lastMove: null };
}

export function rollSnakesAndLadders(state: SnakesAndLaddersState, die: number): SnakesAndLaddersState {
  if (state.winnerIndex !== null) throw new Error("This game is over.");
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error("The die must show 1–6.");

  const player = state.players[state.turnIndex];
  const from = player.position;
  const landing = from + die;
  const finalSquare = landing > 100 ? from : (LADDERS[landing] ?? SNAKES[landing] ?? landing);
  const transport = landing > 100 ? null : LADDERS[landing] ? "ladder" : SNAKES[landing] ? "snake" : null;
  const players = state.players.map((entry, index) => index === state.turnIndex ? { ...entry, position: finalSquare } : entry);
  const winnerIndex = finalSquare === 100 ? state.turnIndex : null;

  return {
    players,
    winnerIndex,
    turnIndex: winnerIndex === null ? (state.turnIndex + 1) % state.players.length : state.turnIndex,
    lastMove: { playerIndex: state.turnIndex, from, rolled: die, landed: landing, final: finalSquare, transport },
  };
}

/** Map square numbers to a row/column on a bottom-up, alternating 10×10 board. */
export function getSnakesBoardCell(square: number): { row: number; col: number } {
  if (!Number.isInteger(square) || square < 1 || square > 100) throw new Error("Board squares are numbered 1–100.");
  const band = Math.floor((square - 1) / 10);
  const offset = (square - 1) % 10;
  return { row: 9 - band, col: band % 2 === 0 ? offset : 9 - offset };
}

export type TicTacToeMark = "X" | "O";

export type TicTacToeState = {
  players: [string, string];
  board: (TicTacToeMark | null)[];
  turnIndex: 0 | 1;
  /** Seat assigned X this round; optional only for compatibility with old saved states. */
  xPlayerIndex?: 0 | 1;
  winnerIndex: 0 | 1 | null;
  isDraw: boolean;
};

export const TIC_TAC_TOE_WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

export type TicTacToeWinningLine = typeof TIC_TAC_TOE_WINNING_LINES[number];

export function createTicTacToeGame(names: [string, string] = ["Player 1", "Player 2"], xPlayerIndex: 0 | 1 = 0): TicTacToeState {
  return { players: [...names], board: Array(9).fill(null), turnIndex: xPlayerIndex, xPlayerIndex, winnerIndex: null, isDraw: false };
}

export function getTicTacToeWinner(board: readonly (TicTacToeMark | null)[]): TicTacToeMark | null {
  const line = getTicTacToeWinningLine(board);
  return line ? board[line[0]] : null;
}

/** Return the exact three cell indexes the UI should illuminate after a win. */
export function getTicTacToeWinningLine(board: readonly (TicTacToeMark | null)[]): TicTacToeWinningLine | null {
  return TIC_TAC_TOE_WINNING_LINES.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]) ?? null;
}

export function playTicTacToeMove(state: TicTacToeState, cell: number): TicTacToeState {
  if (state.winnerIndex !== null || state.isDraw) throw new Error("This round is over.");
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || state.board[cell] !== null) {
    throw new Error("Choose an empty square.");
  }

  const board = [...state.board];
  board[cell] = state.turnIndex === (state.xPlayerIndex ?? 0) ? "X" : "O";
  const winningMark = getTicTacToeWinner(board);
  const winnerIndex = winningMark === null ? null : state.turnIndex;
  const isDraw = winnerIndex === null && board.every((mark) => mark !== null);
  return {
    ...state,
    board,
    winnerIndex,
    isDraw,
    turnIndex: winnerIndex !== null || isDraw ? state.turnIndex : state.turnIndex === 0 ? 1 : 0,
  };
}

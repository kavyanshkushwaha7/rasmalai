import { randomInt } from "node:crypto";
import { createLudoGame, getLegalLudoTokenIndexes, moveLudoToken, rollLudoDie, type LudoState } from "@rasmalai/game-engine/ludo";
import { createSnakesAndLaddersGame, rollSnakesAndLadders, type SnakesAndLaddersState } from "@rasmalai/game-engine/snakes-and-ladders";
import { createTicTacToeGame, playTicTacToeMove, type TicTacToeState } from "@rasmalai/game-engine/tic-tac-toe";
import type { OnlineGameState, OnlineGameType, OnlinePlayer, OnlineRoomSnapshot, PlayerGameAction } from "@rasmalai/game-engine/online";

export type { OnlineGameState, OnlineGameType, OnlinePlayer, OnlineRoomSnapshot, PlayerGameAction };

export type AppliedGameAction = {
  action: { type: "roll"; die: number } | { type: "move"; cell?: number; tokenIndex?: number };
  state: OnlineGameState;
  finished: boolean;
  winnerSeat: number | null;
};

export function createOnlineGameState(gameType: OnlineGameType, players: OnlinePlayer[], startingSeat = 0): OnlineGameState {
  const ordered = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
  const names = ordered.map((player) => player.name);
  if (!Number.isInteger(startingSeat) || startingSeat < 0 || startingSeat >= ordered.length) throw new Error("Starting seat is outside the room roster.");
  if (gameType === "LUDO") {
    if (ordered.length !== 4) throw new Error("Online Ludo starts with exactly four players.");
    return { ...createLudoGame(names), turnIndex: startingSeat };
  }
  if (gameType === "TIC_TAC_TOE") {
    if (ordered.length !== 2) throw new Error("Online Tic Tac Toe needs two players.");
    return createTicTacToeGame([names[0], names[1]], startingSeat as 0 | 1);
  }
  if (ordered.length < 2 || ordered.length > 4) throw new Error("Online Snakes & Ladders needs two to four players.");
  return { ...createSnakesAndLaddersGame(names), turnIndex: startingSeat };
}

/** Apply one intent using the shared Phase 3 rules and a cryptographic server die. */
export function applyAuthoritativeGameAction(
  room: OnlineRoomSnapshot,
  actorId: string,
  intent: PlayerGameAction,
  roll = () => randomInt(1, 7),
  actionId?: string,
): AppliedGameAction {
  if (room.status !== "IN_PROGRESS" || !room.state || room.version === null) throw new Error("This match is not ready for a move.");
  const actor = room.players.find((player) => player.profileId === actorId);
  if (!actor) throw new Error("You are not a player in this room.");
  const state = room.state;
  if (actor.seatIndex !== state.turnIndex) throw new Error("It is not your turn.");

  let next: OnlineGameState;
  let action: AppliedGameAction["action"];
  if (room.gameType === "TIC_TAC_TOE") {
    if (intent.type !== "move" || typeof intent.cell !== "number") throw new Error("Choose an empty Tic Tac Toe square.");
    next = playTicTacToeMove(state as TicTacToeState, intent.cell);
    action = { type: "move", cell: intent.cell };
  } else if (room.gameType === "LUDO") {
    const current = state as LudoState;
    if (intent.type === "roll") {
      if (current.pendingRoll !== null) throw new Error("Choose a token before rolling again.");
      const die = roll();
      next = rollLudoDie(current, die, actionId ?? null);
      action = { type: "roll", die };
    } else {
      if (typeof intent.tokenIndex !== "number" || !getLegalLudoTokenIndexes(current).includes(intent.tokenIndex)) {
        throw new Error("Choose one of the highlighted legal tokens.");
      }
      next = moveLudoToken(current, intent.tokenIndex);
      action = { type: "move", tokenIndex: intent.tokenIndex };
    }
  } else {
    if (intent.type !== "roll") throw new Error("Snakes & Ladders moves with a server dice roll.");
    const die = roll();
    next = rollSnakesAndLadders(state as SnakesAndLaddersState, die);
    action = { type: "roll", die };
  }

  const winnerSeat = next.winnerIndex;
  const finished = winnerSeat !== null || ("isDraw" in next && next.isDraw);
  return { action, state: next, finished, winnerSeat };
}

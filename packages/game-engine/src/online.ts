import type { LudoState } from "./ludo.js";
import type { SnakesAndLaddersState } from "./snakes-and-ladders.js";
import type { TicTacToeState } from "./tic-tac-toe.js";

export type OnlineGameType = "LUDO" | "TIC_TAC_TOE" | "SNAKES_AND_LADDERS";
export type OnlineRoomStatus = "WAITING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type OnlinePlayer = { profileId: string; seatIndex: number; name: string; avatarUrl: string | null; connected: boolean; lastSeenAt?: string };
export type OnlineGameState = LudoState | TicTacToeState | SnakesAndLaddersState;

export type OnlineRematchState = {
  requestId: string;
  previousMatchId: string;
  requesterId: string;
  status: "PENDING" | "DECLINED";
  acceptedPlayerIds: string[];
  requiredPlayers: number;
};

export type OnlineRoomSnapshot = {
  roomId: string;
  roomCode: string;
  gameType: OnlineGameType;
  visibility: "PUBLIC" | "PRIVATE";
  status: OnlineRoomStatus;
  creatorId: string;
  maxPlayers: number;
  matchId: string | null;
  startingSeat?: number | null;
  rematch?: OnlineRematchState | null;
  version: number | null;
  state: OnlineGameState | null;
  players: OnlinePlayer[];
  /** Present on spectator listings and watch snapshots; omitted from player-only RPCs. */
  spectatorCount?: number;
};

export type PlayerGameAction =
  | { type: "roll" }
  | { type: "move"; cell?: number; tokenIndex?: number };

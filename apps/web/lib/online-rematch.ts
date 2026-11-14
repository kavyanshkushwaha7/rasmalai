import type { OnlineRoomSnapshot, OnlineRematchState } from "@rasmalai/game-engine/online";

export type OnlineRematchPanelState =
  | { type: "request"; wasDeclined: boolean }
  | { type: "waiting"; rematch: OnlineRematchState }
  | { type: "respond"; rematch: OnlineRematchState };

/** Derive the rematch controls from the durable snapshot, including a fresh reload snapshot. */
export function getOnlineRematchPanelState(room: OnlineRoomSnapshot, userId: string): OnlineRematchPanelState | null {
  if (room.status !== "COMPLETED" || !room.matchId || room.players.length < 2) return null;

  const rematch = room.rematch;
  if (!rematch || rematch.status === "DECLINED") return { type: "request", wasDeclined: rematch?.status === "DECLINED" };
  if (rematch.acceptedPlayerIds.includes(userId)) return { type: "waiting", rematch };
  return { type: "respond", rematch };
}

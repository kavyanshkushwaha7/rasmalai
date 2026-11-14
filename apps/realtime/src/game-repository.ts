import { withRealtimeUser, type DatabaseTransaction } from "@rasmalai/database";
import type { AppliedGameAction } from "./game-room-service.js";
import type { OnlineGameState, OnlineGameType, OnlineRoomSnapshot } from "@rasmalai/game-engine/online";

type RpcRows<T> = Array<{ result: T }>;
export type RateLimitAction =
  | "room_create" | "room_join" | "game_action" | "player_chat_send" | "player_chat_react"
  | "match_reaction" | "room_invite" | "spectator_join" | "spectator_accept"
  | "spectator_invite" | "spectator_chat_send" | "spectator_chat_react"
  | "voice_join" | "voice_signal" | "room_list" | "spectator_list"
  | "rematch_request" | "rematch_response";

async function one<T>(token: string, query: (transaction: DatabaseTransaction) => Promise<RpcRows<T>>): Promise<T> {
  return withRealtimeUser(token, async (transaction) => {
    const rows = await query(transaction);
    if (!rows[0]) throw new Error("Game database returned no result.");
    return rows[0].result;
  });
}

function normalized<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export function listPublicRooms(token: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_list_public_rooms() AS result
  `).then((value) => normalized<OnlineRoomSnapshot[]>(value));
}

export function consumeSharedRateLimit(token: string, action: RateLimitAction) {
  return one(token, (db) => db.$queryRaw<RpcRows<boolean>>`
    SELECT public.rasmalai_consume_rate_limit(${action}::TEXT) AS result
  `);
}

export function listPublicLiveRooms(token: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_list_public_live_rooms() AS result
  `).then((value) => normalized<OnlineRoomSnapshot[]>(value));
}

export function getSpectatorCount(token: string, roomId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<number>>`
    SELECT public.rasmalai_realtime_spectator_count(${roomId}::UUID) AS result
  `);
}

export function createRoom(token: string, gameType: OnlineGameType, visibility: "PUBLIC" | "PRIVATE", maxPlayers: number) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_create_room(
      ${gameType}::public."GameType", ${visibility}::public."RoomVisibility", ${maxPlayers}::INTEGER
    ) AS result
  `).then((value) => normalized<OnlineRoomSnapshot>(value));
}

export function invitePlayer(token: string, roomId: string, username: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_invite_player(${roomId}::UUID, ${username}::TEXT) AS result
  `).then((value) => normalized<{ inviteId: string; roomId: string; recipientId: string }>(value));
}

export function joinRoom(token: string, roomId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_join_room(${roomId}::UUID) AS result
  `).then((value) => normalized<OnlineRoomSnapshot>(value));
}

export function loadRoom(token: string, roomId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_load_room(${roomId}::UUID) AS result
  `).then((value) => normalized<OnlineRoomSnapshot>(value));
}

export function watchRoom(token: string, roomId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_watch_room(${roomId}::UUID) AS result
  `).then((value) => normalized<OnlineRoomSnapshot>(value));
}

export function spectatorInviteInfo(token: string, roomId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_spectator_invite_info(${roomId}::UUID) AS result
  `).then((value) => normalized<{ roomId: string; inviteId: string; status: string; gameType: OnlineGameType; roomCode: string; invitedBy: string; expiresAt: string }>(value));
}

export function acceptSpectatorInvite(token: string, roomId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_accept_spectator_invite(${roomId}::UUID) AS result
  `).then((value) => normalized<OnlineRoomSnapshot>(value));
}

export function setSpectatorPresence(token: string, roomId: string, connected: boolean, leave = false) {
  return one(token, (db) => db.$queryRaw<RpcRows<number>>`
    SELECT public.rasmalai_realtime_set_spectator_presence(${roomId}::UUID, ${connected}::BOOLEAN, ${leave}::BOOLEAN) AS result
  `);
}

export function inviteSpectator(token: string, roomId: string, username: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_invite_spectator(${roomId}::UUID, ${username}::TEXT) AS result
  `).then((value) => normalized<{ inviteId: string; roomId: string; recipientId: string }>(value));
}

export function listSpectatorInvites(token: string, roomId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_list_spectator_invites(${roomId}::UUID) AS result
  `).then((value) => normalized<Array<{ inviteId: string; recipientId: string; name: string; username: string; status: string; expiresAt: string }>>(value));
}

export function revokeSpectatorInvite(token: string, roomId: string, inviteId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<string>>`
    SELECT public.rasmalai_realtime_revoke_spectator_invite(${roomId}::UUID, ${inviteId}::UUID) AS result
  `);
}

export function sendSpectatorChat(token: string, roomId: string, body: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_send_spectator_chat(${roomId}::UUID, ${body}::TEXT) AS result
  `).then((value) => normalized<unknown>(value));
}

export function getSpectatorChatHistory(token: string, roomId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_spectator_chat_history(${roomId}::UUID) AS result
  `).then((value) => normalized<unknown[]>(value));
}

export function toggleSpectatorReaction(token: string, roomId: string, messageId: string, emoji: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_toggle_spectator_reaction(${roomId}::UUID, ${messageId}::UUID, ${emoji}::TEXT) AS result
  `).then((value) => normalized<unknown[]>(value));
}

export function initializeMatch(token: string, roomId: string, state: OnlineGameState) {
  const json = JSON.stringify(state);
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_initialize_match(${roomId}::UUID, ${json}::JSONB) AS result
  `).then((value) => normalized<OnlineRoomSnapshot>(value));
}

export function persistAction(token: string, roomId: string, expectedVersion: number, actionId: string, applied: AppliedGameAction) {
  const action = JSON.stringify(applied.action);
  const state = JSON.stringify(applied.state);
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_persist_action(
      ${roomId}::UUID, ${expectedVersion}::INTEGER, ${actionId}::TEXT,
      ${action}::JSONB, ${state}::JSONB, ${applied.finished}::BOOLEAN, ${applied.winnerSeat}::INTEGER
    ) AS result
  `).then((value) => normalized<OnlineRoomSnapshot>(value));
}

export function applyRematchAction(
  token: string,
  roomId: string,
  action: "request" | "respond",
  requestId: string | null,
  accept: boolean | null,
  initialState: OnlineGameState | null,
) {
  const json = initialState === null ? null : JSON.stringify(initialState);
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_rematch_action(
      ${roomId}::UUID, ${action}::TEXT, ${requestId}::UUID, ${accept}::BOOLEAN, ${json}::JSONB
    ) AS result
  `).then((value) => normalized<{ room: OnlineRoomSnapshot; status: "PENDING" | "DECLINED" | "STARTED" }>(value));
}

export function setPresence(token: string, roomId: string, connected: boolean) {
  return one(token, (db) => db.$queryRaw<RpcRows<boolean>>`
    SELECT public.rasmalai_realtime_set_presence(${roomId}::UUID, ${connected}::BOOLEAN) AS result
  `);
}

export function sendChat(token: string, roomId: string, body: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_send_chat(${roomId}::UUID, ${body}::TEXT) AS result
  `).then((value) => normalized<unknown>(value));
}

export function getChatHistory(token: string, roomId: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_chat_history(${roomId}::UUID) AS result
  `).then((value) => normalized<unknown[]>(value));
}

export function toggleReaction(token: string, roomId: string, messageId: string, emoji: string) {
  return one(token, (db) => db.$queryRaw<RpcRows<unknown>>`
    SELECT public.rasmalai_realtime_toggle_reaction(${roomId}::UUID, ${messageId}::UUID, ${emoji}::TEXT) AS result
  `).then((value) => normalized<unknown[]>(value));
}

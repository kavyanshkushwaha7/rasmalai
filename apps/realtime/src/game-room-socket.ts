import type { Server, Socket } from "socket.io";
import { isFeatureFlagEnabled, SPECTATOR_MODE_DISABLED_MESSAGE } from "@rasmalai/game-engine/feature-flags";
import { authorizeSocketRoomMembership, verifySocketRoomMembership, type RoomAccess, type SocketRoomAccessDenial } from "./room-access.js";
import {
  createRoom,
  acceptSpectatorInvite,
  applyRematchAction,
  getSpectatorCount,
  getSpectatorChatHistory,
  getChatHistory,
  inviteSpectator,
  initializeMatch,
  invitePlayer,
  joinRoom,
  listPublicLiveRooms,
  listPublicRooms,
  listSpectatorInvites,
  loadRoom,
  persistAction,
  revokeSpectatorInvite,
  sendSpectatorChat,
  setSpectatorPresence,
  sendChat,
  spectatorInviteInfo,
  toggleSpectatorReaction,
  watchRoom,
  setPresence,
  toggleReaction,
  consumeSharedRateLimit,
  type RateLimitAction,
} from "./game-repository.js";
import { applyAuthoritativeGameAction, createOnlineGameState, type OnlineRoomSnapshot, type PlayerGameAction } from "./game-room-service.js";

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_ID_PATTERN = ROOM_ID_PATTERN;
const GAME_TYPES = new Set(["LUDO", "TIC_TAC_TOE", "SNAKES_AND_LADDERS"]);
const EMOJIS = new Set(["👍", "👏", "😂", "😮", "😢", "🎉", "❤️", "🔥"]);
const ROOM_CHANNEL = (roomId: string) => `game:${roomId}`;
const SPECTATOR_CHANNEL = (roomId: string) => `spectator:${roomId}`;

type AuthSocket = Socket & { data: { userId: string; supabaseAccessToken: string; onlineRoomIds?: Set<string>; spectatorRoomIds?: Set<string>; voiceRoomIds?: Set<string>; eventWindows?: Map<string, { start: number; count: number }> } };
type Ack = (result: Record<string, unknown>) => void;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function ack(acknowledge: unknown, value: Record<string, unknown>) {
  if (typeof acknowledge === "function") (acknowledge as Ack)(value);
}

function success(data: Record<string, unknown> = {}) { return { ok: true, ...data }; }
function failure(error: string) { return { ok: false, error }; }

function logDiceRoll(correlationId: string, stage: string, details: Record<string, string | number | boolean> = {}) {
  // Temporary diagnostics contain only a random action UUID, stage and validated die value.
  // Never include room/user IDs, access tokens, passwords, or raw database errors.
  console.info("[rasmalai:game-roll]", { correlationId, stage, ...details });
}

function playerChatAccessError(denial: SocketRoomAccessDenial) {
  switch (denial) {
    case "missing_session":
    case "session_unverified":
      return "Your game session could not be verified. Reconnect to the room and try again.";
    case "identity_mismatch":
      return "Your sign-in session changed. Refresh the room to reconnect.";
    case "membership_unavailable":
      return "We could not verify your room seat right now. Check your connection and try again.";
    case "invalid_room":
    case "not_a_member":
      return "Player chat is available only to current players in this room.";
  }
}

function dbError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("rematch") || message.includes("completed match membership")) return "This rematch is no longer available. Refresh the room and try again.";
  if (message.includes("spectator invitation") || message.includes("spectator access")) return "A valid spectator invitation or active spectator access is required.";
  if (message.includes("spectator") && message.includes("player")) return "Only match players can manage spectator access.";
  if (message.includes("private live match")) return "Spectators can only be invited to a private match in progress.";
  if (message.includes("invitation")) return "A valid invitation is required for this private room.";
  if (message.includes("room not found")) return "Room not found.";
  if (message.includes("room is full") || message.includes("no open seats")) return "This room is full.";
  if (message.includes("already started")) return "This match has already started.";
  if (message.includes("already joined")) return "That player already joined this room.";
  if (message.includes("valid username")) return "Enter a valid player username.";
  return "The game service could not complete that request. Refresh and try again.";
}

function withinLimit(socket: AuthSocket, name: string, max: number, windowMs: number) {
  const now = Date.now();
  const windows = socket.data.eventWindows ??= new Map();
  const current = windows.get(name);
  if (!current || now - current.start > windowMs) {
    windows.set(name, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

async function withinSharedLimit(socket: AuthSocket, action: RateLimitAction) {
  try {
    return await consumeSharedRateLimit(socket.data.supabaseAccessToken, action);
  } catch {
    // Fail closed if PostgreSQL cannot provide the shared abuse-control decision.
    return false;
  }
}

type GameRoomSocketDependencies = {
  verifyRoomMembership?: typeof verifySocketRoomMembership;
  sendPlayerChat?: typeof sendChat;
  checkSharedLimit?: typeof withinSharedLimit;
  spectatorModeEnabled?: () => boolean;
};

function roomIdFrom(value: unknown): string | null {
  if (typeof value === "string") return ROOM_ID_PATTERN.test(value) ? value : null;
  const payload = object(value);
  const id = payload?.roomId;
  return typeof id === "string" && ROOM_ID_PATTERN.test(id) ? id : null;
}

async function playerAccess(socket: AuthSocket, roomId: string): Promise<RoomAccess | null> {
  const access = await authorizeSocketRoomMembership(roomId, socket.data, fetch);
  return access?.role === "player" ? access : null;
}

async function spectatorAccess(socket: AuthSocket, roomId: string): Promise<RoomAccess | null> {
  const access = await authorizeSocketRoomMembership(roomId, socket.data, fetch);
  return access?.role === "spectator" && access.permissions.submitAction === false ? access : null;
}

function rememberRoom(socket: AuthSocket, roomId: string) {
  socket.data.onlineRoomIds ??= new Set();
  socket.data.onlineRoomIds.add(roomId);
}

function forgetRoom(socket: AuthSocket, roomId: string) {
  socket.data.onlineRoomIds?.delete(roomId);
}

function rememberSpectatorRoom(socket: AuthSocket, roomId: string) {
  socket.data.spectatorRoomIds ??= new Set();
  socket.data.spectatorRoomIds.add(roomId);
}

function forgetSpectatorRoom(socket: AuthSocket, roomId: string) {
  socket.data.spectatorRoomIds?.delete(roomId);
}

async function removeSpectatorsForRoom(io: Server, roomId: string) {
  const watchers = await io.in(SPECTATOR_CHANNEL(roomId)).fetchSockets();
  for (const watcher of watchers) {
    const target = watcher as unknown as AuthSocket;
    target.emit("spectator:disabled", { roomId, message: SPECTATOR_MODE_DISABLED_MESSAGE });
    await target.leave(SPECTATOR_CHANNEL(roomId));
    forgetSpectatorRoom(target, roomId);
  }
}

async function emitPresence(io: Server, roomId: string, spectatorModeEnabled: () => boolean) {
  const sockets = await io.in(ROOM_CHANNEL(roomId)).fetchSockets();
  const connectedPlayerIds = [...new Set(sockets.map((socket) => (socket.data as AuthSocket["data"]).userId))];
  io.to(ROOM_CHANNEL(roomId)).emit("room:presence", { roomId, connectedPlayerIds });
  if (spectatorModeEnabled()) io.to(SPECTATOR_CHANNEL(roomId)).emit("room:presence", { roomId, connectedPlayerIds });
  else await removeSpectatorsForRoom(io, roomId);
}

async function emitSpectatorCount(io: Server, socket: AuthSocket, roomId: string, spectatorModeEnabled: () => boolean) {
  if (!spectatorModeEnabled()) {
    await removeSpectatorsForRoom(io, roomId);
    return;
  }
  try {
    const count = await getSpectatorCount(socket.data.supabaseAccessToken, roomId);
    broadcastSpectatorCount(io, roomId, count, spectatorModeEnabled);
  } catch { /* the board remains usable if a transient count refresh fails */ }
}

function broadcastSpectatorCount(io: Server, roomId: string, count: number, spectatorModeEnabled: () => boolean) {
  if (!spectatorModeEnabled()) return;
  const event = { roomId, count };
  io.to(ROOM_CHANNEL(roomId)).emit("spectator:count", event);
  io.to(SPECTATOR_CHANNEL(roomId)).emit("spectator:count", event);
}

async function startIfReady(token: string, room: OnlineRoomSnapshot) {
  if (room.status !== "IN_PROGRESS" || room.state || room.players.length !== room.maxPlayers) return room;
  const state = createOnlineGameState(room.gameType, room.players);
  return initializeMatch(token, room.roomId, state);
}

function parseIntent(value: unknown): PlayerGameAction | null {
  const payload = object(value);
  if (!payload || (payload.type !== "roll" && payload.type !== "move")) return null;
  if (payload.type === "roll") return { type: "roll" }; // Client dice values are deliberately ignored.
  if (payload.cell !== undefined && (typeof payload.cell !== "number" || !Number.isInteger(payload.cell))) return null;
  if (payload.tokenIndex !== undefined && (typeof payload.tokenIndex !== "number" || !Number.isInteger(payload.tokenIndex))) return null;
  return { type: "move", ...(typeof payload.cell === "number" ? { cell: payload.cell } : {}), ...(typeof payload.tokenIndex === "number" ? { tokenIndex: payload.tokenIndex } : {}) };
}

export async function syncSnapshot(
  io: Server,
  socket: AuthSocket,
  snapshot: OnlineRoomSnapshot,
  spectatorModeEnabled: () => boolean = () => isFeatureFlagEnabled(process.env.SPECTATOR_MODE_ENABLED),
) {
  if (!spectatorModeEnabled()) await removeSpectatorsForRoom(io, snapshot.roomId);
  const spectatorSnapshot = { ...snapshot, rematch: null };
  io.to(ROOM_CHANNEL(snapshot.roomId)).emit("room:snapshot", snapshot);
  if (spectatorModeEnabled()) io.to(SPECTATOR_CHANNEL(snapshot.roomId)).emit("room:snapshot", spectatorSnapshot);
  socket.emit("room:snapshot", snapshot);
  await emitPresence(io, snapshot.roomId, spectatorModeEnabled);
}

async function watchAsSpectator(io: Server, socket: AuthSocket, roomId: string, acknowledge: unknown, spectatorModeEnabled: () => boolean) {
  if (!spectatorModeEnabled()) return ack(acknowledge, failure(SPECTATOR_MODE_DISABLED_MESSAGE));
  try {
    // The guarded RPC creates or reactivates an authorized roster row before the
    // socket enters the dedicated spectator channel. Reload after joining to close
    // the small race where a player move lands during the subscription handshake.
    await watchRoom(socket.data.supabaseAccessToken, roomId);
    if (!spectatorModeEnabled()) return ack(acknowledge, failure(SPECTATOR_MODE_DISABLED_MESSAGE));
    const access = await spectatorAccess(socket, roomId);
    if (!access) return ack(acknowledge, failure("You are not authorized to spectate this match."));
    await socket.join(SPECTATOR_CHANNEL(roomId));
    rememberSpectatorRoom(socket, roomId);
    const snapshot = await watchRoom(socket.data.supabaseAccessToken, roomId);
    if (!spectatorModeEnabled()) {
      await socket.leave(SPECTATOR_CHANNEL(roomId));
      forgetSpectatorRoom(socket, roomId);
      return ack(acknowledge, failure(SPECTATOR_MODE_DISABLED_MESSAGE));
    }
    const spectatorSnapshot = { ...snapshot, rematch: null };
    socket.emit("room:snapshot", spectatorSnapshot);
    socket.emit("spectator:chat:history", await getSpectatorChatHistory(socket.data.supabaseAccessToken, roomId));
    await emitSpectatorCount(io, socket, roomId, spectatorModeEnabled);
    io.emit("rooms:changed");
    ack(acknowledge, success({ room: spectatorSnapshot, spectatorCount: snapshot.spectatorCount ?? 0 }));
  } catch (error) {
    await socket.leave(SPECTATOR_CHANNEL(roomId));
    forgetSpectatorRoom(socket, roomId);
    if (!spectatorModeEnabled()) return ack(acknowledge, failure(SPECTATOR_MODE_DISABLED_MESSAGE));
    try {
      const invite = await spectatorInviteInfo(socket.data.supabaseAccessToken, roomId);
      ack(acknowledge, failure(invite.status === "PENDING" ? "A spectator invitation must be accepted before watching." : "Spectator access is no longer available."));
    } catch {
      ack(acknowledge, failure(dbError(error)));
    }
  }
}

async function enterRoom(io: Server, socket: AuthSocket, rawRoomId: unknown, acknowledge: unknown, spectatorModeEnabled: () => boolean) {
  const roomId = roomIdFrom(rawRoomId);
  if (!roomId) return ack(acknowledge, failure("Choose a valid room."));
  if (!withinLimit(socket, "room:join", 12, 10_000)) return ack(acknowledge, failure("Room joins are temporarily limited. Try again shortly."));
  if (!(await withinSharedLimit(socket, "room_join"))) return ack(acknowledge, failure("Room joins are temporarily limited. Try again shortly."));
  try {
    const joined = await joinRoom(socket.data.supabaseAccessToken, roomId);
    const access = await playerAccess(socket, roomId);
    if (!access) return ack(acknowledge, failure("You are not a player in this room."));
    const ready = await startIfReady(socket.data.supabaseAccessToken, joined);
    const snapshot = await loadRoom(socket.data.supabaseAccessToken, roomId);
    await setPresence(socket.data.supabaseAccessToken, roomId, true);
    await socket.join(ROOM_CHANNEL(roomId));
    rememberRoom(socket, roomId);
    await syncSnapshot(io, socket, snapshot.state ? snapshot : ready, spectatorModeEnabled);
    await emitSpectatorCount(io, socket, roomId, spectatorModeEnabled);
    socket.emit("chat:history", await getChatHistory(socket.data.supabaseAccessToken, roomId));
    io.emit("rooms:changed");
    ack(acknowledge, success({ room: snapshot.state ? snapshot : ready }));
  } catch (error) {
    ack(acknowledge, failure(dbError(error)));
  }
}

async function setRoomPresence(io: Server, socket: AuthSocket, roomId: string, connected: boolean, spectatorModeEnabled: () => boolean) {
  try {
    if (connected) await setPresence(socket.data.supabaseAccessToken, roomId, true);
    else {
      const otherSockets = await io.in(ROOM_CHANNEL(roomId)).fetchSockets();
      const samePlayerStillConnected = otherSockets.some((other) => (other.data as AuthSocket["data"]).userId === socket.data.userId && other.id !== socket.id);
      await setPresence(socket.data.supabaseAccessToken, roomId, samePlayerStillConnected);
    }
    await emitPresence(io, roomId, spectatorModeEnabled);
  } catch {
    // The roster and last known state remain available; a later reconnect refreshes presence.
  }
}

type SignalCandidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };

function safeSignal(value: unknown): { type: "description"; description: { type: "offer" | "answer"; sdp: string } } | { type: "candidate"; candidate: SignalCandidate } | null {
  const payload = object(value);
  if (!payload) return null;
  if (payload.type === "description") {
    const description = object(payload.description);
    if ((description?.type !== "offer" && description?.type !== "answer") || typeof description.sdp !== "string" || description.sdp.length > 24000) return null;
    return { type: "description", description: { type: description.type, sdp: description.sdp } };
  }
  if (payload.type === "candidate") {
    const candidate = object(payload.candidate);
    if (!candidate || typeof candidate.candidate !== "string" || candidate.candidate.length > 3000) return null;
    if (candidate.sdpMid !== undefined && candidate.sdpMid !== null && typeof candidate.sdpMid !== "string") return null;
    if (candidate.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null && typeof candidate.sdpMLineIndex !== "number") return null;
    if (candidate.usernameFragment !== undefined && candidate.usernameFragment !== null && typeof candidate.usernameFragment !== "string") return null;
    return { type: "candidate", candidate: candidate as SignalCandidate };
  }
  return null;
}

export function registerGameRoomSocket(io: Server, socketBase: Socket, dependencies: GameRoomSocketDependencies = {}) {
  const socket = socketBase as AuthSocket;
  const verifyRoomMembership = dependencies.verifyRoomMembership ?? ((roomId, data) => verifySocketRoomMembership(roomId, data, fetch));
  const sendPlayerChat = dependencies.sendPlayerChat ?? sendChat;
  const checkSharedLimit = dependencies.checkSharedLimit ?? withinSharedLimit;
  const spectatorModeEnabled = dependencies.spectatorModeEnabled ?? (() => isFeatureFlagEnabled(process.env.SPECTATOR_MODE_ENABLED));
  const requireSpectatorMode = (acknowledge: unknown) => {
    if (spectatorModeEnabled()) return true;
    ack(acknowledge, failure(SPECTATOR_MODE_DISABLED_MESSAGE));
    return false;
  };

  socket.on("room:list", async (acknowledge) => {
    if (!withinLimit(socket, "room:list", 20, 10_000)) return ack(acknowledge, failure("Please wait before refreshing rooms."));
    if (!(await checkSharedLimit(socket, "room_list"))) return ack(acknowledge, failure("Room requests are temporarily limited. Try again shortly."));
    try { ack(acknowledge, success({ rooms: await listPublicRooms(socket.data.supabaseAccessToken) })); }
    catch { ack(acknowledge, failure("Online rooms are unavailable right now.")); }
  });

  socket.on("spectator:list", async (acknowledge) => {
    if (!requireSpectatorMode(acknowledge)) return;
    if (!withinLimit(socket, "spectator:list", 20, 10_000)) return ack(acknowledge, failure("Please wait before refreshing live matches."));
    if (!(await checkSharedLimit(socket, "spectator_list"))) return ack(acknowledge, failure("Live match requests are temporarily limited. Try again shortly."));
    try { ack(acknowledge, success({ rooms: await listPublicLiveRooms(socket.data.supabaseAccessToken) })); }
    catch { ack(acknowledge, failure("Live matches are unavailable right now.")); }
  });

  socket.on("spectator:join", async (rawRoomId, acknowledge) => {
    if (!requireSpectatorMode(acknowledge)) return;
    const roomId = roomIdFrom(rawRoomId);
    if (!roomId || !withinLimit(socket, "spectator:join", 8, 10_000)) return ack(acknowledge, failure("Choose a valid live match."));
    if (!(await checkSharedLimit(socket, "spectator_join"))) return ack(acknowledge, failure("Spectator requests are temporarily limited. Try again shortly."));
    void watchAsSpectator(io, socket, roomId, acknowledge, spectatorModeEnabled);
  });

  socket.on("spectator:invite-info", async (rawRoomId, acknowledge) => {
    if (!requireSpectatorMode(acknowledge)) return;
    const roomId = roomIdFrom(rawRoomId);
    if (!roomId) return ack(acknowledge, failure("Choose a valid live match."));
    if (!withinLimit(socket, "spectator:invite-info", 20, 10_000)) return ack(acknowledge, failure("Live match requests are temporarily limited. Try again shortly."));
    if (!(await checkSharedLimit(socket, "spectator_list"))) return ack(acknowledge, failure("Live match requests are temporarily limited. Try again shortly."));
    if (!requireSpectatorMode(acknowledge)) return;
    try { ack(acknowledge, success({ invite: await spectatorInviteInfo(socket.data.supabaseAccessToken, roomId) })); }
    catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("spectator:accept", async (rawRoomId, acknowledge) => {
    if (!requireSpectatorMode(acknowledge)) return;
    const roomId = roomIdFrom(rawRoomId);
    if (!roomId || !withinLimit(socket, "spectator:accept", 5, 30_000)) return ack(acknowledge, failure("That invitation cannot be accepted right now."));
    if (!(await checkSharedLimit(socket, "spectator_accept"))) return ack(acknowledge, failure("Invitation requests are temporarily limited. Try again shortly."));
    if (!requireSpectatorMode(acknowledge)) return;
    try {
      await acceptSpectatorInvite(socket.data.supabaseAccessToken, roomId);
      await watchAsSpectator(io, socket, roomId, acknowledge, spectatorModeEnabled);
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("spectator:invite", async (rawPayload, acknowledge) => {
    if (!requireSpectatorMode(acknowledge)) return;
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const username = typeof payload?.username === "string" ? payload.username.trim() : "";
    if (!roomId || username.length < 3 || username.length > 24 || !withinLimit(socket, "spectator:invite", 8, 60_000)) {
      return ack(acknowledge, failure("Enter a valid username and try again."));
    }
    if (!(await checkSharedLimit(socket, "spectator_invite"))) return ack(acknowledge, failure("Spectator invitations are temporarily limited. Try again shortly."));
    if (!requireSpectatorMode(acknowledge)) return;
    try {
      if (!(await playerAccess(socket, roomId))) return ack(acknowledge, failure("Only match players can invite spectators."));
      const invite = await inviteSpectator(socket.data.supabaseAccessToken, roomId, username);
      io.to(ROOM_CHANNEL(roomId)).emit("spectator:invites:changed", { roomId });
      ack(acknowledge, success({ invite }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("spectator:invites", async (rawRoomId, acknowledge) => {
    if (!requireSpectatorMode(acknowledge)) return;
    const roomId = roomIdFrom(rawRoomId);
    if (!roomId) return ack(acknowledge, failure("Choose a valid live match."));
    if (!withinLimit(socket, "spectator:invites", 20, 10_000)) return ack(acknowledge, failure("Spectator invitations are temporarily limited. Try again shortly."));
    if (!(await checkSharedLimit(socket, "spectator_list"))) return ack(acknowledge, failure("Spectator invitations are temporarily limited. Try again shortly."));
    if (!requireSpectatorMode(acknowledge)) return;
    try {
      if (!(await playerAccess(socket, roomId))) return ack(acknowledge, failure("Only match players can view spectator invitations."));
      ack(acknowledge, success({ invites: await listSpectatorInvites(socket.data.supabaseAccessToken, roomId) }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("spectator:revoke", async (rawPayload, acknowledge) => {
    if (!requireSpectatorMode(acknowledge)) return;
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const inviteId = typeof payload?.inviteId === "string" && ROOM_ID_PATTERN.test(payload.inviteId) ? payload.inviteId : null;
    if (!roomId || !inviteId) return ack(acknowledge, failure("Choose an active spectator invitation."));
    if (!withinLimit(socket, "spectator:revoke", 8, 60_000)) return ack(acknowledge, failure("Spectator invitation changes are temporarily limited. Try again shortly."));
    if (!(await checkSharedLimit(socket, "spectator_invite"))) return ack(acknowledge, failure("Spectator invitations are temporarily limited. Try again shortly."));
    if (!requireSpectatorMode(acknowledge)) return;
    try {
      if (!(await playerAccess(socket, roomId))) return ack(acknowledge, failure("Only match players can revoke spectator access."));
      const recipientId = await revokeSpectatorInvite(socket.data.supabaseAccessToken, roomId, inviteId);
      const watchers = await io.in(SPECTATOR_CHANNEL(roomId)).fetchSockets();
      for (const watcher of watchers) {
        const target = watcher as unknown as AuthSocket;
        if (target.data.userId !== recipientId) continue;
        target.emit("spectator:revoked", { roomId });
        await target.leave(SPECTATOR_CHANNEL(roomId));
        forgetSpectatorRoom(target, roomId);
      }
      await emitSpectatorCount(io, socket, roomId, spectatorModeEnabled);
      io.to(ROOM_CHANNEL(roomId)).emit("spectator:invites:changed", { roomId });
      ack(acknowledge, success());
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("spectator:chat:send", async (rawPayload, acknowledge) => {
    if (!requireSpectatorMode(acknowledge)) return;
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const body = typeof payload?.body === "string" ? payload.body.trim() : "";
    if (!roomId || body.length < 1 || body.length > 500 || !withinLimit(socket, "spectator:chat:send", 8, 10_000)) {
      return ack(acknowledge, failure("Messages must be 1–500 characters. Please slow down."));
    }
    if (!(await checkSharedLimit(socket, "spectator_chat_send"))) return ack(acknowledge, failure("Spectator chat is temporarily limited. Try again shortly."));
    if (!requireSpectatorMode(acknowledge)) return;
    try {
      if (!socket.data.spectatorRoomIds?.has(roomId) || !(await spectatorAccess(socket, roomId))) {
        return ack(acknowledge, failure("Only active spectators can use spectator chat."));
      }
      const message = await sendSpectatorChat(socket.data.supabaseAccessToken, roomId, body);
      io.to(SPECTATOR_CHANNEL(roomId)).emit("spectator:chat:new", message);
      ack(acknowledge, success({ message }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("spectator:chat:react", async (rawPayload, acknowledge) => {
    if (!requireSpectatorMode(acknowledge)) return;
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const messageId = typeof payload?.messageId === "string" && ROOM_ID_PATTERN.test(payload.messageId) ? payload.messageId : null;
    const emoji = typeof payload?.emoji === "string" ? payload.emoji : "";
    if (!roomId || !messageId || !EMOJIS.has(emoji) || !withinLimit(socket, "spectator:chat:react", 20, 10_000)) {
      return ack(acknowledge, failure("That reaction is unavailable."));
    }
    if (!(await checkSharedLimit(socket, "spectator_chat_react"))) return ack(acknowledge, failure("Reactions are temporarily limited. Try again shortly."));
    if (!requireSpectatorMode(acknowledge)) return;
    try {
      if (!socket.data.spectatorRoomIds?.has(roomId) || !(await spectatorAccess(socket, roomId))) {
        return ack(acknowledge, failure("Only active spectators can react in spectator chat."));
      }
      const messages = await toggleSpectatorReaction(socket.data.supabaseAccessToken, roomId, messageId, emoji);
      io.to(SPECTATOR_CHANNEL(roomId)).emit("spectator:chat:history", messages);
      ack(acknowledge, success({ messages }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("spectator:heartbeat", async () => {
    if (!spectatorModeEnabled()) {
      for (const roomId of socket.data.spectatorRoomIds ?? []) {
        socket.emit("spectator:disabled", { roomId, message: SPECTATOR_MODE_DISABLED_MESSAGE });
        await socket.leave(SPECTATOR_CHANNEL(roomId));
        forgetSpectatorRoom(socket, roomId);
      }
      return;
    }
    for (const roomId of socket.data.spectatorRoomIds ?? []) {
      try {
        if (!(await spectatorAccess(socket, roomId))) {
          socket.emit("spectator:revoked", { roomId });
          await socket.leave(SPECTATOR_CHANNEL(roomId));
          forgetSpectatorRoom(socket, roomId);
          continue;
        }
        const count = await setSpectatorPresence(socket.data.supabaseAccessToken, roomId, true);
        broadcastSpectatorCount(io, roomId, count, spectatorModeEnabled);
      } catch {
        socket.emit("spectator:revoked", { roomId });
        await socket.leave(SPECTATOR_CHANNEL(roomId));
        forgetSpectatorRoom(socket, roomId);
      }
    }
  });

  socket.on("spectator:leave", async (rawRoomId) => {
    const roomId = roomIdFrom(rawRoomId);
    if (!roomId || !socket.data.spectatorRoomIds?.has(roomId)) return;
    if (!spectatorModeEnabled()) {
      socket.emit("spectator:disabled", { roomId, message: SPECTATOR_MODE_DISABLED_MESSAGE });
      await socket.leave(SPECTATOR_CHANNEL(roomId));
      forgetSpectatorRoom(socket, roomId);
      return;
    }
    const otherSockets = await io.in(SPECTATOR_CHANNEL(roomId)).fetchSockets();
    const sameUserStillWatching = otherSockets.some((other) => (other.data as AuthSocket["data"]).userId === socket.data.userId && other.id !== socket.id);
    try {
      const count = await setSpectatorPresence(socket.data.supabaseAccessToken, roomId, sameUserStillWatching, !sameUserStillWatching);
      broadcastSpectatorCount(io, roomId, count, spectatorModeEnabled);
    } catch { /* leave still removes this socket from the private channel */ }
    await socket.leave(SPECTATOR_CHANNEL(roomId));
    forgetSpectatorRoom(socket, roomId);
    io.emit("rooms:changed");
  });

  socket.on("room:create", async (rawPayload, acknowledge) => {
    if (!withinLimit(socket, "room:create", 3, 60_000)) return ack(acknowledge, failure("Please wait before creating another room."));
    const payload = object(rawPayload);
    const gameType = payload?.gameType;
    const visibility = payload?.visibility;
    const maxPlayers = payload?.maxPlayers;
    if (typeof gameType !== "string" || !GAME_TYPES.has(gameType) || (visibility !== "PUBLIC" && visibility !== "PRIVATE") || typeof maxPlayers !== "number" || !Number.isInteger(maxPlayers)) {
      return ack(acknowledge, failure("Choose a game, room type, and player count."));
    }
    if (!(await checkSharedLimit(socket, "room_create"))) return ack(acknowledge, failure("Room creation is temporarily limited. Try again shortly."));
    try {
      const room = await createRoom(socket.data.supabaseAccessToken, gameType as OnlineGameSnapshotType, visibility, maxPlayers);
      await socket.join(ROOM_CHANNEL(room.roomId));
      await setPresence(socket.data.supabaseAccessToken, room.roomId, true);
      rememberRoom(socket, room.roomId);
      await syncSnapshot(io, socket, room, spectatorModeEnabled);
      io.emit("rooms:changed");
      ack(acknowledge, success({ room }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("room:join", (roomId, acknowledge) => { void enterRoom(io, socket, roomId, acknowledge, spectatorModeEnabled); });
  socket.on("room:resume", (roomId, acknowledge) => { void enterRoom(io, socket, roomId, acknowledge, spectatorModeEnabled); });

  socket.on("room:invite", async (rawPayload, acknowledge) => {
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const username = typeof payload?.username === "string" ? payload.username.trim() : "";
    if (!roomId || username.length < 3 || username.length > 24 || !withinLimit(socket, "room:invite", 10, 60_000)) {
      return ack(acknowledge, failure("Enter a valid username and try again."));
    }
    if (!(await checkSharedLimit(socket, "room_invite"))) return ack(acknowledge, failure("Room invitations are temporarily limited. Try again shortly."));
    try { ack(acknowledge, success({ invite: await invitePlayer(socket.data.supabaseAccessToken, roomId, username) })); }
    catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("game:action", async (rawPayload, acknowledge) => {
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const actionId = payload?.actionId;
    const version = payload?.version;
    const intent = parseIntent(payload?.action);
    const rollCorrelationId = typeof actionId === "string" && ACTION_ID_PATTERN.test(actionId) ? actionId : null;
    if (!roomId || typeof actionId !== "string" || !ACTION_ID_PATTERN.test(actionId) || typeof version !== "number" || !Number.isInteger(version) || version < 0 || !intent) {
      if (intent?.type === "roll" && rollCorrelationId) {
        logDiceRoll(rollCorrelationId, "server_rejected", { reason: "invalid_request" });
        logDiceRoll(rollCorrelationId, "ack_sent", { ok: false, reason: "invalid_request" });
      }
      return ack(acknowledge, failure("That game action is invalid."));
    }
    if (intent.type === "roll" && rollCorrelationId) logDiceRoll(rollCorrelationId, "server_request_received");
    if (!withinLimit(socket, "game:action", 18, 10_000)) {
      if (intent.type === "roll" && rollCorrelationId) {
        logDiceRoll(rollCorrelationId, "server_rejected", { reason: "local_rate_limit" });
        logDiceRoll(rollCorrelationId, "ack_sent", { ok: false, reason: "rate_limited" });
      }
      return ack(acknowledge, failure("Too many game actions. Wait a moment."));
    }
    if (!(await checkSharedLimit(socket, "game_action"))) {
      if (intent.type === "roll" && rollCorrelationId) {
        logDiceRoll(rollCorrelationId, "server_rejected", { reason: "shared_rate_limit" });
        logDiceRoll(rollCorrelationId, "ack_sent", { ok: false, reason: "rate_limited" });
      }
      return ack(acknowledge, failure("Too many game actions. Wait a moment."));
    }
    try {
      const access = await playerAccess(socket, roomId);
      if (!access) {
        if (intent.type === "roll" && rollCorrelationId) {
          logDiceRoll(rollCorrelationId, "server_rejected", { reason: "authorization" });
          logDiceRoll(rollCorrelationId, "ack_sent", { ok: false, reason: "authorization" });
        }
        return ack(acknowledge, failure("Only room players can make a move."));
      }
      const current = await loadRoom(socket.data.supabaseAccessToken, roomId);
      if (current.version !== version) {
        await syncSnapshot(io, socket, current, spectatorModeEnabled);
        if (intent.type === "roll" && rollCorrelationId) {
          logDiceRoll(rollCorrelationId, "server_rejected", { reason: "stale_version" });
          logDiceRoll(rollCorrelationId, "ack_sent", { ok: false, reason: "stale_version" });
        }
        return ack(acknowledge, failure("The game updated. The latest position is shown."));
      }
      const applied = applyAuthoritativeGameAction(current, socket.data.userId, intent, undefined, actionId);
      if (intent.type === "roll" && rollCorrelationId && applied.action.type === "roll") {
        logDiceRoll(rollCorrelationId, "server_result_validated", { value: applied.action.die });
      }
      const saved = await persistAction(socket.data.supabaseAccessToken, roomId, version, actionId, applied);
      if (intent.type === "roll" && rollCorrelationId) logDiceRoll(rollCorrelationId, "database_commit_complete");
      await syncSnapshot(io, socket, saved, spectatorModeEnabled);
      if (intent.type === "roll" && rollCorrelationId) logDiceRoll(rollCorrelationId, "snapshot_broadcast_complete");
      io.emit("rooms:changed");
      if (intent.type === "roll" && rollCorrelationId) logDiceRoll(rollCorrelationId, "ack_sent", { ok: true });
      ack(acknowledge, success({ room: saved }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "It is not your turn." || message.startsWith("Choose ") || message.startsWith("This ") || message.startsWith("The die ") || message.startsWith("Roll a ")) {
        if (intent.type === "roll" && rollCorrelationId) {
          logDiceRoll(rollCorrelationId, "server_rejected", { reason: "game_rule" });
          logDiceRoll(rollCorrelationId, "ack_sent", { ok: false, reason: "game_rule" });
        }
        return ack(acknowledge, failure(message));
      }
      if (intent.type === "roll" && rollCorrelationId) logDiceRoll(rollCorrelationId, "server_failure", { reason: "persistence_or_service_error" });
      try { await syncSnapshot(io, socket, await loadRoom(socket.data.supabaseAccessToken, roomId), spectatorModeEnabled); } catch { /* request remains denied */ }
      if (intent.type === "roll" && rollCorrelationId) logDiceRoll(rollCorrelationId, "ack_sent", { ok: false, reason: "service_error" });
      ack(acknowledge, failure(dbError(error)));
    }
  });

  socket.on("rematch:request", async (rawPayload, acknowledge) => {
    const roomId = roomIdFrom(rawPayload);
    if (!roomId || !withinLimit(socket, "rematch:request", 5, 60_000)) {
      return ack(acknowledge, failure("Rematch requests are temporarily limited. Try again shortly."));
    }
    if (!(await checkSharedLimit(socket, "rematch_request"))) return ack(acknowledge, failure("Rematch requests are temporarily limited. Try again shortly."));
    try {
      if (!(await playerAccess(socket, roomId))) return ack(acknowledge, failure("Only match players can request a rematch."));
      const current = await loadRoom(socket.data.supabaseAccessToken, roomId);
      if (current.status !== "COMPLETED" || current.players.length < 2) {
        return ack(acknowledge, failure("A completed match with its full roster is required."));
      }
      const nextStarter = ((current.startingSeat ?? 0) + 1) % current.players.length;
      const initialState = createOnlineGameState(current.gameType, current.players, nextStarter);
      const result = await applyRematchAction(socket.data.supabaseAccessToken, roomId, "request", null, null, initialState);
      await syncSnapshot(io, socket, result.room, spectatorModeEnabled);
      io.emit("rooms:changed");
      ack(acknowledge, success({ room: result.room, rematchStatus: result.status }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("rematch:respond", async (rawPayload, acknowledge) => {
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const requestId = typeof payload?.requestId === "string" && ROOM_ID_PATTERN.test(payload.requestId) ? payload.requestId : null;
    const accept = payload?.accept;
    if (!roomId || !requestId || typeof accept !== "boolean" || !withinLimit(socket, "rematch:respond", 12, 60_000)) {
      return ack(acknowledge, failure("Choose whether to accept or decline this rematch."));
    }
    if (!(await checkSharedLimit(socket, "rematch_response"))) return ack(acknowledge, failure("Rematch responses are temporarily limited. Try again shortly."));
    try {
      if (!(await playerAccess(socket, roomId))) return ack(acknowledge, failure("Only match players can respond to a rematch."));
      const current = await loadRoom(socket.data.supabaseAccessToken, roomId);
      const nextStarter = ((current.startingSeat ?? 0) + 1) % Math.max(1, current.players.length);
      const initialState = accept ? createOnlineGameState(current.gameType, current.players, nextStarter) : null;
      const result = await applyRematchAction(socket.data.supabaseAccessToken, roomId, "respond", requestId, accept, initialState);
      await syncSnapshot(io, socket, result.room, spectatorModeEnabled);
      io.emit("rooms:changed");
      ack(acknowledge, success({ room: result.room, rematchStatus: result.status }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("match:reaction", async (rawPayload, acknowledge) => {
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const emoji = typeof payload?.emoji === "string" ? payload.emoji : "";
    if (!roomId || !EMOJIS.has(emoji) || !withinLimit(socket, "match:reaction", 12, 10_000)) {
      return ack(acknowledge, failure("That match reaction is unavailable."));
    }
    if (!(await checkSharedLimit(socket, "match_reaction"))) return ack(acknowledge, failure("Match reactions are temporarily limited. Try again shortly."));
    try {
      if (!(await playerAccess(socket, roomId))) return ack(acknowledge, failure("Only match players can react to the game."));
      const room = await loadRoom(socket.data.supabaseAccessToken, roomId);
      if (room.status !== "IN_PROGRESS") return ack(acknowledge, failure("Reactions are closed for this match."));
      const player = room.players.find((entry) => entry.profileId === socket.data.userId);
      if (!player) return ack(acknowledge, failure("Only match players can react to the game."));
      const reaction = { roomId, profileId: player.profileId, playerName: player.name, emoji, createdAt: new Date().toISOString() };
      io.to(ROOM_CHANNEL(roomId)).emit("match:reaction", reaction);
      if (spectatorModeEnabled()) io.to(SPECTATOR_CHANNEL(roomId)).emit("match:reaction", reaction);
      else await removeSpectatorsForRoom(io, roomId);
      ack(acknowledge, success({ reaction }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("chat:send", async (rawPayload, acknowledge) => {
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const body = typeof payload?.body === "string" ? payload.body.trim() : "";
    if (!roomId || body.length < 1 || body.length > 500 || !withinLimit(socket, "chat:send", 8, 10_000)) {
      return ack(acknowledge, failure("Messages must be 1–500 characters. Please slow down."));
    }
    if (!(await checkSharedLimit(socket, "player_chat_send"))) return ack(acknowledge, failure("Chat is temporarily limited. Try again shortly."));
    try {
      const authorization = await verifyRoomMembership(roomId, socket.data);
      if (!authorization.access) return ack(acknowledge, failure(playerChatAccessError(authorization.denial)));
      if (authorization.access.role !== "player") return ack(acknowledge, failure("Player chat is available only to current players in this room."));
      const message = await sendPlayerChat(socket.data.supabaseAccessToken, roomId, body);
      io.to(ROOM_CHANNEL(roomId)).emit("chat:new", message);
      ack(acknowledge, success({ message }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("chat:react", async (rawPayload, acknowledge) => {
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const messageId = typeof payload?.messageId === "string" && ROOM_ID_PATTERN.test(payload.messageId) ? payload.messageId : null;
    const emoji = typeof payload?.emoji === "string" ? payload.emoji : "";
    if (!roomId || !messageId || !EMOJIS.has(emoji) || !withinLimit(socket, "chat:react", 20, 10_000)) {
      return ack(acknowledge, failure("That reaction is unavailable."));
    }
    if (!(await checkSharedLimit(socket, "player_chat_react"))) return ack(acknowledge, failure("Reactions are temporarily limited. Try again shortly."));
    try {
      if (!(await playerAccess(socket, roomId))) return ack(acknowledge, failure("Only room players can react."));
      const messages = await toggleReaction(socket.data.supabaseAccessToken, roomId, messageId, emoji);
      io.to(ROOM_CHANNEL(roomId)).emit("chat:history", messages);
      ack(acknowledge, success({ messages }));
    } catch (error) { ack(acknowledge, failure(dbError(error))); }
  });

  socket.on("room:heartbeat", async () => {
    for (const roomId of socket.data.onlineRoomIds ?? []) await setRoomPresence(io, socket, roomId, true, spectatorModeEnabled);
  });

  socket.on("room:leave", async (rawRoomId) => {
    const roomId = roomIdFrom(rawRoomId);
    if (!roomId) return;
    await leaveVoice(io, socket, roomId);
    await socket.leave(ROOM_CHANNEL(roomId));
    forgetRoom(socket, roomId);
    await setRoomPresence(io, socket, roomId, false, spectatorModeEnabled);
  });

  socket.on("voice:join", async (rawRoomId, acknowledge) => {
    const roomId = roomIdFrom(rawRoomId);
    if (!roomId || !withinLimit(socket, "voice:join", 10, 10_000)) return ack(acknowledge, failure("Voice chat could not be joined."));
    if (!(await checkSharedLimit(socket, "voice_join"))) return ack(acknowledge, failure("Voice chat is temporarily limited. Try again shortly."));
    try {
      if (!(await playerAccess(socket, roomId))) return ack(acknowledge, failure("Only match players can join voice chat."));
      socket.data.voiceRoomIds ??= new Set();
      socket.data.voiceRoomIds.add(roomId);
      const peers = (await io.in(ROOM_CHANNEL(roomId)).fetchSockets())
        .filter((peer) => (peer.data as AuthSocket["data"]).userId !== socket.data.userId && (peer.data as AuthSocket["data"]).voiceRoomIds?.has(roomId))
        .map((peer) => (peer.data as AuthSocket["data"]).userId);
      socket.emit("voice:participants", { roomId, playerIds: [...new Set(peers)] });
      socket.to(ROOM_CHANNEL(roomId)).emit("voice:peer-joined", { roomId, playerId: socket.data.userId });
      ack(acknowledge, success({ playerIds: peers }));
    } catch { ack(acknowledge, failure("Only match players can join voice chat.")); }
  });

  // Authorize membership before the browser asks for microphone permission.
  socket.on("voice:authorize", async (rawRoomId, acknowledge) => {
    const roomId = roomIdFrom(rawRoomId);
    if (!roomId) return ack(acknowledge, failure("Choose a valid game room."));
    if (!(await checkSharedLimit(socket, "voice_join"))) return ack(acknowledge, failure("Voice chat is temporarily limited. Try again shortly."));
    try {
      if (!(await playerAccess(socket, roomId))) return ack(acknowledge, failure("Only match players can join voice chat."));
      ack(acknowledge, success());
    } catch { ack(acknowledge, failure("Only match players can join voice chat.")); }
  });

  socket.on("voice:signal", async (rawPayload, acknowledge) => {
    const payload = object(rawPayload);
    const roomId = roomIdFrom(payload?.roomId);
    const toUserId = typeof payload?.toUserId === "string" && ROOM_ID_PATTERN.test(payload.toUserId) ? payload.toUserId : null;
    const signal = safeSignal(payload?.signal);
    if (!roomId || !toUserId || !signal || !withinLimit(socket, "voice:signal", 60, 10_000)) {
      return ack(acknowledge, failure("Voice signal is invalid or too frequent."));
    }
    if (!(await checkSharedLimit(socket, "voice_signal"))) return ack(acknowledge, failure("Voice signaling is temporarily limited. Try again shortly."));
    try {
      if (!(await playerAccess(socket, roomId)) || !socket.data.voiceRoomIds?.has(roomId)) {
        return ack(acknowledge, failure("Join voice chat before sending a signal."));
      }
      const targets = (await io.in(ROOM_CHANNEL(roomId)).fetchSockets())
        .filter((peer) => (peer.data as AuthSocket["data"]).userId === toUserId && (peer.data as AuthSocket["data"]).voiceRoomIds?.has(roomId));
      if (targets.length === 0) return ack(acknowledge, failure("That player is not in voice chat."));
      for (const target of targets) target.emit("voice:signal", { roomId, fromUserId: socket.data.userId, signal });
      ack(acknowledge, success());
    } catch { ack(acknowledge, failure("Voice signal could not be delivered.")); }
  });

  socket.on("voice:leave", async (rawRoomId) => {
    const roomId = roomIdFrom(rawRoomId);
    if (roomId) await leaveVoice(io, socket, roomId);
  });

  socket.on("disconnect", async () => {
    for (const roomId of socket.data.onlineRoomIds ?? []) {
      await leaveVoice(io, socket, roomId);
      await setRoomPresence(io, socket, roomId, false, spectatorModeEnabled);
    }
    for (const roomId of socket.data.spectatorRoomIds ?? []) {
      if (!spectatorModeEnabled()) continue;
      const otherSockets = await io.in(SPECTATOR_CHANNEL(roomId)).fetchSockets();
      const sameUserStillWatching = otherSockets.some((other) => (other.data as AuthSocket["data"]).userId === socket.data.userId && other.id !== socket.id);
      try {
        const count = await setSpectatorPresence(socket.data.supabaseAccessToken, roomId, sameUserStillWatching, false);
        broadcastSpectatorCount(io, roomId, count, spectatorModeEnabled);
      } catch { /* revoked or stale socket; nothing further to expose */ }
    }
    socket.data.onlineRoomIds?.clear();
    socket.data.spectatorRoomIds?.clear();
  });
}

async function leaveVoice(io: Server, socket: AuthSocket, roomId: string) {
  if (!socket.data.voiceRoomIds?.delete(roomId)) return;
  socket.to(ROOM_CHANNEL(roomId)).emit("voice:peer-left", { roomId, playerId: socket.data.userId });
}

type OnlineGameSnapshotType = "LUDO" | "TIC_TAC_TOE" | "SNAKES_AND_LADDERS";

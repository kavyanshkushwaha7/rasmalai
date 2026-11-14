import { verifySupabaseAccessToken } from "./supabase-auth.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RoomRole = "player" | "spectator";

export type RoomPermissions = {
  readState: true;
  submitAction: boolean;
  playerChat: boolean;
  playerVoice: boolean;
  spectatorChat: boolean;
};

export type RoomAccess = {
  role: RoomRole;
  permissions: RoomPermissions;
};

export type RoomMembershipLookup = {
  isPlayer(roomId: string, userId: string): Promise<boolean>;
  isSpectator(roomId: string, userId: string): Promise<boolean>;
};

export type AuthenticatedRoomSocket = {
  userId: string;
  supabaseAccessToken: string;
};

export type SocketRoomAccessDenial =
  | "invalid_room"
  | "missing_session"
  | "session_unverified"
  | "identity_mismatch"
  | "membership_unavailable"
  | "not_a_member";

export type SocketRoomAccessResult =
  | { access: RoomAccess; denial?: never }
  | { access: null; denial: SocketRoomAccessDenial };

/** Fail closed when membership is absent or inconsistent; spectators are read-only. */
export async function authorizeRoomMembership(
  roomId: string,
  userId: string,
  lookup: RoomMembershipLookup,
): Promise<RoomAccess | null> {
  if (!roomId || !userId) return null;
  const isPlayer = await lookup.isPlayer(roomId, userId);
  // Current player membership is authoritative for player actions. A stale or
  // overlapping spectator row or unavailable spectator lookup must not lock
  // an actual room player out.
  if (isPlayer) return { role: "player", permissions: { readState: true, submitAction: true, playerChat: true, playerVoice: true, spectatorChat: false } };
  const isSpectator = await lookup.isSpectator(roomId, userId);
  if (!isSpectator) return null;
  return { role: "spectator", permissions: { readState: true, submitAction: false, playerChat: false, playerVoice: false, spectatorChat: true } };
}

export function createSupabaseRoomMembershipLookup(
  accessToken: string,
  userId: string,
  fetcher: typeof fetch = fetch,
): RoomMembershipLookup {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured for room membership checks.");
  const publishableKey: string = key;

  async function isMember(table: "room_players" | "spectators", roomId: string): Promise<boolean> {
    const endpoint = new URL(`/rest/v1/${table}`, url);
    endpoint.searchParams.set("select", "id");
    endpoint.searchParams.set("room_id", `eq.${roomId}`);
    endpoint.searchParams.set("profile_id", `eq.${userId}`);
    if (table === "spectators") endpoint.searchParams.set("left_at", "is.null");
    endpoint.searchParams.set("limit", "1");
    const response = await fetcher(endpoint, {
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Room membership is unavailable.");
    const rows: unknown = await response.json();
    return Array.isArray(rows) && rows.length > 0;
  }

  return {
    isPlayer: (roomId) => isMember("room_players", roomId),
    isSpectator: (roomId) => isMember("spectators", roomId),
  };
}

/** Verify the socket token again, then ask RLS whether that user has a roster row. */
export async function verifySocketRoomMembership(
  roomId: string,
  socket: AuthenticatedRoomSocket,
  fetcher: typeof fetch = fetch,
): Promise<SocketRoomAccessResult> {
  if (!UUID_PATTERN.test(roomId)) return { access: null, denial: "invalid_room" };
  if (!socket.userId || !socket.supabaseAccessToken) return { access: null, denial: "missing_session" };
  const verified = await verifySupabaseAccessToken(socket.supabaseAccessToken, fetcher);
  if (!verified) return { access: null, denial: "session_unverified" };
  if (verified.id !== socket.userId) return { access: null, denial: "identity_mismatch" };
  try {
    const access = await authorizeRoomMembership(
      roomId,
      verified.id,
      createSupabaseRoomMembershipLookup(socket.supabaseAccessToken, verified.id, fetcher),
    );
    return access ? { access } : { access: null, denial: "not_a_member" };
  } catch {
    return { access: null, denial: "membership_unavailable" };
  }
}

export async function authorizeSocketRoomMembership(
  roomId: string,
  socket: AuthenticatedRoomSocket,
  fetcher: typeof fetch = fetch,
): Promise<RoomAccess | null> {
  return (await verifySocketRoomMembership(roomId, socket, fetcher)).access;
}

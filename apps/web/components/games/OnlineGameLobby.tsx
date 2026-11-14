"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe2, LockKeyhole, RefreshCw, UsersRound } from "lucide-react";
import { OnlineShell } from "@/components/games/OnlineShell";
import { useRealtimeSocket, type RealtimeStatus } from "@/lib/realtime/useRealtimeSocket";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";

type CreationGame = "LUDO" | "TIC_TAC_TOE" | "SNAKES_AND_LADDERS";
type RoomListResult = { ok: boolean; rooms?: OnlineRoomSnapshot[]; error?: string };
type LiveRoomListResult = { ok: boolean; rooms?: OnlineRoomSnapshot[]; error?: string };

const catalog: Array<{ id: CreationGame; name: string; players: string; blurb: string }> = [
  { id: "LUDO", name: "Ludo", players: "4 players", blurb: "Race four colored crews around the classic clockwise loop." },
  { id: "TIC_TAC_TOE", name: "Tic Tac Toe", players: "2 players", blurb: "A quick head-to-head round, synced turn by turn." },
  { id: "SNAKES_AND_LADDERS", name: "Snakes & Ladders", players: "2–4 players", blurb: "Climb, slide, and chase the exact finish together." },
];

function statusText(status: RealtimeStatus, connectionError: string | null) {
  if (connectionError) return connectionError;
  return status === "connected" ? "Realtime connected" : status === "connecting" ? "Connecting to game service…" : "Game service is unavailable. Retry the connection.";
}

export function OnlineGameLobby({ spectatorModeEnabled = false }: { spectatorModeEnabled?: boolean }) {
  const router = useRouter();
  const { socket, status, connectionError, retry } = useRealtimeSocket();
  const [gameType, setGameType] = useState<CreationGame>("LUDO");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [snakesPlayerCount, setSnakesPlayerCount] = useState(2);
  const [rooms, setRooms] = useState<OnlineRoomSnapshot[]>([]);
  const [liveRooms, setLiveRooms] = useState<OnlineRoomSnapshot[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [roomListError, setRoomListError] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const maxPlayers = gameType === "LUDO" ? 4 : gameType === "TIC_TAC_TOE" ? 2 : snakesPlayerCount;
  const selectedGame = useMemo(() => catalog.find((game) => game.id === gameType)!, [gameType]);

  const refreshRooms = useCallback(() => {
    if (!socket?.connected) return;
    setLoadingRooms(true);
    setRoomListError("");
    socket.emit("room:list", (result: RoomListResult) => {
      setLoadingRooms(false);
      setRoomsLoaded(true);
      if (result.ok && result.rooms) setRooms(result.rooms);
      else setRoomListError(result.error ?? "Public rooms are unavailable right now.");
    });
  }, [socket]);

  const retryRealtime = useCallback(() => {
    if (socket?.connected) refreshRooms();
    else retry();
  }, [refreshRooms, retry, socket]);

  const refreshLiveRooms = useCallback(() => {
    if (!spectatorModeEnabled || !socket?.connected) return;
    socket.emit("spectator:list", (result: LiveRoomListResult) => {
      if (result.ok && result.rooms) setLiveRooms(result.rooms);
    });
  }, [socket, spectatorModeEnabled]);

  useEffect(() => {
    if (!socket) return;
    socket.on("connect", refreshRooms);
    socket.on("rooms:changed", refreshRooms);
    if (spectatorModeEnabled) socket.on("rooms:changed", refreshLiveRooms);
    if (socket.connected) {
      refreshRooms();
      if (spectatorModeEnabled) refreshLiveRooms();
    }
    return () => {
      socket.off("connect", refreshRooms);
      socket.off("rooms:changed", refreshRooms);
      if (spectatorModeEnabled) socket.off("rooms:changed", refreshLiveRooms);
    };
  }, [socket, refreshLiveRooms, refreshRooms, spectatorModeEnabled]);

  function createRoom() {
    if (!socket?.connected) return setError("Wait for the realtime service to connect.");
    setCreating(true);
    setError("");
    socket.emit("room:create", { gameType, visibility, maxPlayers }, (result: { ok: boolean; room?: OnlineRoomSnapshot; error?: string }) => {
      setCreating(false);
      if (!result.ok || !result.room) return setError(result.error ?? "Could not create the room.");
      router.push(`/games/online/${result.room.roomId}`);
    });
  }

  function joinRoom(room: OnlineRoomSnapshot) {
    if (!socket?.connected) return setError("Wait for the realtime service to connect.");
    setError("");
    socket.emit("room:join", room.roomId, (result: { ok: boolean; error?: string }) => {
      if (result.ok) router.push(`/games/online/${room.roomId}`);
      else setError(result.error ?? "Could not join the room.");
    });
  }

  return <OnlineShell>
    <section className="online-hero">
      <div><span className="eyebrow eyebrow--light"><span className="eyebrow-dot" /> PLAY TOGETHER · PHASE 5</span><h1>Meet at the <em>board.</em></h1><p>Create a public match or invite your people to a private room. Every move and dice roll is checked on the game server.</p></div>
      <div className="online-hero-orbit" aria-hidden="true"><span>4</span><i>✦</i><b>●</b></div>
    </section>
    <div className={`online-service-status online-service-status--${status}`} role="status"><span />{statusText(status, connectionError)}{(status === "connected" || status === "error" || status === "disconnected") && <button type="button" onClick={retryRealtime} aria-label={status === "connected" ? "Refresh public rooms" : "Retry game service connection"}>{status === "connected" ? <RefreshCw size={14} /> : "Retry"}</button>}</div>
    {error && <p className="online-error" role="alert">{error}</p>}

    <section className="online-panel online-create-panel">
      <div className="online-panel-heading"><div><span className="eyebrow">START A NEW MATCH</span><h2>Choose your table.</h2></div><span className="online-panel-icon"><UsersRound size={18} /></span></div>
      <div className="online-game-picker" role="group" aria-label="Choose an online game">
        {catalog.map((game) => <button className={`online-game-choice online-game-choice--${game.id.toLowerCase().replaceAll("_", "-")} ${gameType === game.id ? "is-selected" : ""}`} key={game.id} type="button" aria-pressed={gameType === game.id} onClick={() => setGameType(game.id)}>
          <span>{game.players}</span><strong>{game.name}</strong><small>{game.blurb}</small>
        </button>)}
      </div>
      <div className="online-create-options">
        <div className="online-option-group"><span className="eyebrow">ROOM VISIBILITY</span><div className="online-segmented">
          <button type="button" className={visibility === "PUBLIC" ? "is-selected" : ""} onClick={() => setVisibility("PUBLIC")}><Globe2 size={15} /> Public</button>
          <button type="button" className={visibility === "PRIVATE" ? "is-selected" : ""} onClick={() => setVisibility("PRIVATE")}><LockKeyhole size={15} /> Invite only</button>
        </div></div>
        {gameType === "SNAKES_AND_LADDERS" && <label className="online-option-group online-player-count"><span className="eyebrow">PLAYERS</span><select value={snakesPlayerCount} onChange={(event) => setSnakesPlayerCount(Number(event.target.value))}><option value={2}>2 players</option><option value={3}>3 players</option><option value={4}>4 players</option></select></label>}
        <div className="online-create-summary"><span>{selectedGame.name} · {maxPlayers} human players</span><button className="button button--mint" type="button" onClick={createRoom} disabled={creating || status !== "connected"}>{creating ? "Creating…" : "Create room"}<ArrowRight size={16} /></button></div>
      </div>
      {visibility === "PRIVATE" && <p className="online-hint">Private rooms accept only players you invite by username. Room codes are not permission by themselves.</p>}
    </section>

    <section className="online-panel online-public-panel">
      <div className="online-panel-heading"><div><span className="eyebrow">PUBLIC TABLES</span><h2>Find an open game.</h2></div><span className="online-room-count">{rooms.length} open</span></div>
      {loadingRooms && <p className="online-empty">Checking open rooms…</p>}
      {!loadingRooms && rooms.length === 0 && roomListError && <div className="online-empty" role="alert"><Globe2 size={23} /><strong>Couldn’t load public rooms.</strong><span>{roomListError}</span></div>}
      {!loadingRooms && rooms.length === 0 && !roomListError && status !== "connected" && <div className="online-empty" role="status"><Globe2 size={23} /><strong>{status === "connecting" ? "Connecting to public tables…" : "Public rooms are unavailable."}</strong><span>{connectionError ?? "The room list will refresh automatically when the game service reconnects."}</span></div>}
      {!loadingRooms && rooms.length === 0 && !roomListError && status === "connected" && roomsLoaded && <div className="online-empty"><Globe2 size={23} /><strong>No public rooms yet.</strong><span>Create one and invite others to join.</span></div>}
      {rooms.length > 0 && <div className="online-room-list">{rooms.map((room) => <article className="online-room-row" key={room.roomId}>
        <div><span className="online-room-game">{catalog.find((game) => game.id === room.gameType)?.name ?? room.gameType}</span><strong>{room.players.map((player) => player.name).join(" · ")}</strong><small>{room.players.length} of {room.maxPlayers} seats filled · Public room</small></div>
        <button className="button button--soft" type="button" onClick={() => joinRoom(room)} disabled={status !== "connected" || room.players.length >= room.maxPlayers}>Join <ArrowRight size={14} /></button>
      </article>)}</div>}
      <p className="online-footnote">Human players only. Public rooms are listed while they are waiting for players.</p>
    </section>

    {spectatorModeEnabled && <section className="online-panel online-live-panel">
      <div className="online-panel-heading"><div><span className="eyebrow">LIVE SPECTATING</span><h2>Watch a match.</h2></div><span className="online-room-count">{liveRooms.length} live</span></div>
      {liveRooms.length === 0
        ? <div className="online-empty"><span aria-hidden="true">◉</span><strong>No public matches in progress.</strong><span>Live public games appear here while players are playing.</span></div>
        : <div className="online-room-list">{liveRooms.map((room) => <article className="online-room-row online-live-room-row" key={room.roomId}>
          <div><span className="online-room-game"><i className="online-live-pulse" />{catalog.find((game) => game.id === room.gameType)?.name ?? room.gameType}</span><strong>{room.players.map((player) => player.name).join(" · ")}</strong><small>{room.players.length} players · {room.spectatorCount ?? 0} watching · Public live match</small></div>
          <button className="button button--mint" type="button" onClick={() => router.push(`/games/online/${room.roomId}/watch`)} disabled={status !== "connected"}>Watch <ArrowRight size={14} /></button>
        </article>)}</div>}
      <p className="online-footnote">Watching is read-only. Spectators use a separate chat from the players.</p>
    </section>}
  </OnlineShell>;
}

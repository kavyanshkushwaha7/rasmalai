"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, Send, UsersRound } from "lucide-react";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";
import { SPECTATOR_MODE_DISABLED_MESSAGE } from "@rasmalai/game-engine/feature-flags";
import { OnlineGameBoards } from "@/components/games/OnlineGameBoards";
import { OnlineShell } from "@/components/games/OnlineShell";
import { useRealtimeSocket } from "@/lib/realtime/useRealtimeSocket";
import { getValidatedOnlineMoveAnimation, getValidatedOnlineRollCue, getValidatedOnlineTicTacToeCue, type OnlineMoveAnimation } from "@/lib/games/online-move-animation";
import { playArcadeSound } from "@/lib/games/arcade-audio";

type Reaction = { emoji: string; count: number; mine: boolean };
type ChatMessage = { id: string; roomId: string; authorId: string; authorName: string; body: string; createdAt: string; reactions?: Reaction[] };
type SpectatorInviteInfo = { roomId: string; status: string; gameType: string; roomCode: string; invitedBy: string; expiresAt: string };
type MatchReaction = { roomId: string; profileId: string; playerName: string; emoji: string; createdAt: string };
type Ack = { ok: boolean; error?: string; room?: OnlineRoomSnapshot; spectatorCount?: number; invite?: SpectatorInviteInfo; messages?: ChatMessage[] };
const EMOJIS = ["👍", "👏", "😂", "😮", "😢", "🎉", "❤️", "🔥"];

function title(game: OnlineRoomSnapshot["gameType"]) {
  return game === "TIC_TAC_TOE" ? "Tic Tac Toe" : game === "SNAKES_AND_LADDERS" ? "Snakes & Ladders" : "Ludo";
}

export function OnlineSpectatorRoom({ roomId, userId }: { roomId: string; userId: string }) {
  const router = useRouter();
  const { socket, status } = useRealtimeSocket();
  const [room, setRoom] = useState<OnlineRoomSnapshot | null>(null);
  const [invite, setInvite] = useState<SpectatorInviteInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const [matchReactions, setMatchReactions] = useState<MatchReaction[]>([]);
  const [moveAnimations, setMoveAnimations] = useState<OnlineMoveAnimation[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<OnlineRoomSnapshot | null>(null);
  const suppressSnapshotAnimation = useRef(false);

  const updateRoom = useCallback((next: OnlineRoomSnapshot, animateTransition = true) => {
    if (next.roomId !== roomId) return;
    const previous = roomRef.current;
    if (previous?.matchId && previous.matchId !== next.matchId && !(previous.status === "COMPLETED" && next.status === "IN_PROGRESS")) return;
    if (previous?.matchId && previous.matchId === next.matchId && previous.version !== null && next.version !== null && next.version < previous.version) return;
    if (!animateTransition || previous?.matchId !== next.matchId) setMoveAnimations([]);
    else if (previous?.version !== null && previous?.version !== undefined && next.version !== null && next.version !== previous.version) {
      if (next.version === previous.version + 1) {
        const rollCue = getValidatedOnlineRollCue(previous, next);
        if (rollCue) playArcadeSound(rollCue.id, "dice");
        const ticCue = getValidatedOnlineTicTacToeCue(previous, next);
        if (ticCue) {
          playArcadeSound(`${ticCue.id}:place`, "place");
          if (ticCue.result === "victory") playArcadeSound(`${ticCue.id}:victory`, "victory");
          else if (ticCue.result === "draw") playArcadeSound(`${ticCue.id}:draw`, "draw");
        }
        const move = getValidatedOnlineMoveAnimation(previous, next);
        if (move) setMoveAnimations((current) => current.some((entry) => entry.id === move.id) ? current : [...current, move]);
      } else if (next.version > previous.version + 1) setMoveAnimations([]);
    }
    roomRef.current = next;
    setRoom(next);
    if (typeof next.spectatorCount === "number") setCount(next.spectatorCount);
    setError("");
    setInvite(null);
  }, [roomId]);

  const completeMoveAnimation = useCallback((id: string) => {
    setMoveAnimations((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const clearDisabledSpectatorView = useCallback(() => {
    setRoom(null);
    roomRef.current = null;
    setMessages([]);
    setText("");
    setMoveAnimations([]);
    setMatchReactions([]);
    setInvite(null);
    setCount(0);
    setError(SPECTATOR_MODE_DISABLED_MESSAGE);
  }, []);

  const inspectInvite = useCallback(() => {
    if (!socket?.connected) return;
    socket.emit("spectator:invite-info", roomId, (result: Ack) => {
      if (result.ok && result.invite) setInvite(result.invite);
      else setError(result.error ?? "This match is private or no longer available to watch.");
    });
  }, [roomId, socket]);

  const join = useCallback(() => {
    if (!socket?.connected) return;
    setError("");
    suppressSnapshotAnimation.current = true;
    socket.emit("spectator:join", roomId, (result: Ack) => {
      if (result.ok && result.room) {
        updateRoom(result.room, false);
        setCount(result.spectatorCount ?? result.room.spectatorCount ?? 0);
      } else if (result.error === SPECTATOR_MODE_DISABLED_MESSAGE) clearDisabledSpectatorView();
      else inspectInvite();
      suppressSnapshotAnimation.current = false;
    });
  }, [clearDisabledSpectatorView, inspectInvite, roomId, socket, updateRoom]);

  useEffect(() => {
    if (!socket) return;
    const onSnapshot = (next: OnlineRoomSnapshot) => updateRoom(next, !suppressSnapshotAnimation.current);
    const onHistory = (history: ChatMessage[]) => setMessages(Array.isArray(history) ? history : []);
    const onMessage = (message: ChatMessage) => setMessages((current) => [...current.filter((entry) => entry.id !== message.id), message].slice(-50));
    const onCount = (event: { roomId: string; count: number }) => { if (event.roomId === roomId) setCount(event.count); };
    const onPresence = (presence: { roomId: string; connectedPlayerIds: string[] }) => {
      if (presence.roomId !== roomId) return;
      setRoom((current) => current ? {
        ...current,
        players: current.players.map((player) => ({ ...player, connected: presence.connectedPlayerIds.includes(player.profileId) })),
      } : current);
    };
    const onMatchReaction = (event: MatchReaction) => {
      if (event.roomId === roomId) setMatchReactions((current) => [...current.slice(-4), event]);
    };
    const onRevoked = (event: { roomId: string }) => {
      if (event.roomId !== roomId) return;
      setRoom(null);
      roomRef.current = null;
      setMessages([]);
      setMoveAnimations([]);
      setInvite(null);
      setError("The match players revoked your spectator access.");
    };
    const onDisabled = (event: { roomId: string }) => {
      if (event.roomId !== roomId) return;
      clearDisabledSpectatorView();
    };
    const onConnect = () => join();
    socket.on("room:snapshot", onSnapshot);
    socket.on("spectator:chat:history", onHistory);
    socket.on("spectator:chat:new", onMessage);
    socket.on("spectator:count", onCount);
    socket.on("room:presence", onPresence);
    socket.on("match:reaction", onMatchReaction);
    socket.on("spectator:revoked", onRevoked);
    socket.on("spectator:disabled", onDisabled);
    socket.on("connect", onConnect);
    if (socket.connected) join();
    return () => {
      socket.off("room:snapshot", onSnapshot);
      socket.off("spectator:chat:history", onHistory);
      socket.off("spectator:chat:new", onMessage);
      socket.off("spectator:count", onCount);
      socket.off("room:presence", onPresence);
      socket.off("match:reaction", onMatchReaction);
      socket.off("spectator:revoked", onRevoked);
      socket.off("spectator:disabled", onDisabled);
      socket.off("connect", onConnect);
      socket.emit("spectator:leave", roomId);
    };
  }, [clearDisabledSpectatorView, join, roomId, socket, updateRoom]);

  useEffect(() => {
    if (!socket?.connected || !room) return;
    const heartbeat = window.setInterval(() => socket.emit("spectator:heartbeat"), 10_000);
    return () => window.clearInterval(heartbeat);
  }, [room, socket, status]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  function acceptInvitation() {
    if (!socket?.connected) return;
    setBusy(true);
    setError("");
    socket.emit("spectator:accept", roomId, (result: Ack) => {
      setBusy(false);
      if (result.ok && result.room) updateRoom(result.room);
      else { setError(result.error ?? "This invitation could not be accepted."); inspectInvite(); }
    });
  }

  function leave() {
    socket?.emit("spectator:leave", roomId);
    setRoom(null);
    setMessages([]);
    router.push("/games/online");
  }

  function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim() || !socket?.connected) return;
    socket.emit("spectator:chat:send", { roomId, body: text.trim() }, (result: Ack) => {
      if (!result.ok) setError(result.error ?? "Spectator message could not be sent.");
      else setText("");
    });
  }

  function react(messageId: string, emoji: string) {
    socket?.emit("spectator:chat:react", { roomId, messageId, emoji }, (result: Ack) => {
      if (!result.ok) setError(result.error ?? "Reaction could not be added.");
      else if (result.messages) setMessages(result.messages);
    });
  }

  if (!room) return <OnlineShell><section className="online-room-loading spectator-gate">
    <span className="spectator-eyebrow"><Eye size={14} /> WATCHING MODE</span>
    <h1>{invite?.status === "PENDING" ? "You’re invited to watch." : status === "connected" ? "Join the live view." : "Connecting to the match…"}</h1>
    {invite?.status === "PENDING" && <p>{invite.invitedBy} invited you to watch {title(invite.gameType as OnlineRoomSnapshot["gameType"])} · room {invite.roomCode}. Accept to see the board and join spectator chat.</p>}
    {invite && invite.status !== "PENDING" && <p>{invite.status === "CANCELLED" ? "This spectator invitation was revoked." : "This spectator invitation is no longer active."}</p>}
    {error && <p className="online-error" role="alert">{error}</p>}
    {invite?.status === "PENDING"
      ? <button className="button button--mint" type="button" disabled={busy || status !== "connected"} onClick={acceptInvitation}>{busy ? "Accepting…" : "Accept Invitation"}</button>
      : <p className="spectator-connect-status" role="status">{error ? "Spectator access could not be verified." : "Checking signed-in access for this live match…"}</p>}
    <Link className="button button--soft" href="/games/online"><ArrowLeft size={15} /> Back to online games</Link>
  </section></OnlineShell>;

  const completed = room.status === "COMPLETED";
  return <OnlineShell>
    <div className="online-room-topbar"><Link href="/games/online" className="online-back-link"><ArrowLeft size={15} /> All tables</Link><div className="online-room-brandline"><span className={completed ? "online-live-dot is-finished" : "online-live-dot"} />{completed ? "MATCH FINISHED" : status === "connected" ? "LIVE SPECTATING" : "RECONNECTING"}<span>·</span>{title(room.gameType)}</div><button className="button button--soft" type="button" onClick={leave}>Leave Spectating</button></div>
    <section className="spectator-heading"><div><span className="spectator-eyebrow"><Eye size={14} /> WATCHING MODE · {room.visibility === "PUBLIC" ? "PUBLIC MATCH" : "INVITATION ONLY"} · ROOM {room.roomCode}</span><h1>Watch the <em>match.</em></h1><p>{room.players.map((player) => player.name).join(" vs ")} · {completed ? "Final result" : count + " watching"}</p></div><div className="spectator-heading-count"><UsersRound size={18} /><strong>{count}</strong><span>watching</span></div></section>
    {completed && <div className="spectator-finished-banner" role="status">This match has ended. The final board is shown below.</div>}
    {error && <p className="online-error" role="alert">{error}</p>}
    <section className="online-room-main spectator-layout">
      <div className="online-board-column"><OnlineGameBoards room={room} userId="" onAction={() => {}} moveAnimations={moveAnimations} onMoveAnimationComplete={completeMoveAnimation} />
        {matchReactions.length > 0 && <div className="online-match-reaction-feed spectator-reaction-feed" aria-live="polite">{matchReactions.slice(-4).map((reaction) => <span key={reaction.createdAt + reaction.profileId}><b>{reaction.emoji}</b>{reaction.playerName}</span>)}</div>}
      </div>
      <aside className="online-chat-panel spectator-chat-panel">
        <header><span className="online-panel-icon"><Eye size={17} /></span><div><h2>Spectator chat</h2><small>Separate from player chat and voice</small></div></header>
        <div className="online-chat-members"><UsersRound size={13} />{count} spectators · {room.players.length} players</div>
        <div className="online-chat-messages" aria-live="polite">{messages.length === 0 ? <p className="online-chat-empty">You’re in the audience. Say hello.</p> : messages.map((message) => <article className="online-chat-message" key={message.id}><div><strong>{message.authorId === userId ? "You" : message.authorName}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p>{message.body}</p><div className="online-chat-reactions">{(message.reactions ?? []).map((reaction) => <button type="button" key={reaction.emoji} className={reaction.mine ? "is-selected" : ""} aria-label={reaction.emoji + ", " + reaction.count + " reactions"} onClick={() => react(message.id, reaction.emoji)}>{reaction.emoji}<small>{reaction.count}</small></button>)}{EMOJIS.filter((emoji) => !(message.reactions ?? []).some((reaction) => reaction.emoji === emoji)).slice(0, 3).map((emoji) => <button type="button" key={emoji} aria-label={"React " + emoji} onClick={() => react(message.id, emoji)}>{emoji}</button>)}</div></article>)}<div ref={endRef} /></div>
        <div className="online-emoji-picker" aria-label="Quick emoji reactions">{EMOJIS.slice(0, 6).map((emoji) => <button type="button" key={emoji} onClick={() => setText((value) => value + emoji)} aria-label={"Insert " + emoji}>{emoji}</button>)}</div>
        {!completed && <form className="online-chat-composer" onSubmit={submitChat}><input value={text} maxLength={500} onChange={(event) => setText(event.target.value)} placeholder="Message the spectators…" aria-label="Spectator chat message" /><button type="submit" aria-label="Send spectator message" disabled={!text.trim() || status !== "connected"}><Send size={16} /></button></form>}
        <p className="online-chat-privacy">Spectators cannot read player chat, join player voice, or change match state.</p>
      </aside>
    </section>
    <footer className="online-room-footer"><span><Eye size={14} /> Read-only view · {count} watching</span><span className="spectator-player-names">{room.players.map((player) => player.name).join(" · ")}</span></footer>
  </OnlineShell>;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, Copy, MessageCircle, Send, UsersRound } from "lucide-react";
import type { OnlineRoomSnapshot } from "@rasmalai/game-engine/online";
import { OnlineShell } from "@/components/games/OnlineShell";
import { OnlineGameBoards } from "@/components/games/OnlineGameBoards";
import { OnlineRematchPanel } from "@/components/games/OnlineRematchPanel";
import { VoiceChat } from "@/components/games/VoiceChat";
import { useRealtimeSocket } from "@/lib/realtime/useRealtimeSocket";
import { getRealtimeConnectionError, getRoomPendingTitle } from "@/lib/realtime/room-connection-copy";
import { createRealtimeActionId } from "@/lib/realtime/action-id";
import { getValidatedOnlineMoveAnimation, getValidatedOnlineRollCue, getValidatedOnlineTicTacToeCue, type OnlineMoveAnimation, type OnlineRollCue } from "@/lib/games/online-move-animation";
import { playArcadeSound, unlockArcadeAudio } from "@/lib/games/arcade-audio";

type Reaction = { emoji: string; count: number; mine: boolean };
type ChatMessage = { id: string; roomId: string; authorId: string; authorName: string; body: string; createdAt: string; reactions?: Reaction[] };
type SpectatorInvite = { inviteId: string; recipientId: string; name: string; username: string; status: string; expiresAt: string };
type MatchReaction = { roomId: string; profileId: string; playerName: string; emoji: string; createdAt: string };
type Result<T = unknown> = { ok: boolean; error?: string; room?: OnlineRoomSnapshot; message?: ChatMessage; messages?: ChatMessage[]; invites?: SpectatorInvite[]; invite?: { inviteId: string }; rematchStatus?: "PENDING" | "DECLINED" | "STARTED" };
const QUICK_EMOJIS = ["👍", "👏", "😂", "😮", "😢", "🎉", "❤️", "🔥"];

function logLudoRoll(correlationId: string, stage: string, details: Record<string, string | number | boolean> = {}) {
  // Temporary diagnostics intentionally omit user/room identifiers and all auth data.
  console.info("[rasmalai:ludo-roll]", { correlationId, stage, ...details });
}

function safeRollFailureCategory(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("limit") || normalized.includes("too many")) return "rate_limited";
  if (normalized.includes("turn") || normalized.includes("player") || normalized.includes("authorization")) return "authorization_or_turn";
  if (normalized.includes("updated") || normalized.includes("version")) return "stale_state";
  return "request_rejected";
}

function gameName(type: OnlineRoomSnapshot["gameType"]) {
  return type === "TIC_TAC_TOE" ? "Tic Tac Toe" : type === "SNAKES_AND_LADDERS" ? "Snakes & Ladders" : "Ludo";
}

export function OnlineGameRoom({ roomId, userId, spectatorModeEnabled = false }: { roomId: string; userId: string; spectatorModeEnabled?: boolean }) {
  const { socket, status } = useRealtimeSocket();
  const [room, setRoom] = useState<OnlineRoomSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [chatText, setChatText] = useState("");
  const [username, setUsername] = useState("");
  const [inviteFeedback, setInviteFeedback] = useState("");
  const [spectatorUsername, setSpectatorUsername] = useState("");
  const [spectatorInviteFeedback, setSpectatorInviteFeedback] = useState("");
  const [spectatorInvites, setSpectatorInvites] = useState<SpectatorInvite[]>([]);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [matchReactions, setMatchReactions] = useState<MatchReaction[]>([]);
  const [moveAnimations, setMoveAnimations] = useState<OnlineMoveAnimation[]>([]);
  const [diceRollAnimationId, setDiceRollAnimationId] = useState<string | null>(null);
  const [diceRollResult, setDiceRollResult] = useState<OnlineRollCue | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [pendingActionType, setPendingActionType] = useState<"roll" | "move" | null>(null);
  const [rollRetryAvailable, setRollRetryAvailable] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const roomRef = useRef<OnlineRoomSnapshot | null>(null);
  const suppressSnapshotAnimation = useRef(false);
  const diceAnimationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diceResultTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionBusyRef = useRef(false);
  const renderedLudoRollIds = useRef(new Set<string>());

  const startDiceAnimation = useCallback((id: string, durationMs: number) => {
    if (diceAnimationTimeout.current) clearTimeout(diceAnimationTimeout.current);
    setDiceRollAnimationId(id);
    diceAnimationTimeout.current = setTimeout(() => {
      diceAnimationTimeout.current = null;
      setDiceRollAnimationId(null);
    }, durationMs);
  }, []);

  const stopDiceAnimation = useCallback(() => {
    if (diceAnimationTimeout.current) clearTimeout(diceAnimationTimeout.current);
    diceAnimationTimeout.current = null;
    setDiceRollAnimationId(null);
  }, []);

  const clearDiceRollResult = useCallback(() => {
    if (diceResultTimeout.current) clearTimeout(diceResultTimeout.current);
    diceResultTimeout.current = null;
    setDiceRollResult(null);
  }, []);

  const showDiceRollResult = useCallback((cue: OnlineRollCue) => {
    if (diceResultTimeout.current) clearTimeout(diceResultTimeout.current);
    setDiceRollResult(cue);
    diceResultTimeout.current = setTimeout(() => {
      diceResultTimeout.current = null;
      setDiceRollResult((current) => current?.id === cue.id ? null : current);
    }, 4_500);
  }, []);

  const updateRoom = useCallback((next: OnlineRoomSnapshot, animateTransition = true) => {
    if (next.roomId !== roomId) return;
    const previous = roomRef.current;
    if (previous?.matchId && previous.matchId !== next.matchId && !(previous.status === "COMPLETED" && next.status === "IN_PROGRESS")) return;
    if (previous?.matchId && previous.matchId === next.matchId && previous.version !== null && next.version !== null && next.version < previous.version) return;

    if (!animateTransition || previous?.matchId !== next.matchId) {
      setMoveAnimations([]);
      clearDiceRollResult();
      if (previous?.matchId !== next.matchId || !animateTransition) stopDiceAnimation();
    } else if (previous?.version !== null && previous?.version !== undefined && next.version !== null && next.version !== previous.version) {
      if (next.version === previous.version + 1) {
        clearDiceRollResult();
        setRollRetryAvailable(false);
        actionBusyRef.current = false;
        setActionBusy(false);
        setPendingActionType(null);
        const rollCue = getValidatedOnlineRollCue(previous, next);
        if (rollCue) {
          if (rollCue.gameType === "LUDO") {
            const actionId = (next.state as { lastRoll?: { actionId?: string | null; value?: number } }).lastRoll?.actionId;
            if (actionId) logLudoRoll(actionId, "client_validated_snapshot", { value: rollCue.value });
          }
          showDiceRollResult(rollCue);
          playArcadeSound(rollCue.id, "dice");
          startDiceAnimation(rollCue.id, 680);
        }
        const ticCue = getValidatedOnlineTicTacToeCue(previous, next);
        if (ticCue) {
          playArcadeSound(`${ticCue.id}:place`, "place");
          if (ticCue.result === "victory") playArcadeSound(`${ticCue.id}:victory`, "victory");
          else if (ticCue.result === "draw") playArcadeSound(`${ticCue.id}:draw`, "draw");
        }
        const move = getValidatedOnlineMoveAnimation(previous, next);
        if (move) {
          stopDiceAnimation();
          setMoveAnimations((current) => current.some((entry) => entry.id === move.id) ? current : [...current, move]);
        }
      } else if (next.version > previous.version + 1) {
        // A missed version means the client cannot safely reconstruct the visual route.
        clearDiceRollResult();
        stopDiceAnimation();
        setMoveAnimations([]);
        actionBusyRef.current = false;
        setActionBusy(false);
        setPendingActionType(null);
      }
    }
    roomRef.current = next;
    setRoom(next);
    setError("");
  }, [clearDiceRollResult, roomId, showDiceRollResult, startDiceAnimation, stopDiceAnimation]);

  useEffect(() => () => {
    if (diceAnimationTimeout.current) clearTimeout(diceAnimationTimeout.current);
    if (diceResultTimeout.current) clearTimeout(diceResultTimeout.current);
  }, []);

  useEffect(() => {
    if (!diceRollResult || diceRollResult.gameType !== "LUDO" || !room || room.gameType !== "LUDO") return;
    const lastRoll = (room.state as { lastRoll?: { actionId?: string | null; value?: number } }).lastRoll;
    const actionId = lastRoll?.actionId;
    if (!actionId || lastRoll.value !== diceRollResult.value || renderedLudoRollIds.current.has(actionId)) return;
    renderedLudoRollIds.current.add(actionId);
    if (renderedLudoRollIds.current.size > 50) renderedLudoRollIds.current.delete(renderedLudoRollIds.current.values().next().value!);
    logLudoRoll(actionId, "client_numbered_face_visible", { value: diceRollResult.value });
  }, [diceRollResult, room]);

  const completeMoveAnimation = useCallback((id: string) => {
    setMoveAnimations((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const resumeRoom = useCallback((offerRollRetryAfterReconcile = false) => {
    if (!socket) return;
    const versionBeforeRefresh = roomRef.current?.version ?? null;
    suppressSnapshotAnimation.current = true;
    socket.emit("room:resume", roomId, (result: Result) => {
      if (result.ok && result.room) {
        updateRoom(result.room, false);
        if (offerRollRetryAfterReconcile && versionBeforeRefresh !== null && result.room.version === versionBeforeRefresh) {
          setRollRetryAvailable(true);
          setError("The table state is unchanged. You can retry the roll.");
        } else {
          setRollRetryAvailable(false);
          setError(offerRollRetryAfterReconcile ? "The table changed while waiting. Its latest state is shown." : "");
        }
      } else {
        setRollRetryAvailable(false);
        setError(result.error ?? "This account cannot access that game room.");
      }
      suppressSnapshotAnimation.current = false;
    });
  }, [roomId, socket, updateRoom]);

  const retryRoomConnection = useCallback(() => {
    setError("");
    if (!socket) {
      window.location.reload();
      return;
    }
    if (socket.connected) resumeRoom();
    else socket.connect();
  }, [resumeRoom, socket]);

  useEffect(() => {
    if (!socket) return;
    const onSnapshot = (next: OnlineRoomSnapshot) => updateRoom(next, !suppressSnapshotAnimation.current);
    const onHistory = (history: ChatMessage[]) => setMessages(Array.isArray(history) ? history : []);
    const onMessage = (message: ChatMessage) => setMessages((current) => [...current.filter((entry) => entry.id !== message.id), message].slice(-50));
    const onConnect = () => resumeRoom();
    const onConnectError = (connectionError: Error) => setError(getRealtimeConnectionError(connectionError.message));
    const onPresence = (presence: { roomId: string; connectedPlayerIds: string[] }) => {
      if (presence.roomId !== roomId) return;
      const current = roomRef.current;
      if (!current) return;
      updateRoom({ ...current, players: current.players.map((player) => ({ ...player, connected: presence.connectedPlayerIds.includes(player.profileId) })) });
    };
    const onSpectatorCount = (event: { roomId: string; count: number }) => {
      if (event.roomId === roomId && Number.isInteger(event.count)) setSpectatorCount(event.count);
    };
    const onMatchReaction = (event: MatchReaction) => {
      if (event.roomId === roomId) setMatchReactions((current) => [...current.slice(-4), event]);
    };
    socket.on("room:snapshot", onSnapshot);
    socket.on("chat:history", onHistory);
    socket.on("chat:new", onMessage);
    socket.on("room:presence", onPresence);
    if (spectatorModeEnabled) socket.on("spectator:count", onSpectatorCount);
    socket.on("match:reaction", onMatchReaction);
    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    if (socket.connected) onConnect();
    return () => {
      socket.off("room:snapshot", onSnapshot);
      socket.off("chat:history", onHistory);
      socket.off("chat:new", onMessage);
      socket.off("room:presence", onPresence);
      if (spectatorModeEnabled) socket.off("spectator:count", onSpectatorCount);
      socket.off("match:reaction", onMatchReaction);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.emit("room:leave", roomId);
    };
  }, [roomId, socket, updateRoom, resumeRoom, spectatorModeEnabled]);

  const refreshSpectatorInvites = useCallback(() => {
    if (!socket?.connected) return;
    socket.emit("spectator:invites", roomId, (result: Result) => {
      if (result.ok && result.invites) setSpectatorInvites(result.invites);
    });
  }, [roomId, socket]);

  useEffect(() => {
    if (!socket || !spectatorModeEnabled) {
      setSpectatorInvites([]);
      setSpectatorCount(0);
      return;
    }
    const onChanged = (event: { roomId: string }) => { if (event.roomId === roomId) refreshSpectatorInvites(); };
    socket.on("spectator:invites:changed", onChanged);
    if (status === "connected" && room?.visibility === "PRIVATE" && room.status === "IN_PROGRESS") refreshSpectatorInvites();
    return () => { socket.off("spectator:invites:changed", onChanged); };
  }, [room?.status, room?.visibility, refreshSpectatorInvites, roomId, socket, status, spectatorModeEnabled]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  useEffect(() => {
    if (!socket?.connected || !room) return;
    const heartbeat = window.setInterval(() => socket.emit("room:heartbeat"), 25_000);
    return () => window.clearInterval(heartbeat);
  }, [room, socket, status]);

  const ownSeat = useMemo(() => room?.players.find((player) => player.profileId === userId)?.seatIndex, [room, userId]);

  const sendRematchRequest = useCallback(() => {
    if (!socket?.connected || rematchBusy) return;
    setRematchBusy(true);
    setError("");
    socket.emit("rematch:request", { roomId }, (result: Result) => {
      setRematchBusy(false);
      if (!result.ok) setError(result.error ?? "The rematch request could not be sent.");
      else if (result.room) updateRoom(result.room);
    });
  }, [rematchBusy, roomId, socket, updateRoom]);

  const respondToRematch = useCallback((requestId: string, accept: boolean) => {
    if (!socket?.connected || rematchBusy) return;
    setRematchBusy(true);
    setError("");
    socket.emit("rematch:respond", { roomId, requestId, accept }, (result: Result) => {
      setRematchBusy(false);
      if (!result.ok) setError(result.error ?? "Your response could not be saved.");
      else if (result.room) updateRoom(result.room);
    });
  }, [rematchBusy, roomId, socket, updateRoom]);

  const sendAction = useCallback((action: { type: "roll" } | { type: "move"; cell?: number; tokenIndex?: number }) => {
    const isLudoRoll = action.type === "roll" && room?.gameType === "LUDO";
    const actionId = createRealtimeActionId();
    if (isLudoRoll) logLudoRoll(actionId, "client_tap_handler_entered");
    if (actionBusyRef.current || actionBusy) {
      if (isLudoRoll) logLudoRoll(actionId, "client_request_blocked", { reason: "action_already_pending" });
      return;
    }
    if (!socket?.connected) {
      setError("The table connection is unavailable. Reconnect before trying that action.");
      if (isLudoRoll) logLudoRoll(actionId, "client_request_blocked", { reason: "socket_disconnected" });
      return;
    }
    if (!room || room.version === null) {
      setError("The latest table state is not ready. Reconnect and try again.");
      if (isLudoRoll) logLudoRoll(actionId, "client_request_blocked", { reason: "room_state_unavailable" });
      return;
    }
    const submittedVersion = room.version;
    actionBusyRef.current = true;
    setActionBusy(true);
    setPendingActionType(action.type);
    setError("");
    if (action.type === "roll") {
      unlockArcadeAudio();
      clearDiceRollResult();
      setRollRetryAvailable(false);
      startDiceAnimation(`request:${actionId}`, 12_500);
    }
    if (isLudoRoll) logLudoRoll(actionId, "client_socket_emit", { version: submittedVersion });
    socket.timeout(12_000).emit("game:action", { roomId, version: submittedVersion, actionId, action }, (timeoutError: Error | null, result: Result) => {
      actionBusyRef.current = false;
      setActionBusy(false);
      setPendingActionType(null);
      if (timeoutError) {
        if (isLudoRoll) logLudoRoll(actionId, "client_ack_timeout");
        stopDiceAnimation();
        // A room snapshot can arrive before a missing acknowledgement. Never
        // resend automatically: first reconcile the authoritative version.
        if ((roomRef.current?.version ?? submittedVersion) > submittedVersion) {
          setError("");
          setRollRetryAvailable(false);
          return;
        }
        setRollRetryAvailable(false);
        setError("No confirmation came back from the table. Checking the latest game state before you retry.");
        resumeRoom(true);
        return;
      }
      if (isLudoRoll) {
        const acknowledgedRoll = result?.room?.gameType === "LUDO"
          ? (result.room.state as { lastRoll?: { actionId?: string | null; value?: number } }).lastRoll
          : undefined;
        logLudoRoll(actionId, "client_ack_received", {
          ok: result?.ok === true,
          ...(acknowledgedRoll?.actionId === actionId && typeof acknowledgedRoll.value === "number" ? { value: acknowledgedRoll.value } : {}),
          ...(!result?.ok ? { category: safeRollFailureCategory(result?.error ?? "") } : {}),
        });
      }
      if (!result?.ok) {
        if (action.type === "roll") {
          stopDiceAnimation();
          setRollRetryAvailable(true);
        }
        setError(result?.error ?? "The table could not complete that action. Please try again.");
      }
      else if (result.room) {
        setRollRetryAvailable(false);
        updateRoom(result.room);
      }
    });
  }, [actionBusy, clearDiceRollResult, resumeRoom, room, roomId, socket, startDiceAnimation, stopDiceAnimation, updateRoom]);

  function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = chatText.trim();
    if (!body || !socket?.connected) return;
    socket.emit("chat:send", { roomId, body }, (result: Result) => {
      if (!result.ok) setError(result.error ?? "Could not send that message.");
      else setChatText("");
    });
  }

  function react(messageId: string, emoji: string) {
    socket?.emit("chat:react", { roomId, messageId, emoji }, (result: Result) => {
      if (!result.ok) setError(result.error ?? "Reaction could not be added.");
      else if (result.messages) setMessages(result.messages);
    });
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!socket?.connected) return;
    setInviteFeedback("");
    socket.emit("room:invite", { roomId, username }, (result: Result) => {
      if (!result.ok) setInviteFeedback(result.error ?? "Invite could not be sent.");
      else { setInviteFeedback("Invite sent. They can join from their notifications."); setUsername(""); }
    });
  }

  function inviteSpectator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!spectatorModeEnabled) return setSpectatorInviteFeedback("Spectator Mode is coming soon.");
    if (!socket?.connected) return;
    setSpectatorInviteFeedback("");
    socket.emit("spectator:invite", { roomId, username: spectatorUsername }, (result: Result) => {
      if (!result.ok) setSpectatorInviteFeedback(result.error ?? "Spectator invite could not be sent.");
      else { setSpectatorInviteFeedback("Invitation sent. They can accept it from notifications."); setSpectatorUsername(""); refreshSpectatorInvites(); }
    });
  }

  function revokeSpectator(inviteId: string) {
    socket?.emit("spectator:revoke", { roomId, inviteId }, (result: Result) => {
      if (!result.ok) setSpectatorInviteFeedback(result.error ?? "Spectator access could not be revoked.");
      else { setSpectatorInviteFeedback("Spectator access revoked."); refreshSpectatorInvites(); }
    });
  }

  function reactToMatch(emoji: string) {
    socket?.emit("match:reaction", { roomId, emoji }, (result: Result) => {
      if (!result.ok) setError(result.error ?? "Match reaction could not be sent.");
    });
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/games/online/${roomId}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setError("Copy failed. You can share the room URL from your browser address bar."); }
  }

  if (!room) return <OnlineShell><section className="online-room-loading"><span className="eyebrow">SECURE GAME ROOM</span><h1>{getRoomPendingTitle(status, error)}</h1><p role={error ? "alert" : "status"}>{error || "The room roster and game state are loaded only after membership is verified. A room link will join an eligible open seat automatically."}</p>{(status === "error" || status === "disconnected" || Boolean(error)) && <button type="button" className="button button--mint" onClick={retryRoomConnection}>{status === "connected" ? "Retry joining room" : "Retry connection"}</button>}<Link className="button button--soft" href="/games/online"><ArrowLeft size={15} /> Back to online games</Link></section></OnlineShell>;

  const canInvite = room.visibility === "PRIVATE" && room.creatorId === userId && room.status === "WAITING";
  const canInviteSpectator = spectatorModeEnabled && room.visibility === "PRIVATE" && room.status === "IN_PROGRESS";

  return <OnlineShell>
    <div className="online-room-topbar"><Link href="/games/online" className="online-back-link"><ArrowLeft size={15} /> All tables</Link><div className="online-room-brandline"><span className="online-live-dot" />{status === "connected" ? "LIVE SYNC" : "RECONNECTING"}<span>·</span>{gameName(room.gameType)}</div><Link href="/games/online/history" className="online-back-link">Match history <ArrowUpRight size={14} /></Link></div>
    <section className="online-room-heading"><div><span className="eyebrow">{room.visibility === "PRIVATE" ? "INVITE ONLY" : "PUBLIC TABLE"} · ROOM {room.roomCode}</span><h1>{gameName(room.gameType)}<em>.</em></h1><p>{room.players.length} of {room.maxPlayers} seats occupied · {room.status === "WAITING" ? "Waiting for players" : room.status === "COMPLETED" ? "Match complete" : "Match in progress"}{spectatorModeEnabled ? ` · ◉ ${spectatorCount} watching` : ""}</p></div><button type="button" className="button button--soft" onClick={copyInvite}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy room link"}</button></section>
    {error && <p className="online-error" role="alert">{error}</p>}
    {actionBusy && <p className="online-turn-tip" role="status">{pendingActionType === "roll" ? "Requesting a server dice roll…" : "Saving your move…"}</p>}
    <OnlineRematchPanel room={room} userId={userId} busy={rematchBusy} connected={status === "connected"} onRequest={sendRematchRequest} onRespond={respondToRematch} />
    <section className="online-room-main">
      <div className="online-board-column"><OnlineGameBoards room={room} userId={userId} onAction={sendAction} moveAnimations={moveAnimations} onMoveAnimationComplete={completeMoveAnimation} diceRollAnimationId={diceRollAnimationId} diceRollResult={diceRollResult} realtimeConnected={status === "connected" && !!socket?.connected} actionBusy={actionBusy} pendingActionType={pendingActionType} rollRetryAvailable={rollRetryAvailable} onReconnect={retryRoomConnection} />
        {room.status === "IN_PROGRESS" && <div className="online-match-reactions"><span>React to the match</span>{QUICK_EMOJIS.slice(0, 6).map((emoji) => <button type="button" key={emoji} onClick={() => reactToMatch(emoji)} aria-label={"Send match reaction " + emoji}>{emoji}</button>)}</div>}
        {matchReactions.length > 0 && <div className="online-match-reaction-feed" aria-live="polite">{matchReactions.slice(-3).map((reaction) => <span key={reaction.createdAt + reaction.profileId}><b>{reaction.emoji}</b>{reaction.profileId === userId ? "You" : reaction.playerName}</span>)}</div>}
        {canInvite && <form className="online-invite-form" onSubmit={invite}><label><span className="eyebrow">INVITE A PLAYER BY USERNAME</span><input value={username} onChange={(event) => setUsername(event.target.value)} pattern="[a-zA-Z0-9_]{3,24}" minLength={3} maxLength={24} required placeholder="player_username" /><button className="button button--mint" type="submit"><UsersRound size={15} /> Send invite</button></label>{inviteFeedback && <small role="status">{inviteFeedback}</small>}</form>}
        {canInviteSpectator && <section className="spectator-invite-panel"><header><div><span className="eyebrow">PRIVATE WATCHING</span><h2>Invite a spectator</h2></div><span className="spectator-count-chip">◉ {spectatorCount} watching</span></header><form className="spectator-invite-form" onSubmit={inviteSpectator}><input value={spectatorUsername} onChange={(event) => setSpectatorUsername(event.target.value)} pattern="[a-zA-Z0-9_]{3,24}" minLength={3} maxLength={24} required placeholder="player_username" aria-label="Spectator username" /><button className="button button--mint" type="submit"><UsersRound size={15} /> Invite</button></form>{spectatorInviteFeedback && <p role="status" className="spectator-invite-feedback">{spectatorInviteFeedback}</p>}{spectatorInvites.length > 0 && <ul className="spectator-invite-list">{spectatorInvites.map((entry) => <li key={entry.inviteId}><span><strong>{entry.name}</strong><small>{entry.status === "ACCEPTED" ? "Spectating or has access" : "Invitation pending"}</small></span><button type="button" className="text-button" onClick={() => revokeSpectator(entry.inviteId)}>Revoke</button></li>)}</ul>}</section>}
        <VoiceChat roomId={roomId} userId={userId} socket={socket} status={status} />
      </div>
      <aside className="online-chat-panel">
        <header><span className="online-panel-icon"><MessageCircle size={17} /></span><div><h2>Game chat</h2><small>Private to match players</small></div></header>
        <div className="online-chat-members"><UsersRound size={13} />{room.players.map((player) => <span key={player.profileId} title={player.connected ? "Connected" : "Reconnecting"}><i className={player.connected ? "is-online" : ""} />{player.name}{player.profileId === userId ? " · You" : ""}</span>)}</div>
        <div className="online-chat-messages" aria-live="polite">{messages.length === 0 ? <p className="online-chat-empty">Say hello to the table.</p> : messages.map((message) => <article className={`online-chat-message ${message.authorId === userId ? "is-own" : ""}`} key={message.id}><div><strong>{message.authorId === userId ? "You" : message.authorName}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p>{message.body}</p><div className="online-chat-reactions">{(message.reactions ?? []).map((reaction) => <button type="button" key={reaction.emoji} className={reaction.mine ? "is-selected" : ""} aria-label={`${reaction.emoji}, ${reaction.count} reactions`} onClick={() => react(message.id, reaction.emoji)}>{reaction.emoji}<small>{reaction.count}</small></button>)}{QUICK_EMOJIS.filter((emoji) => !(message.reactions ?? []).some((reaction) => reaction.emoji === emoji)).slice(0, 3).map((emoji) => <button type="button" key={emoji} aria-label={`React ${emoji}`} onClick={() => react(message.id, emoji)}>{emoji}</button>)}</div></article>)}<div ref={chatEnd} /></div>
        <div className="online-emoji-picker" aria-label="Quick emoji"><span>Quick react</span>{QUICK_EMOJIS.slice(0, 6).map((emoji) => <button type="button" key={emoji} onClick={() => setChatText((value) => `${value}${emoji}`)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>
        <form className="online-chat-composer" onSubmit={submitChat}><input value={chatText} maxLength={500} onChange={(event) => setChatText(event.target.value)} placeholder="Message the players…" aria-label="Game chat message" /><button type="submit" aria-label="Send message" disabled={!chatText.trim() || status !== "connected"}><Send size={16} /></button></form>
        <p className="online-chat-privacy">Chat is visible only to authorized room players.</p>
      </aside>
    </section>
    <footer className="online-room-footer"><span>Seat {ownSeat === undefined ? "—" : ownSeat + 1}{spectatorModeEnabled ? ` · ${spectatorCount} watching` : ""} · Your game state reconnects automatically.</span><Link href="/games/online/history">View match history</Link></footer>
  </OnlineShell>;
}

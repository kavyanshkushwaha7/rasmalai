"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import type { Socket } from "socket.io-client";
import type { RealtimeStatus } from "@/lib/realtime/useRealtimeSocket";
import {
  getMicrophoneAccessErrorMessage,
  getMicrophoneAccessUnavailableMessage,
} from "@/lib/games/microphone-support";

type Ack = { ok: boolean; error?: string; playerIds?: string[] };
type Signal =
  | { type: "description"; description: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit };
type RemoteAudio = { id: string; stream: MediaStream };

/** Mesh voice for small rooms (at most four players). It never records audio. */
export function VoiceChat({ roomId, userId, socket, status }: { roomId: string; userId: string; socket: Socket | null; status: RealtimeStatus }) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remoteAudio, setRemoteAudio] = useState<RemoteAudio[]>([]);
  const localStream = useRef<MediaStream | null>(null);
  const joinedRef = useRef(false);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidates = useRef(new Map<string, RTCIceCandidateInit[]>());
  const remoteStreams = useRef(new Map<string, MediaStream>());

  const sendSignal = useCallback((toUserId: string, signal: Signal) => {
    socket?.emit("voice:signal", { roomId, toUserId, signal });
  }, [roomId, socket]);

  const closePeers = useCallback(() => {
    for (const connection of peerConnections.current.values()) connection.close();
    peerConnections.current.clear();
    pendingCandidates.current.clear();
    remoteStreams.current.clear();
    setRemoteAudio([]);
  }, []);

  const createPeer = useCallback((peerId: string) => {
    const existing = peerConnections.current.get(peerId);
    if (existing) return existing;
    // STUN is free. Without TURN, restrictive NAT/firewall combinations may
    // prevent a direct connection; TURN is intentionally not provisioned.
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peerConnections.current.set(peerId, peer);
    for (const track of localStream.current?.getTracks() ?? []) peer.addTrack(track, localStream.current!);
    peer.onicecandidate = (event) => {
      if (event.candidate) sendSignal(peerId, { type: "candidate", candidate: event.candidate.toJSON() });
    };
    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      remoteStreams.current.set(peerId, stream);
      setRemoteAudio([...remoteStreams.current].map(([id, audioStream]) => ({ id, stream: audioStream })));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        peer.close();
        peerConnections.current.delete(peerId);
      }
    };
    return peer;
  }, [sendSignal]);

  const makeOffer = useCallback(async (peerId: string) => {
    if (userId.localeCompare(peerId) >= 0) return;
    const peer = createPeer(peerId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (offer.sdp) sendSignal(peerId, { type: "description", description: { type: "offer", sdp: offer.sdp } });
  }, [createPeer, sendSignal, userId]);

  const receiveSignal = useCallback(async (fromUserId: string, signal: Signal) => {
    if (!joinedRef.current || fromUserId === userId) return;
    const peer = createPeer(fromUserId);
    if (signal.type === "candidate") {
      if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
      else pendingCandidates.current.set(fromUserId, [...(pendingCandidates.current.get(fromUserId) ?? []), signal.candidate]);
      return;
    }
    await peer.setRemoteDescription(signal.description);
    const candidates = pendingCandidates.current.get(fromUserId) ?? [];
    pendingCandidates.current.delete(fromUserId);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
    if (signal.description.type === "offer") {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (answer.sdp) sendSignal(fromUserId, { type: "description", description: { type: "answer", sdp: answer.sdp } });
    }
  }, [createPeer, sendSignal, userId]);

  const leave = useCallback(() => {
    if (joinedRef.current) socket?.emit("voice:leave", roomId);
    joinedRef.current = false;
    setJoined(false);
    setMuted(true);
    for (const track of localStream.current?.getTracks() ?? []) track.stop();
    localStream.current = null;
    closePeers();
  }, [closePeers, roomId, socket]);

  const join = useCallback(async () => {
    if (busy) return;
    if (!socket?.connected) {
      setError("The secure game connection is unavailable. Wait for it to reconnect, then try again.");
      return;
    }
    setBusy(true);
    setError("");
    socket.emit("voice:authorize", roomId, async (authorization: Ack) => {
      if (!authorization.ok) {
        setBusy(false);
        setError(authorization.error ?? "Only match players can join voice chat.");
        return;
      }
      try {
        const unavailableMessage = getMicrophoneAccessUnavailableMessage(
          window.isSecureContext,
          typeof navigator.mediaDevices?.getUserMedia === "function",
        );
        if (unavailableMessage) throw new Error(unavailableMessage);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        // Joining voice is always muted. The user must press Unmute explicitly.
        for (const track of stream.getAudioTracks()) track.enabled = false;
        localStream.current = stream;
        joinedRef.current = true;
        socket.emit("voice:join", roomId, (result: Ack) => {
          if (!result.ok) {
            leave();
            setError(result.error ?? "Voice chat could not be joined.");
            setBusy(false);
            return;
          }
          setJoined(true);
          for (const peerId of result.playerIds ?? []) void makeOffer(peerId).catch(() => setError("A voice connection could not be established."));
          setBusy(false);
        });
      } catch (caught) {
        socket.emit("voice:leave", roomId);
        setBusy(false);
        setError(getMicrophoneAccessErrorMessage(caught));
      }
    });
  }, [busy, leave, makeOffer, roomId, socket]);

  const toggleMute = useCallback(() => {
    const nextMuted = !muted;
    for (const track of localStream.current?.getAudioTracks() ?? []) track.enabled = !nextMuted;
    setMuted(nextMuted);
  }, [muted]);

  useEffect(() => {
    if (!socket) return;
    const onParticipants = (payload: { roomId: string; playerIds: string[] }) => {
      if (payload.roomId === roomId) for (const peerId of payload.playerIds) void makeOffer(peerId).catch(() => setError("A voice connection could not be established."));
    };
    const onPeerJoined = (payload: { roomId: string; playerId: string }) => {
      if (payload.roomId === roomId && joinedRef.current) void makeOffer(payload.playerId).catch(() => setError("A voice connection could not be established."));
    };
    const onSignal = (payload: { roomId: string; fromUserId: string; signal: Signal }) => {
      if (payload.roomId === roomId) void receiveSignal(payload.fromUserId, payload.signal).catch(() => setError("A voice connection could not be established."));
    };
    const onPeerLeft = (payload: { roomId: string; playerId: string }) => {
      if (payload.roomId !== roomId) return;
      peerConnections.current.get(payload.playerId)?.close();
      peerConnections.current.delete(payload.playerId);
      remoteStreams.current.delete(payload.playerId);
      setRemoteAudio([...remoteStreams.current].map(([id, stream]) => ({ id, stream })));
    };
    const onConnect = () => {
      if (!joinedRef.current) return;
      closePeers();
      socket.emit("voice:join", roomId, (result: Ack) => {
        if (result.ok) for (const peerId of result.playerIds ?? []) void makeOffer(peerId).catch(() => setError("A voice connection could not be restored."));
      });
    };
    const onDisconnect = () => {
      for (const track of localStream.current?.getAudioTracks() ?? []) track.enabled = false;
      setMuted(true);
      closePeers();
    };
    socket.on("voice:participants", onParticipants);
    socket.on("voice:peer-joined", onPeerJoined);
    socket.on("voice:signal", onSignal);
    socket.on("voice:peer-left", onPeerLeft);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("voice:participants", onParticipants);
      socket.off("voice:peer-joined", onPeerJoined);
      socket.off("voice:signal", onSignal);
      socket.off("voice:peer-left", onPeerLeft);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [closePeers, makeOffer, receiveSignal, roomId, socket]);

  useEffect(() => () => {
    if (joinedRef.current) socket?.emit("voice:leave", roomId);
    joinedRef.current = false;
    for (const track of localStream.current?.getTracks() ?? []) track.stop();
    closePeers();
  }, [closePeers, roomId, socket]);

  return <section className="online-voice-panel" aria-label="Optional voice chat">
    <div className="online-voice-copy"><span className="eyebrow">OPTIONAL VOICE · NEVER RECORDED</span><p>Microphone starts muted. Join only when you are ready.</p></div>
    <div className="online-voice-controls">
      {!joined ? <button type="button" className="button button--soft" onClick={() => void join()} disabled={busy || status !== "connected"}><Phone size={15} />{busy ? "Joining…" : "Join voice"}</button> : <>
        <button type="button" className={`button ${muted ? "button--soft" : "button--mint"}`} onClick={toggleMute} aria-pressed={!muted}>{muted ? <MicOff size={15} /> : <Mic size={15} />}{muted ? "Unmute" : "Mute"}</button>
        <button type="button" className="button button--danger" onClick={leave}><PhoneOff size={15} /> Leave voice</button>
      </>}
    </div>
    {remoteAudio.map(({ id, stream }) => <audio key={id} autoPlay playsInline ref={(element) => { if (element && element.srcObject !== stream) element.srcObject = stream; }} />)}
    {error && <p className="online-error" role="status">{error}</p>}
    {joined && <p className="online-voice-status" role="status">{muted ? "Connected · microphone muted" : "Connected · microphone on"}</p>}
  </section>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createRealtimeAuthSessionSync } from "./auth-session-sync";
import { getRealtimeConnectionError, getRealtimeConnectionTimeout, getRealtimeSessionError } from "./room-connection-copy";
import { resolveRealtimeUrl } from "./realtime-url";

export type RealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

function createConnectionDiagnosticId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function connectionErrorCategory(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("unauthorized")) return "auth_rejected";
  if (normalized.includes("origin not allowed")) return "origin_rejected";
  if (normalized.includes("timeout")) return "timeout";
  return "transport_error";
}

export function useRealtimeSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const statusRef = useRef<RealtimeStatus>("connecting");
  const retryRef = useRef<() => void>(() => window.location.reload());

  const retry = useCallback(() => retryRef.current(), []);
  const updateStatus = useCallback((next: RealtimeStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    let active = true;
    let connection: Socket | null = null;
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    let authSubscription: ReturnType<typeof supabase.auth.onAuthStateChange>["data"]["subscription"] | null = null;
    let currentToken: string | null = null;
    let connectionDiagnosticId = "unassigned";

    let realtimeUrl: string;
    try {
      supabase = createSupabaseBrowserClient();
      realtimeUrl = resolveRealtimeUrl(process.env.NEXT_PUBLIC_REALTIME_URL, window.location);
    } catch {
      updateStatus("error");
      setConnectionError("Online play could not start because this site’s sign-in settings are unavailable.");
      return () => { active = false; };
    }

    function ensureConnection() {
      if (connection) return connection;
      connection = io(realtimeUrl, {
        autoConnect: false,
        auth: {},
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 350,
        reconnectionDelayMax: 5000,
      });
      connection.on("connect", () => {
        if (!active) return;
        if (process.env.NODE_ENV === "development") {
          console.info("[rasmalai:socket]", { stage: "connected", correlationId: connectionDiagnosticId, transport: connection?.io.engine?.transport?.name ?? "unknown" });
        }
        setConnectionError(null);
        updateStatus("connected");
      });
      connection.on("disconnect", (reason) => {
        if (!active) return;
        if (process.env.NODE_ENV === "development") console.info("[rasmalai:socket]", { stage: "disconnected", correlationId: connectionDiagnosticId, reason: reason === "io client disconnect" ? "client_disconnect" : "transport_disconnect" });
        updateStatus("disconnected");
      });
      connection.on("connect_error", (error: Error) => {
        if (!active) return;
        if (process.env.NODE_ENV === "development") console.warn("[rasmalai:socket]", { stage: "connect_error", correlationId: connectionDiagnosticId, category: connectionErrorCategory(error.message) });
        setConnectionError(getRealtimeConnectionError(error.message, realtimeUrl));
        updateStatus("error");
      });
      setSocket(connection);
      return connection;
    }

    function applyAccessToken(token: string) {
      if (!active || !token) return;
      const socketConnection = ensureConnection();
      if (currentToken === token) {
        if (!socketConnection.connected && !socketConnection.active) socketConnection.connect();
        return;
      }
      currentToken = token;
      connectionDiagnosticId = createConnectionDiagnosticId();
      socketConnection.auth = { accessToken: token, diagnosticId: connectionDiagnosticId };
      if (process.env.NODE_ENV === "development") {
        const endpoint = new URL(realtimeUrl);
        console.info("[rasmalai:socket]", { stage: "connect_attempt", correlationId: connectionDiagnosticId, endpoint: `${endpoint.origin}/socket.io`, transport: "polling_then_websocket" });
      }
      setConnectionError(null);
      updateStatus("connecting");
      // Re-handshake with the new Supabase session so every room authorization
      // check uses a current, server-verified identity.
      socketConnection.disconnect();
      socketConnection.connect();
    }

    function clearSession() {
      currentToken = null;
      connection?.disconnect();
      if (active) {
        if (process.env.NODE_ENV === "development") console.info("[rasmalai:socket]", { stage: "session_missing" });
        setConnectionError(getRealtimeSessionError());
        updateStatus("error");
      }
    }

    const sessionSync = createRealtimeAuthSessionSync({
      onSession: (session) => applyAccessToken(session.access_token),
      onSignedOut: clearSession,
      // Keep the current Supabase session/token intact; this only marks the
      // realtime connection unavailable until the next successful sync.
      onTemporaryError: () => {
        if (!active) return;
        if (process.env.NODE_ENV === "development") console.warn("[rasmalai:socket]", { stage: "session_sync_error" });
        setConnectionError("Could not read this browser’s sign-in session. Check the connection and retry.");
        updateStatus("error");
      },
    });
    // Subscribe before the initial read so token refreshes and sign-ins cannot
    // be lost to an initialization race.
    authSubscription = supabase.auth.onAuthStateChange(sessionSync.onAuthStateChange).data.subscription;

    const readSession = () => supabase.auth.getSession();
    retryRef.current = () => {
      if (!active) return;
      setConnectionError(null);
      updateStatus("connecting");
      currentToken = null;
      connection?.disconnect();
      void sessionSync.sync(readSession);
    };
    const onForeground = () => {
      if (document.visibilityState === "hidden") return;
      void sessionSync.sync(readSession);
    };
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);

    void sessionSync.sync(readSession);
    return () => {
      active = false;
      sessionSync.dispose();
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
      authSubscription?.unsubscribe();
      connection?.disconnect();
      retryRef.current = () => window.location.reload();
      setSocket(null);
    };
  }, []);

  useEffect(() => {
    if (status !== "connecting") return;
    const timeout = window.setTimeout(() => {
      if (statusRef.current !== "connecting") return;
      setConnectionError((existing) => existing ?? getRealtimeConnectionTimeout(process.env.NEXT_PUBLIC_REALTIME_URL));
      updateStatus("error");
    }, 15_000);
    return () => window.clearTimeout(timeout);
  }, [status, updateStatus]);

  return { socket, status, connectionError, retry };
}

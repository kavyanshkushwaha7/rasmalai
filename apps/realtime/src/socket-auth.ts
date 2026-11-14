import type { Socket } from "socket.io";
import type { AccessTokenVerifier } from "./supabase-auth.js";

export type AuthenticatedSocketData = {
  userId: string;
  supabaseAccessToken: string;
};

function diagnosticIdFromSocket(socket: Socket) {
  const value = socket.handshake.auth?.diagnosticId;
  return typeof value === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : "unavailable";
}

function logAuthStage(correlationId: string, stage: string, reason?: string) {
  if (process.env.NODE_ENV === "production") return;
  console.info("[rasmalai:realtime-auth]", { correlationId, stage, ...(reason ? { reason } : {}) });
}

export function createSocketAuthMiddleware(verify: AccessTokenVerifier) {
  return (socket: Socket, next: (error?: Error) => void) => {
    const correlationId = diagnosticIdFromSocket(socket);
    const token = socket.handshake.auth?.accessToken;
    logAuthStage(correlationId, "request_received", typeof token === "string" && token.length >= 20 ? undefined : "missing_or_malformed_token");
    if (typeof token !== "string" || token.length < 20) {
      logAuthStage(correlationId, "rejected", "missing_or_malformed_token");
      return next(new Error("unauthorized"));
    }

    void verify(token).then((user) => {
      if (!user) {
        logAuthStage(correlationId, "rejected", "token_not_accepted_by_supabase");
        return next(new Error("unauthorized"));
      }
      socket.data.userId = user.id;
      socket.data.supabaseAccessToken = token;
      logAuthStage(correlationId, "verified");
      next();
    }).catch(() => {
      logAuthStage(correlationId, "rejected", "supabase_verification_unavailable");
      next(new Error("unauthorized"));
    });
  };
}

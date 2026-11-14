import "dotenv/config";
import { config as loadEnv, parse as parseEnv } from "dotenv";
import cors, { type CorsOptions } from "cors";
import express from "express";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { Server } from "socket.io";
import { registerGameRoomSocket } from "./game-room-socket.js";
import { createSocketAuthMiddleware } from "./socket-auth.js";
import { verifySupabaseAccessToken } from "./supabase-auth.js";
import { getRealtimeAllowedOrigins, isRealtimeOriginAllowed } from "./origin-policy.js";

// For local development, reuse the trusted web runtime secrets rather than
// copying DATABASE_URL into another ignored file. Deployed realtime instances
// should receive these values through their own server-side secret store.
const webEnvPath = resolve(process.cwd(), "../web/.env.local");
loadEnv({ path: webEnvPath });
// The web runtime's server-only switch is the single local source of truth.
// dotenv normally preserves an earlier value from apps/realtime/.env or the
// shell, which could otherwise leave the two local services in different modes.
if (process.env.NODE_ENV !== "production" && existsSync(webEnvPath)) {
  const sharedEnvironment = parseEnv(readFileSync(webEnvPath, "utf8"));
  for (const name of ["SPECTATOR_MODE_ENABLED", "AUTH_BETA_MODE", "GOOGLE_OAUTH_ENABLED", "BETA_ALLOWED_EMAILS"]) {
    if (sharedEnvironment[name] !== undefined) process.env[name] = sharedEnvironment[name];
  }
}

process.env.SUPABASE_URL ??= process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_PUBLISHABLE_KEY ??= process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const app = express();
const server = createServer(app);
const port = Number(process.env.REALTIME_PORT ?? 4100);
const host = process.env.REALTIME_HOST ?? "0.0.0.0";
const defaultWebOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const allowedOrigins = getRealtimeAllowedOrigins(
  process.env.NODE_ENV,
  process.env.REALTIME_ALLOWED_ORIGIN,
  defaultWebOrigin,
);
const localInterfaceAddresses = process.env.NODE_ENV === "production"
  ? []
  : [...new Set(Object.values(networkInterfaces()).flatMap((entries) => (entries ?? [])
    .filter((entry) => !entry.internal && entry.family === "IPv4")
    .map((entry) => entry.address)))];
const originPolicy = {
  allowedOrigins,
  webOrigins: allowedOrigins,
  localInterfaceAddresses,
  allowLocalLanOrigins: process.env.NODE_ENV !== "production",
};
const checkOrigin: NonNullable<CorsOptions["origin"]> = (origin, callback) => {
  const allowed = isRealtimeOriginAllowed(origin, originPolicy);
  callback(null, allowed ? origin ?? true : false);
};

app.disable("x-powered-by");
app.use(cors({ origin: checkOrigin, credentials: true }));
app.get("/health", (_request, response) => {
  response.status(200).json({ service: "rasmalai-realtime", status: "ok" });
});

const io = new Server(server, {
  cors: { origin: checkOrigin, credentials: true },
  allowRequest: (request, callback) => {
    const origin = request.headers.origin;
    const allowed = isRealtimeOriginAllowed(origin, originPolicy);
    if (process.env.NODE_ENV !== "production") {
      console.info("[rasmalai:realtime-origin]", { stage: allowed ? "accepted" : "rejected", originPresent: Boolean(origin) });
    }
    callback(allowed ? null : "origin not allowed", allowed);
  },
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 25_000,
  pingTimeout: 20_000,
});
io.use(createSocketAuthMiddleware(verifySupabaseAccessToken));

io.on("connection", (socket) => {
  const diagnosticId = socket.handshake.auth?.diagnosticId;
  const correlationId = typeof diagnosticId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(diagnosticId) ? diagnosticId : "unavailable";
  if (process.env.NODE_ENV !== "production") {
    console.info("[rasmalai:realtime-transport]", { correlationId, stage: "connected", transport: socket.conn.transport.name });
    socket.conn.on("upgrade", (transport) => console.info("[rasmalai:realtime-transport]", { correlationId, stage: "upgraded", transport: transport.name }));
  }
  socket.emit("service:ready", { phase: 5 });
  registerGameRoomSocket(io, socket);
});

server.listen(port, host, () => {
  console.info(`Rasmalai realtime service listening on ${host}:${port}`);
});

import { spawn } from "node:child_process";
import { createServer, request as httpRequest, Agent } from "node:http";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDirectory = fileURLToPath(new URL("../apps/web/", import.meta.url));
const realtimeDirectory = fileURLToPath(new URL("../apps/realtime/", import.meta.url));
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const webAgent = new Agent({ keepAlive: true, maxSockets: 64 });
const realtimeAgent = new Agent({ keepAlive: true, maxSockets: 128 });

function socketIoPath(pathname) {
  return pathname === "/socket.io" || pathname.startsWith("/socket.io/");
}

function sendUnavailable(response) {
  if (response.headersSent) return response.destroy();
  response.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end("Rasmalai service temporarily unavailable. Please retry.");
}

function proxyRequest(request, response, upstream, agent) {
  const outgoing = httpRequest({
    hostname: "127.0.0.1",
    port: upstream.port,
    path: request.url,
    method: request.method,
    headers: request.headers,
    agent,
  }, (incoming) => {
    response.writeHead(incoming.statusCode ?? 502, incoming.statusMessage, incoming.headers);
    incoming.pipe(response);
  });

  outgoing.on("error", () => sendUnavailable(response));
  request.on("aborted", () => outgoing.destroy());
  request.pipe(outgoing);
}

function proxyUpgrade(request, clientSocket, head, upstream) {
  const outgoing = httpRequest({
    hostname: "127.0.0.1",
    port: upstream.port,
    path: request.url,
    method: request.method,
    headers: request.headers,
  });

  outgoing.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    const statusLine = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`;
    const headerLines = [];
    for (let index = 0; index < response.rawHeaders.length; index += 2) {
      headerLines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
    }
    clientSocket.write(`${statusLine}${headerLines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) clientSocket.write(upstreamHead);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
    clientSocket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("error", () => clientSocket.destroy());
  });

  outgoing.on("response", (response) => {
    clientSocket.write(`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`);
    for (let index = 0; index < response.rawHeaders.length; index += 2) {
      clientSocket.write(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`);
    }
    clientSocket.write("\r\n");
    response.pipe(clientSocket);
  });
  outgoing.on("error", () => clientSocket.destroy());
  clientSocket.on("close", () => outgoing.destroy());
  outgoing.end();
}

async function checkUpstream(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000), redirect: "manual" });
    return response.ok;
  } catch {
    return false;
  }
}

export function createRenderProxyServer({ webPort, realtimePort, bindPort, bindHost = "0.0.0.0" }) {
  const web = { port: webPort };
  const realtime = { port: realtimePort };
  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url ?? "/", "http://render-internal").pathname;
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }

    if (pathname === "/health") {
      void Promise.all([
        checkUpstream(`http://127.0.0.1:${web.port}/login`),
        checkUpstream(`http://127.0.0.1:${realtime.port}/health`),
      ]).then(([webReady, realtimeReady]) => {
        const healthy = webReady && realtimeReady;
        response.writeHead(healthy ? 200 : 503, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ service: "rasmalai", status: healthy ? "ok" : "starting" }));
      });
      return;
    }

    if (socketIoPath(pathname)) proxyRequest(request, response, realtime, realtimeAgent);
    else proxyRequest(request, response, web, webAgent);
  });

  server.on("upgrade", (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url ?? "/", "http://render-internal").pathname;
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    if (!socketIoPath(pathname)) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    proxyUpgrade(request, socket, head, realtime);
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;
  server.listen(bindPort, bindHost);
  return server;
}

function requiredFrom(environment, name) {
  if (!environment[name]?.trim()) throw new Error(`${name} must be set in the Render service environment.`);
  return environment[name].trim();
}

export function validateRenderEnvironment(environment = process.env, caFileExists = existsSync) {
  const siteUrl = new URL(requiredFrom(environment, "NEXT_PUBLIC_SITE_URL"));
  if (siteUrl.protocol !== "https:" || siteUrl.origin !== siteUrl.href.replace(/\/$/, "")) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an exact HTTPS origin without a path.");
  }
  if (requiredFrom(environment, "REALTIME_ALLOWED_ORIGIN") !== siteUrl.origin) {
    throw new Error("REALTIME_ALLOWED_ORIGIN must exactly match NEXT_PUBLIC_SITE_URL.");
  }
  if (environment.NEXT_PUBLIC_REALTIME_URL?.trim()) {
    throw new Error("NEXT_PUBLIC_REALTIME_URL must be empty so Socket.IO uses the same HTTPS origin.");
  }
  if (environment.DIRECT_URL?.trim()) {
    throw new Error("DIRECT_URL is migration-only and must not be configured in the application runtime.");
  }
  if ((environment.SPECTATOR_MODE_ENABLED ?? "false").toLowerCase() !== "false") {
    throw new Error("SPECTATOR_MODE_ENABLED must remain false for this launch configuration.");
  }
  const authMode = requiredFrom(environment, "AUTH_BETA_MODE");
  if (authMode !== "invite-only-google" && authMode !== "public-google") {
    throw new Error("AUTH_BETA_MODE must be invite-only-google or public-google; email-password and disabled modes are not allowed on this service.");
  }
  const googleOAuthEnabled = requiredFrom(environment, "GOOGLE_OAUTH_ENABLED").toLowerCase();
  if (googleOAuthEnabled !== "true" && googleOAuthEnabled !== "false") {
    throw new Error("GOOGLE_OAUTH_ENABLED must be true or false.");
  }
  if (authMode === "invite-only-google" && googleOAuthEnabled === "true" && !requiredFrom(environment, "BETA_ALLOWED_EMAILS")) {
    throw new Error("BETA_ALLOWED_EMAILS must contain at least one invited email before Google sign-in is enabled.");
  }
  if (authMode === "public-google" && googleOAuthEnabled !== "true") {
    throw new Error("GOOGLE_OAUTH_ENABLED must be true when AUTH_BETA_MODE is public-google.");
  }

  const supabaseUrl = new URL(requiredFrom(environment, "NEXT_PUBLIC_SUPABASE_URL"));
  if (supabaseUrl.protocol !== "https:") throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS in production.");

  const databaseUrl = new URL(requiredFrom(environment, "DATABASE_URL"));
  const caPath = databaseUrl.searchParams.get("sslrootcert");
  const expectedCaPath = "/etc/secrets/rasmalai-supabase-ca.crt";
  let databaseUser = "";
  try { databaseUser = decodeURIComponent(databaseUrl.username); }
  catch { throw new Error("DATABASE_URL must contain a valid restricted runtime username."); }
  if (databaseUrl.searchParams.get("sslmode") !== "verify-full" || caPath !== expectedCaPath || !isAbsolute(caPath) || !caFileExists(caPath)) {
    throw new Error("DATABASE_URL must use sslmode=verify-full and the linked Mumbai CA file at /etc/secrets/rasmalai-supabase-ca.crt.");
  }
  if (!databaseUser.startsWith("prisma.") || !databaseUrl.hostname.endsWith(".pooler.supabase.com") || databaseUrl.port !== "6543") {
    throw new Error("DATABASE_URL must use the restricted prisma Transaction Pooler account, never an admin/direct connection.");
  }
  for (const name of ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) requiredFrom(environment, name);
}

export function startRenderFree() {
  validateRenderEnvironment();
  const publicPort = Number(requiredFrom(process.env, "PORT"));
  const webPort = Number(process.env.RENDER_WEB_INTERNAL_PORT ?? "13000");
  const realtimePort = Number(process.env.RENDER_REALTIME_INTERNAL_PORT ?? "14100");
  if ([publicPort, webPort, realtimePort].some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
    || new Set([publicPort, webPort, realtimePort]).size !== 3) {
    throw new Error("PORT, RENDER_WEB_INTERNAL_PORT, and RENDER_REALTIME_INTERNAL_PORT must be distinct valid ports.");
  }

  const children = [];
  let shuttingDown = false;
  let proxy;
  const childEnv = { ...process.env, NODE_ENV: "production", RASMALAI_AUDIT_BUILD: "1" };

  const web = spawn(process.execPath, [
    nextCli, "start", "--hostname", "127.0.0.1", "--port", String(webPort),
  ], { cwd: webDirectory, env: { ...childEnv, PORT: String(webPort), HOSTNAME: "127.0.0.1" }, stdio: "inherit" });
  children.push(web);

  const realtime = spawn(process.execPath, [
    "--conditions=react-server", "--import", "tsx", "src/index.ts",
  ], {
    cwd: realtimeDirectory,
    env: {
      ...childEnv,
      REALTIME_HOST: "127.0.0.1",
      REALTIME_PORT: String(realtimePort),
      NEXT_PUBLIC_REALTIME_URL: "",
    },
    stdio: "inherit",
  });
  children.push(realtime);

  const shutdown = (signal = "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    proxy?.close();
    for (const child of children) if (child.exitCode === null) child.kill(signal);
    const forceTimer = setTimeout(() => {
      for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    }, 25_000);
    forceTimer.unref();
  };

  for (const child of children) {
    child.once("error", (error) => {
      console.error("[rasmalai:render] child_process_start_failed", { service: child === web ? "web" : "realtime", message: error.message });
      shutdown();
      process.exitCode = 1;
    });
    child.once("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error("[rasmalai:render] child_process_exited", { service: child === web ? "web" : "realtime", code, signal });
        shutdown();
        process.exitCode = code && code !== 0 ? code : 1;
      }
    });
  }

  proxy = createRenderProxyServer({ webPort, realtimePort, bindPort: publicPort });
  proxy.once("error", (error) => {
    console.error("[rasmalai:render] public_listener_failed", { message: error.message });
    shutdown();
    process.exitCode = 1;
  });
  console.info(`[rasmalai:render] single public listener on 0.0.0.0:${publicPort}; web and realtime bound to loopback.`);
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) startRenderFree();

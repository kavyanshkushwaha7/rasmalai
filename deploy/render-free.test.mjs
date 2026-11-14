import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createRenderProxyServer, validateRenderEnvironment } from "./render-free.mjs";

test("Render Blueprint self-references the assigned HTTPS origin for build and runtime", () => {
  const blueprint = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  for (const key of ["NEXT_PUBLIC_SITE_URL", "REALTIME_ALLOWED_ORIGIN"]) {
    const reference = new RegExp(`- key: ${key}\\s+fromService:\\s+name: rasmalai-free-beta\\s+type: web\\s+envVarKey: RENDER_EXTERNAL_URL`);
    assert.match(blueprint, reference);
  }
  assert.equal([...blueprint.matchAll(/^  - type: web$/gm)].length, 1);
  assert.match(blueprint, /    plan: free\n/);
  assert.match(blueprint, /    buildCommand: npm ci --include=dev && RASMALAI_AUDIT_BUILD=1 npm run build\n/);
  assert.match(blueprint, /      - key: NODE_ENV\n        value: production\n/);
  assert.match(blueprint, /      - key: AUTH_BETA_MODE\n        value: public-google/);
  assert.match(blueprint, /      - key: GOOGLE_OAUTH_ENABLED\n        value: "true"/);
  assert.match(blueprint, /      - key: BETA_ALLOWED_EMAILS\n        value: ""/);
  assert.match(blueprint, /      - fromGroup: rasmalai-prod-ca\n/);
  assert.doesNotMatch(blueprint, /^envVarGroups:/m);
  assert.match(blueprint, /      - key: SPECTATOR_MODE_ENABLED\n        value: "false"/);
  const privatePrompts = [...blueprint.matchAll(/^      - key: ([A-Z0-9_]+)\n        sync: false$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(privatePrompts, [
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
  ]);
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("Render proxy serves web routes and aggregates both local health checks", async (t) => {
  const web = createServer((req, res) => {
    res.writeHead(req.url === "/login" ? 200 : 201, { "x-upstream": "web" });
    res.end(`web:${req.url}`);
  });
  const realtime = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: req.url, service: "realtime" }));
  });
  const webPort = await listen(web);
  const realtimePort = await listen(realtime);
  const proxy = createRenderProxyServer({ webPort, realtimePort, bindPort: 0, bindHost: "127.0.0.1" });
  t.after(async () => Promise.all([close(proxy), close(web), close(realtime)]));
  await once(proxy, "listening");
  const proxyPort = proxy.address().port;

  const page = await get(proxyPort, "/games/online?tab=public");
  assert.equal(page.status, 201);
  assert.equal(page.body, "web:/games/online?tab=public");
  assert.equal(page.headers["x-upstream"], "web");

  const health = await get(proxyPort, "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { service: "rasmalai", status: "ok" });
});

test("Render proxy routes Socket.IO HTTP and upgrades WebSocket on the same listener", async (t) => {
  let observedOrigin;
  const web = createServer((_req, res) => res.writeHead(200).end("web"));
  const realtime = createServer((req, res) => {
    observedOrigin = req.headers.origin;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("0{\"sid\":\"test-session\",\"upgrades\":[\"websocket\"]}");
  });
  realtime.on("upgrade", (req, socket) => {
    observedOrigin = req.headers.origin;
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"));
    socket.end();
  });

  const webPort = await listen(web);
  const realtimePort = await listen(realtime);
  const proxy = createRenderProxyServer({ webPort, realtimePort, bindPort: 0, bindHost: "127.0.0.1" });
  t.after(async () => Promise.all([close(proxy), close(web), close(realtime)]));
  await once(proxy, "listening");
  const proxyPort = proxy.address().port;
  const origin = "https://rasmalai-render-test.invalid";

  const polling = await get(proxyPort, "/socket.io/?EIO=4&transport=polling", { origin });
  assert.equal(polling.status, 200);
  assert.equal(polling.body, "0{\"sid\":\"test-session\",\"upgrades\":[\"websocket\"]}");
  assert.equal(observedOrigin, origin);

  const upgraded = await new Promise((resolve, reject) => {
    const outgoing = request({
      host: "127.0.0.1",
      port: proxyPort,
      path: "/socket.io/?EIO=4&transport=websocket",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        origin,
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    });
    outgoing.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    outgoing.on("response", (response) => reject(new Error(`Expected websocket upgrade; got HTTP ${response.statusCode}`)));
    outgoing.on("error", reject);
    outgoing.end();
  });
  assert.equal(upgraded, 101);
  assert.equal(observedOrigin, origin);
});

test("Render proxy does not route arbitrary WebSocket paths to either app", async (t) => {
  const web = createServer((_req, res) => res.writeHead(200).end("web"));
  const realtime = createServer((_req, res) => res.writeHead(200).end("realtime"));
  const webPort = await listen(web);
  const realtimePort = await listen(realtime);
  const proxy = createRenderProxyServer({ webPort, realtimePort, bindPort: 0, bindHost: "127.0.0.1" });
  t.after(async () => Promise.all([close(proxy), close(web), close(realtime)]));
  await once(proxy, "listening");

  const status = await new Promise((resolve, reject) => {
    const outgoing = request({
      host: "127.0.0.1",
      port: proxy.address().port,
      path: "/private/socket",
      headers: { connection: "Upgrade", upgrade: "websocket" },
    });
    outgoing.on("upgrade", () => reject(new Error("Unexpected upgrade")));
    outgoing.on("response", (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
  assert.equal(status, 404);
});

function validRenderEnvironment(overrides = {}) {
  return {
    NEXT_PUBLIC_SITE_URL: "https://rasmalai-render-test.invalid",
    REALTIME_ALLOWED_ORIGIN: "https://rasmalai-render-test.invalid",
    NEXT_PUBLIC_REALTIME_URL: "",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
    SUPABASE_SECRET_KEY: "server-only-test-value",
    SPECTATOR_MODE_ENABLED: "false",
    AUTH_BETA_MODE: "invite-only-google",
    GOOGLE_OAUTH_ENABLED: "false",
    BETA_ALLOWED_EMAILS: "",
    DATABASE_URL: "postgresql://prisma.projectref:test@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=verify-full&sslrootcert=%2Fetc%2Fsecrets%2Frasmalai-supabase-ca.crt",
    ...overrides,
  };
}

test("Render runtime accepts only same-origin HTTPS, disabled spectators, verified CA, and restricted Prisma pooler credentials", () => {
  assert.doesNotThrow(() => validateRenderEnvironment(validRenderEnvironment(), () => true));
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ REALTIME_ALLOWED_ORIGIN: "https://other.invalid" }), () => true), /must exactly match/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ NEXT_PUBLIC_SITE_URL: "http://rasmalai-render-test.invalid" }), () => true), /exact HTTPS origin/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ SPECTATOR_MODE_ENABLED: "true" }), () => true), /must remain false/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ AUTH_BETA_MODE: "email-password" }), () => true), /email-password/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ AUTH_BETA_MODE: "public-google", GOOGLE_OAUTH_ENABLED: "false" }), () => true), /must be true/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ GOOGLE_OAUTH_ENABLED: "true" }), () => true), /BETA_ALLOWED_EMAILS/);
  assert.doesNotThrow(() => validateRenderEnvironment(validRenderEnvironment({ GOOGLE_OAUTH_ENABLED: "true", BETA_ALLOWED_EMAILS: "player@example.com" }), () => true));
  assert.doesNotThrow(() => validateRenderEnvironment(validRenderEnvironment({ AUTH_BETA_MODE: "public-google", GOOGLE_OAUTH_ENABLED: "true", BETA_ALLOWED_EMAILS: "" }), () => true));
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ NEXT_PUBLIC_REALTIME_URL: "https://other.invalid" }), () => true), /must be empty/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ DIRECT_URL: "postgresql://admin:secret@db.invalid/postgres" }), () => true), /migration-only/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ DATABASE_URL: "postgresql://prisma.projectref:test@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=verify-full&sslrootcert=%2Fetc%2Fsecrets%2Fwrong-ca.crt" }), () => true), /linked Mumbai CA file/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ DATABASE_URL: "postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=%2Fetc%2Fsecrets%2Frasmalai-supabase-ca.crt" }), () => true), /restricted prisma Transaction Pooler/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment({ DATABASE_URL: "postgresql://prisma.projectref:secret@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require&sslrootcert=%2Fetc%2Fsecrets%2Frasmalai-supabase-ca.crt" }), () => true), /sslmode=verify-full/);
  assert.throws(() => validateRenderEnvironment(validRenderEnvironment(), () => false), /linked Mumbai CA file/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";

const origin = "https://rasmalai.example.test";
const html = '<!doctype html><html><script src="/_next/static/chunks/game.js"></script><link rel="stylesheet" href="/_next/static/css/app.css"></html>';

async function createWorkerHarness() {
  const workerSource = await readFile(fileURLToPath(new URL("../public/service-worker.js", import.meta.url)), "utf8");
  const handlers = new Map<string, (event: any) => void>();
  const storage = new Map<string, Map<string, Response>>();
  let online = true;
  let fetchCount = 0;
  const keyOf = (key: string | Request) => typeof key === "string" ? key : key.url;
  const caches = {
    async open(name: string) {
      let entries = storage.get(name);
      if (!entries) storage.set(name, entries = new Map());
      return {
        async match(key: string | Request) { return entries?.get(keyOf(key))?.clone(); },
        async put(key: string | Request, response: Response) { entries?.set(keyOf(key), response.clone()); },
      };
    },
    async keys() { return [...storage.keys()]; },
    async delete(name: string) { return storage.delete(name); },
  };
  const fetch = async (input: string | URL | Request) => {
    fetchCount += 1;
    if (!online) throw new TypeError("offline");
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.pathname.startsWith("/_next/static/")) return new Response(`asset:${url.pathname}`, { headers: { "Content-Type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" } });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  };
  const self = {
    location: { origin },
    clients: { async claim() {} },
    addEventListener(name: string, handler: (event: any) => void) { handlers.set(name, handler); },
    async skipWaiting() {},
  };
  vm.runInNewContext(workerSource, { self, caches, fetch, URL, Request, Response, Promise, Set });
  return {
    handlers,
    storage,
    setOnline(value: boolean) { online = value; },
    get fetchCount() { return fetchCount; },
  };
}

async function dispatchWithWaitUntil(handler: (event: any) => void, fields: Record<string, unknown> = {}) {
  const pending: Promise<unknown>[] = [];
  const event: any = {
    ...fields,
    waitUntil(promise: Promise<unknown>) { pending.push(promise); },
  };
  handler(event);
  await Promise.all(pending);
  return event;
}

test("offline worker precaches only local game pages and their static Next assets", async () => {
  const harness = await createWorkerHarness();
  await dispatchWithWaitUntil(harness.handlers.get("install")!);

  const pages = harness.storage.get("rasmalai-offline-pages-v1");
  const assets = harness.storage.get("rasmalai-offline-assets-v1");
  assert.deepEqual([...pages!.keys()].sort(), [
    `${origin}/games`,
    `${origin}/games/ludo`,
    `${origin}/games/snakes-and-ladders`,
    `${origin}/games/tic-tac-toe`,
  ]);
  assert.deepEqual([...assets!.keys()].sort(), [
    `${origin}/_next/static/chunks/game.js`,
    `${origin}/_next/static/css/app.css`,
  ]);
});

test("cached games open when offline while private and online routes remain network-only", async () => {
  const harness = await createWorkerHarness();
  await dispatchWithWaitUntil(harness.handlers.get("install")!);
  harness.setOnline(false);
  const fetchHandler = harness.handlers.get("fetch")!;

  const offlineEvent = await dispatchWithWaitUntil(fetchHandler, {
    request: { url: `${origin}/games/ludo`, method: "GET", mode: "navigate" },
    respondWith(promise: Promise<Response>) { this.response = promise; },
  });
  const offlineResponse = await offlineEvent.response;
  assert.equal(offlineResponse.status, 200);
  assert.match(await offlineResponse.text(), /<html>/);

  const cachedAssetEvent = await dispatchWithWaitUntil(fetchHandler, {
    request: { url: `${origin}/_next/static/chunks/game.js`, method: "GET", mode: "cors" },
    respondWith(promise: Promise<Response>) { this.response = promise; },
  });
  const cachedAssetResponse = await cachedAssetEvent.response;
  assert.equal(await cachedAssetResponse.text(), "asset:/_next/static/chunks/game.js");

  const priorFetches = harness.fetchCount;
  const privateEvent = await dispatchWithWaitUntil(fetchHandler, {
    request: { url: `${origin}/messages`, method: "GET", mode: "navigate" },
    respondWith() { throw new Error("private route must not be intercepted"); },
  });
  assert.equal(privateEvent.response, undefined);
  assert.equal(harness.fetchCount, priorFetches);

  const onlineRoomEvent = await dispatchWithWaitUntil(fetchHandler, {
    request: { url: `${origin}/games/online/room-uuid`, method: "GET", mode: "navigate" },
    respondWith() { throw new Error("online route must not be intercepted"); },
  });
  assert.equal(onlineRoomEvent.response, undefined);

  const queryRouteEvent = await dispatchWithWaitUntil(fetchHandler, {
    request: { url: `${origin}/games/ludo?from=share`, method: "GET", mode: "navigate" },
    respondWith() { throw new Error("query navigations must remain network-only"); },
  });
  assert.equal(queryRouteEvent.response, undefined);
});

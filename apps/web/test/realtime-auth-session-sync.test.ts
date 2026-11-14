import assert from "node:assert/strict";
import test from "node:test";
import { createRealtimeAuthSessionSync, type RealtimeAuthSession } from "../lib/realtime/auth-session-sync";

const session = (access_token: string): RealtimeAuthSession => ({ access_token });
const read = (value: RealtimeAuthSession | null, error: unknown | null = null) => async () => ({ data: { session: value }, error });

test("initial read, token refresh, and reconnect sync use the newest Supabase session", async () => {
  const tokens: string[] = [];
  let signedOut = 0;
  const sync = createRealtimeAuthSessionSync({ onSession: (value) => tokens.push(value.access_token), onSignedOut: () => signedOut++, onTemporaryError() {} });
  await sync.sync(read(session("token-1")));
  sync.onAuthStateChange("TOKEN_REFRESHED", session("token-2"));
  await sync.sync(read(session("token-2"))); // foreground/reconnect catches up if the socket missed the event
  assert.deepEqual(tokens, ["token-1", "token-2", "token-2"]);
  assert.equal(signedOut, 0);
});

test("temporary network failures do not clear the current socket session", async () => {
  const tokens: string[] = [];
  let signedOut = 0;
  let failures = 0;
  const sync = createRealtimeAuthSessionSync({ onSession: (value) => tokens.push(value.access_token), onSignedOut: () => signedOut++, onTemporaryError: () => failures++ });
  await sync.sync(read(session("still-valid")));
  await sync.sync(read(null, { name: "AuthRetryableFetchError", status: 503 }));
  assert.deepEqual(tokens, ["still-valid"]);
  assert.equal(signedOut, 0);
  assert.equal(failures, 1);
});

test("a stale background/foreground read cannot override a newer token refresh", async () => {
  const tokens: string[] = [];
  let signedOut = 0;
  const sync = createRealtimeAuthSessionSync({ onSession: (value) => tokens.push(value.access_token), onSignedOut: () => signedOut++, onTemporaryError() {} });
  let finishRead!: (result: Awaited<ReturnType<ReturnType<typeof read>>>) => void;
  const pendingRead = new Promise<Awaited<ReturnType<ReturnType<typeof read>>>>((resolve) => { finishRead = resolve; });
  const syncing = sync.sync(() => pendingRead);
  sync.onAuthStateChange("TOKEN_REFRESHED", session("fresh-token"));
  finishRead({ data: { session: null }, error: null });
  await syncing;
  assert.deepEqual(tokens, ["fresh-token"]);
  assert.equal(signedOut, 0);
});

test("only an explicit Supabase SIGNED_OUT event clears the local socket session", async () => {
  let signedOut = 0;
  const sync = createRealtimeAuthSessionSync({ onSession() {}, onSignedOut: () => signedOut++, onTemporaryError() {} });
  await sync.sync(read(null));
  assert.equal(signedOut, 1);
  sync.onAuthStateChange("SIGNED_OUT", null);
  assert.equal(signedOut, 2);
});

test("disposed socket listeners ignore pending reconnect reads", async () => {
  let failures = 0;
  let finishRead!: (result: Awaited<ReturnType<ReturnType<typeof read>>>) => void;
  const pendingRead = new Promise<Awaited<ReturnType<ReturnType<typeof read>>>>((resolve) => { finishRead = resolve; });
  const sync = createRealtimeAuthSessionSync({ onSession() {}, onSignedOut() {}, onTemporaryError: () => failures++ });
  const syncing = sync.sync(() => pendingRead);
  sync.dispose();
  finishRead({ data: { session: null }, error: { name: "AuthRetryableFetchError", status: 503 } });
  await syncing;
  assert.equal(failures, 0);
});

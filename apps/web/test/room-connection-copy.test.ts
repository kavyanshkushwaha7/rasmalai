import assert from "node:assert/strict";
import test from "node:test";
import { getRealtimeConnectionError, getRealtimeConnectionTimeout, getRealtimeSessionError, getRoomPendingTitle } from "../lib/realtime/room-connection-copy";

test("room loading leaves the indefinite connecting state when realtime is unavailable", () => {
  assert.equal(getRoomPendingTitle("error", ""), "We couldn’t reach the game service.");
  assert.equal(getRoomPendingTitle("disconnected", ""), "Your table connection was interrupted.");
  assert.match(getRealtimeConnectionError("xhr poll error"), /Mac’s Wi-Fi address.*port 4100/);
});

test("room loading reports join failures separately from connection failures", () => {
  assert.equal(getRoomPendingTitle("connected", "This room is full."), "We couldn’t join this table.");
  assert.equal(getRoomPendingTitle("connected", ""), "Joining your table…");
  assert.match(getRealtimeConnectionError("unauthorized"), /Sign in on this device/);
});

test("secure realtime failures explain private HTTPS sign-in and never suggest the LAN-only port", () => {
  const endpoint = "https://rasmalai-test.example.ts.net:8443";
  assert.match(getRealtimeConnectionError("unauthorized", endpoint), /Sign in on this device at the current site/);
  assert.match(getRealtimeConnectionError("websocket error", endpoint), /private secure game connection/);
  assert.doesNotMatch(getRealtimeConnectionError("websocket error", endpoint), /4100/);
  assert.match(getRealtimeConnectionTimeout(endpoint), /private HTTPS test service/);
  assert.match(getRealtimeSessionError(), /no active RASMALAI sign-in/);
});

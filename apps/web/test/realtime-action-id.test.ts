import assert from "node:assert/strict";
import test from "node:test";
import { createRealtimeActionId } from "../lib/realtime/action-id.js";

test("realtime action IDs use native randomUUID where the browser supports it", () => {
  const cryptoApi = {
    randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" as ReturnType<Crypto["randomUUID"]>,
    getRandomValues: <T extends ArrayBufferView>(array: T) => array,
  };
  assert.equal(createRealtimeActionId(cryptoApi), "123e4567-e89b-42d3-a456-426614174000");
});

test("LAN HTTP fallback creates a server-accepted UUID without randomUUID", () => {
  let fills = 0;
  const cryptoApi = {
    getRandomValues: <T extends ArrayBufferView>(array: T) => {
      fills += 1;
      const bytes = array as unknown as Uint8Array;
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
      return array;
    },
  };
  const id = createRealtimeActionId(cryptoApi);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fills, 1, "the insecure-origin fallback uses Web Crypto entropy once");
});

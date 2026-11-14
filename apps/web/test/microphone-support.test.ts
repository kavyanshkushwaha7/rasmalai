import assert from "node:assert/strict";
import test from "node:test";
import {
  getMicrophoneAccessErrorMessage,
  getMicrophoneAccessUnavailableMessage,
} from "../lib/games/microphone-support";

test("explains that microphone access on a non-secure LAN page requires HTTPS", () => {
  assert.match(getMicrophoneAccessUnavailableMessage(false, false) ?? "", /requires HTTPS/i);
});

test("does not mislabel a secure browser without media support as an insecure page", () => {
  assert.match(getMicrophoneAccessUnavailableMessage(true, false) ?? "", /unavailable in this browser/i);
});

test("secure context with getUserMedia is allowed to continue to the explicit permission prompt", () => {
  assert.equal(getMicrophoneAccessUnavailableMessage(true, true), null);
});

test("maps a blocked microphone permission to actionable, non-technical feedback", () => {
  assert.match(getMicrophoneAccessErrorMessage({ name: "NotAllowedError" }), /Allow microphone access/i);
});

test("maps a missing microphone to a safe device message", () => {
  assert.match(getMicrophoneAccessErrorMessage({ name: "NotFoundError" }), /No microphone was found/i);
});

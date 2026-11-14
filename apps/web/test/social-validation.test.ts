import assert from "node:assert/strict";
import { test } from "node:test";
import { getConversationError, getSocialError, getSocialNotice, hasActiveDirectMessageRelationship, parsePlayerSearch, parseSocialMessage, parseUuid } from "../lib/social-validation.js";

test("player search normalizes case and accepts only bounded username characters", () => {
  assert.equal(parsePlayerSearch("  Game_Friend  "), "game_friend");
  assert.equal(parsePlayerSearch("ab"), "ab");
  assert.equal(parsePlayerSearch("a"), null);
  assert.equal(parsePlayerSearch("not a username"), null);
  assert.equal(parsePlayerSearch("a".repeat(25)), null);
  assert.equal(parsePlayerSearch(new File(["test"], "query.txt")), null);
});

test("social messages are trimmed and obey server-side length limits", () => {
  assert.equal(parseSocialMessage("  hello friends  ", 1000), "hello friends");
  assert.equal(parseSocialMessage("  ", 1000), null);
  assert.equal(parseSocialMessage("x".repeat(1001), 1000), null);
  assert.equal(parseSocialMessage(null, 4000), null);
});

test("request identifiers require a UUID before reaching server actions", () => {
  assert.equal(parseUuid("a21aa111-5d0b-4e12-9a80-82db9ec88f03"), "a21aa111-5d0b-4e12-9a80-82db9ec88f03");
  assert.equal(parseUuid("not-a-uuid"), null);
  assert.equal(parseUuid(["a21aa111-5d0b-4e12-9a80-82db9ec88f03"] as unknown as string), null);
});

test("direct messages require either a current friendship or an accepted message request", () => {
  assert.equal(hasActiveDirectMessageRelationship(false, false), false);
  assert.equal(hasActiveDirectMessageRelationship(true, false), true);
  assert.equal(hasActiveDirectMessageRelationship(false, true), true);
});

test("feedback only displays known safe messages", () => {
  assert.equal(getSocialNotice("friend-accepted"), "Friend request accepted.");
  assert.equal(getSocialNotice(["read", "untrusted"]), "Marked as read.");
  assert.equal(getSocialNotice("raw-database-error"), null);
  assert.equal(getSocialError("request"), "We could not update that request. It may have changed or is no longer available.");
  assert.equal(getSocialError("rate-limit"), "You’re doing that too quickly. Please wait a moment and try again.");
  assert.equal(getSocialError("temporarily-unavailable"), "This action is temporarily unavailable. Please try again shortly.");
  assert.equal(getSocialError("access-denied"), "You no longer have access to this conversation or action.");
  assert.equal(getSocialError("message-access-denied"), "You no longer have permission to send messages in this conversation.");
  assert.equal(getSocialError("connection-string"), null);
});

test("a known missing relationship replaces the obsolete generic send error while unrelated errors stay visible", () => {
  assert.equal(getConversationError("message", false), null);
  assert.equal(getConversationError("message-access-denied", false), null);
  assert.equal(getConversationError("rate-limit", false), "You’re doing that too quickly. Please wait a moment and try again.");
  assert.equal(getConversationError("temporarily-unavailable", null), "This action is temporarily unavailable. Please try again shortly.");
});

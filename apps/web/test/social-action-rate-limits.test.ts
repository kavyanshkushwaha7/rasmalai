import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getSocialError } from "../lib/social-validation.js";

const actionSource = readFileSync("app/actions/social.ts", "utf8");
const conversationPage = readFileSync("app/messages/[conversationId]/page.tsx", "utf8");
const migration = readFileSync("../../packages/database/prisma/migrations/0011_social_action_rate_limits/migration.sql", "utf8");
const existingTriggerMigration = readFileSync("../../packages/database/prisma/migrations/0009_shared_atomic_rate_limits/migration.sql", "utf8");

function actionBody(name: string) {
  const start = actionSource.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = actionSource.indexOf("export async function ", start + 1);
  return actionSource.slice(start, next === -1 ? undefined : next);
}

test("every social mutation verifies the user, charges a shared attempt bucket, then validates or mutates", () => {
  const actions = [
    ["sendFriendRequest", "friend_request"],
    ["respondFriendRequest", "social_friend_mutation"],
    ["cancelFriendRequest", "social_friend_mutation"],
    ["unfriend", "social_friend_mutation"],
    ["openDirectConversation", "social_conversation_open"],
    ["sendMessageRequest", "message_request"],
    ["respondMessageRequest", "social_message_request_mutation"],
    ["sendDirectMessage", "direct_message_send"],
    ["markConversationRead", "social_conversation_read"],
    ["markNotificationsRead", "social_notification_read"],
  ] as const;

  for (const [name, bucket] of actions) {
    const body = actionBody(name);
    const auth = body.indexOf("requireSocialContext()");
    const rate = body.indexOf(`enforceSocialActionLimit(auth.accessToken, "${bucket}"`);
    const validation = Math.min(...[
      body.indexOf("parseUuid("), body.indexOf("parseSocialMessage("), body.indexOf("const decision ="),
    ].filter((index) => index >= 0));
    const mutation = body.indexOf("$queryRaw");
    assert.ok(auth >= 0 && rate > auth, `${name} must authenticate before charging its quota`);
    assert.ok(validation < 0 || rate < validation, `${name} must charge before business validation`);
    assert.ok(mutation < 0 || rate < mutation, `${name} must charge before the business RPC`);
  }

  const backgroundRead = actionBody("markConversationReadById");
  assert.ok(backgroundRead.indexOf("requireSocialContext()") < backgroundRead.indexOf("checkSocialActionRateLimit("));
  assert.ok(backgroundRead.indexOf("checkSocialActionRateLimit(") < backgroundRead.indexOf("parseUuid("));
});

test("the social attempt gate is server-only, verified, allowlisted, and reuses existing send quotas", () => {
  assert.match(actionSource, /checkSocialActionRateLimit/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.rasmalai_consume_social_action_limit\(p_action TEXT\)[\s\S]*auth\.uid\(\)[\s\S]*social_notification_read/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.rasmalai_consume_social_action_limit\(TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.rasmalai_consume_social_action_limit\(TEXT\) TO prisma/);
  assert.match(migration, /'friend_request'[\s\S]*'message_request'[\s\S]*'direct_message_send'[\s\S]*'social_notification_read'/);
  assert.match(existingTriggerMigration, /friend_requests_shared_rate_limit[\s\S]*message_requests_shared_rate_limit[\s\S]*messages_shared_rate_limit/);
  assert.match(migration, /DROP TRIGGER IF EXISTS friend_requests_shared_rate_limit[\s\S]*DROP TRIGGER IF EXISTS message_requests_shared_rate_limit[\s\S]*DROP TRIGGER IF EXISTS messages_shared_rate_limit/);
});

test("social rate-limit and infrastructure errors show safe, non-sensitive feedback", () => {
  assert.equal(getSocialError("rate-limit"), "You’re doing that too quickly. Please wait a moment and try again.");
  assert.equal(getSocialError("temporarily-unavailable"), "This action is temporarily unavailable. Please try again shortly.");
  assert.equal(getSocialError("database-url"), null);
});

test("stale direct conversations render read-only after a relationship ends while the RPC remains authoritative", () => {
  assert.match(conversationPage, /withAuthenticatedUser\(auth\.accessToken/);
  assert.match(conversationPage, /db\.friendship\.findFirst/);
  assert.match(conversationPage, /status: "ACCEPTED"/);
  assert.match(conversationPage, /relationshipAllowsMessaging === false/);
  assert.match(conversationPage, /This conversation is read-only/);
  assert.match(conversationPage, /getConversationError\(query\.error, relationshipAllowsMessaging\)/);
  assert.match(actionSource, /rasmalai_send_message/);
  assert.match(actionSource, /redirectForMutationFailure\(ok, `\/messages\/\$\{conversationId\}`, "message", "message-access-denied"\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const migration = await readFile(fileURLToPath(new URL("../prisma/migrations/0005_phase2_social_messaging/migration.sql", import.meta.url)), "utf8");
const rateLimitHardening = await readFile(fileURLToPath(new URL("../prisma/migrations/0011_social_action_rate_limits/migration.sql", import.meta.url)), "utf8");
const rollback = await readFile(fileURLToPath(new URL("../prisma/migrations/0011_social_action_rate_limits/rollback.sql", import.meta.url)), "utf8");

test("Phase 2 enables RLS and participant-only reads for social and private tables", () => {
  for (const table of ["friend_requests", "friendships", "message_requests", "conversations", "conversation_members", "messages", "notifications"]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(migration, /friend_requests_participant_read[\s\S]*sender_id = auth\.uid\(\) OR recipient_id = auth\.uid\(\)/);
  assert.match(migration, /friendships_participant_read[\s\S]*profile_a_id = auth\.uid\(\) OR profile_b_id = auth\.uid\(\)/);
  assert.match(migration, /messages_member_read[\s\S]*rasmalai_is_conversation_member\(conversation_id\)/);
  assert.match(migration, /notifications_recipient_read[\s\S]*recipient_id = auth\.uid\(\)/);
});

test("direct table writes stay revoked and message read columns are not exposed", () => {
  assert.match(migration, /REVOKE ALL ON TABLE public\.friend_requests[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]{0,120}TO\s+authenticated/i);
  assert.match(migration, /GRANT SELECT \(id, conversation_id, profile_id, joined_at\)[\s\S]*conversation_members TO authenticated/);
  assert.doesNotMatch(migration, /GRANT SELECT \([^)]*last_read_at[^)]*\)/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.rasmalai_send_message\(UUID, TEXT\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.rasmalai_send_message\(UUID, TEXT\) TO authenticated/);
  assert.match(rateLimitHardening, /REVOKE EXECUTE ON FUNCTION public\.rasmalai_send_message\(UUID, TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(rateLimitHardening, /GRANT EXECUTE ON FUNCTION public\.rasmalai_send_message\(UUID, TEXT\) TO prisma/);
});

test("mutation functions derive their actor from auth.uid and guard conversation membership", () => {
  for (const name of [
    "rasmalai_send_friend_request", "rasmalai_respond_friend_request", "rasmalai_cancel_friend_request",
    "rasmalai_unfriend", "rasmalai_open_direct_conversation", "rasmalai_send_message_request",
    "rasmalai_respond_message_request", "rasmalai_send_message", "rasmalai_mark_conversation_read",
    "rasmalai_mark_notifications_read", "rasmalai_social_unread_counts",
  ]) {
    const offset = migration.indexOf(`FUNCTION public.${name}`);
    assert.notEqual(offset, -1, `${name} exists`);
    const body = migration.slice(offset, migration.indexOf("$function$;", offset));
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /auth\.uid\(\)/);
  }
  assert.match(migration, /p_conversation_id[\s\S]{0,500}profile_id = v_user_id/);
  assert.match(migration, /message\.author_id <> v_user_id/);
});

test("direct chats are unique per player pair and notification counts are per recipient", () => {
  assert.match(migration, /CREATE UNIQUE INDEX conversations_direct_key_key/);
  assert.match(migration, /LEAST\(v_user_id::TEXT, p_friend_id::TEXT\)[\s\S]*GREATEST\(v_user_id::TEXT, p_friend_id::TEXT\)/);
  assert.match(migration, /notification\.recipient_id = v_user_id AND notification\.read_at IS NULL/);
});

test("social write and rate-limit RPCs are callable only through the verified server role", () => {
  const mutationSignatures = [
    "rasmalai_send_friend_request\\(UUID\\)",
    "rasmalai_respond_friend_request\\(UUID, BOOLEAN\\)",
    "rasmalai_cancel_friend_request\\(UUID\\)",
    "rasmalai_unfriend\\(UUID\\)",
    "rasmalai_open_direct_conversation\\(UUID\\)",
    "rasmalai_send_message_request\\(UUID, TEXT\\)",
    "rasmalai_respond_message_request\\(UUID, BOOLEAN\\)",
    "rasmalai_send_message\\(UUID, TEXT\\)",
    "rasmalai_mark_conversation_read\\(UUID\\)",
    "rasmalai_mark_notifications_read\\(UUID\\)",
  ];
  for (const signature of mutationSignatures) {
    assert.match(rateLimitHardening, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM PUBLIC, anon, authenticated`, "i"));
    assert.match(rateLimitHardening, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO prisma`, "i"));
  }
  assert.match(rateLimitHardening, /REVOKE ALL ON FUNCTION public\.rasmalai_consume_social_action_limit\(TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(rateLimitHardening, /GRANT EXECUTE ON FUNCTION public\.rasmalai_consume_social_action_limit\(TEXT\) TO prisma/);
  assert.match(rateLimitHardening, /DROP TRIGGER IF EXISTS friend_requests_shared_rate_limit[\s\S]*DROP TRIGGER IF EXISTS message_requests_shared_rate_limit[\s\S]*DROP TRIGGER IF EXISTS messages_shared_rate_limit/);
  assert.match(rollback, /CREATE TRIGGER friend_requests_shared_rate_limit[\s\S]*CREATE TRIGGER message_requests_shared_rate_limit[\s\S]*CREATE TRIGGER messages_shared_rate_limit/);
  assert.match(rollback, /No user, message, notification, match, or rate-limit bucket rows are deleted/);
});

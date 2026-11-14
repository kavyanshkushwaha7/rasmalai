import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { test } from "node:test";

const userA = "a21aa111-5d0b-4e12-9a80-82db9ec88f03";
const userB = "b21aa111-5d0b-4e12-9a80-82db9ec88f03";
const userC = "c21aa111-5d0b-4e12-9a80-82db9ec88f03";
const userD = "d21aa111-5d0b-4e12-9a80-82db9ec88f03";
const userE = "e21aa111-5d0b-4e12-9a80-82db9ec88f03";
const userF = "f21aa111-5d0b-4e12-9a80-82db9ec88f03";

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE prisma;
    GRANT authenticated TO prisma;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    CREATE TABLE storage.buckets (
      id text primary key, name text not null, public boolean not null,
      file_size_limit bigint, allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    CREATE FUNCTION storage.foldername(object_name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
      SELECT string_to_array(object_name, '/')
    $$;
  `);

  const migrations = [
    "0001_phase1_foundation",
    "0002_phase1_rls_hardening",
    "0003_phase1_security_hardening",
    "0004_phase2_message_request_notifications",
    "0005_phase2_social_messaging",
    "0006_phase4_online_games",
    "0007_phase4_restrict_room_summary",
    "0008_phase5_live_spectators",
    "0009_shared_atomic_rate_limits",
    "0010_online_rematches",
    "0011_social_action_rate_limits",
    "0012_disable_spectator_client_reads",
  ];
  for (const name of migrations) {
    const path = fileURLToPath(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url));
    await db.exec(await readFile(path, "utf8"));
  }

  await db.query(`
    INSERT INTO public.profiles (id, username, nickname)
    VALUES ($1::uuid, 'player_alpha', 'Player Alpha'),
           ($2::uuid, 'player_bravo', 'Player Bravo'),
           ($3::uuid, 'player_charlie', 'Player Charlie'),
           ($4::uuid, 'player_delta', 'Player Delta')
  `, [userA, userB, userC, userD]);
  await db.query(`
    INSERT INTO public.friendships (id, profile_a_id, profile_b_id)
    VALUES (gen_random_uuid(), $1::uuid, $2::uuid)
  `, [userA, userB]);
  return db;
}

async function assumeUser(db: PGlite, userId: string) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await db.exec("SET ROLE authenticated");
}

async function assumePrismaUser(db: PGlite, userId: string) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await db.exec("SET ROLE prisma");
}

test("shared rate limits are atomic, survive reconnects, expire, and isolate legitimate users", async () => {
  const db = await createDatabase();
  try {
    await assumePrismaUser(db, userA);
    const concurrent = await Promise.all(Array.from({ length: 30 }, () => db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_rate_limit('game_action') AS allowed",
    )));
    const accepted = concurrent.filter((result) => result.rows[0].allowed).length;
    assert.equal(accepted, 18);

    // A fresh authenticated DB context models a disconnected socket reconnecting
    // to this or another service instance. The same database bucket still denies it.
    await assumePrismaUser(db, userA);
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_rate_limit('game_action') AS allowed",
    )).rows[0].allowed, false);

    await assumePrismaUser(db, userB);
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_rate_limit('game_action') AS allowed",
    )).rows[0].allowed, true);

    await db.exec("RESET ROLE");
    await db.query(`UPDATE public.rasmalai_rate_limit_buckets
      SET window_started_at = clock_timestamp() - INTERVAL '11 seconds'
      WHERE user_id = $1::uuid AND action_key = 'game_action'`, [userA]);
    await assumePrismaUser(db, userA);
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_rate_limit('game_action') AS allowed",
    )).rows[0].allowed, true);
    await db.exec("RESET ROLE");
    assert.equal(Number((await db.query<{ request_count: number }>(
      "SELECT request_count FROM public.rasmalai_rate_limit_buckets WHERE user_id = $1::uuid AND action_key = 'game_action'",
      [userA],
    )).rows[0].request_count), 1);

    await assumeUser(db, userA);
    await assert.rejects(
      db.query("SELECT public.rasmalai_consume_rate_limit('room_join')"),
      /permission denied for function rasmalai_consume_rate_limit/i,
    );
  } finally {
    await db.close();
  }
});

test("every realtime action has a database-owned shared rate policy", async () => {
  const db = await createDatabase();
  try {
    await assumePrismaUser(db, userA);
    const actions = [
      "room_create", "room_join", "game_action", "player_chat_send", "player_chat_react",
      "match_reaction", "room_invite", "spectator_join", "spectator_accept", "spectator_invite",
      "spectator_chat_send", "spectator_chat_react", "voice_join", "voice_signal", "room_list",
      "spectator_list", "friend_request", "message_request", "direct_message_send",
      "rematch_request", "rematch_response",
      "social_friend_mutation", "social_message_request_mutation", "social_conversation_open",
      "social_conversation_read", "social_notification_read",
    ];
    const results = await Promise.all(actions.map((action) => db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_rate_limit($1::text) AS allowed", [action],
    )));
    assert.equal(results.every((result) => result.rows[0].allowed), true);
  } finally {
    await db.close();
  }
});

test("social attempt quotas are shared, atomic, per-user, and count even when no row is inserted", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      "INSERT INTO public.profiles (id, username, nickname) VALUES ($1::uuid, 'player_echo', 'Player Echo')",
      [userE],
    );
    await assumePrismaUser(db, userA);
    const concurrent = await Promise.all(Array.from({ length: 30 }, () => db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('friend_request') AS allowed",
    )));
    assert.equal(concurrent.filter((result) => result.rows[0].allowed).length, 5);

    // A duplicate/new connection is still charged to the same verified actor.
    await assumePrismaUser(db, userA);
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('friend_request') AS allowed",
    )).rows[0].allowed, false);

    // Another verified user has an independent budget.
    await assumePrismaUser(db, userB);
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('friend_request') AS allowed",
    )).rows[0].allowed, true);

    // A validly authenticated but invalid/self-directed business request fails
    // after the preflight quota commits; it must not insert a request row.
    await assumePrismaUser(db, userC);
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('friend_request') AS allowed",
    )).rows[0].allowed, true);
    await assumePrismaUser(db, userC);
    await assert.rejects(db.query(
      "SELECT public.rasmalai_send_friend_request($1::uuid)", [userC],
    ), /choose another player/i);
    await db.exec("RESET ROLE");
    assert.equal((await db.query("SELECT id FROM public.friend_requests WHERE sender_id = $1::uuid", [userC])).rows.length, 0);
    assert.equal(Number((await db.query<{ request_count: number }>(
      "SELECT request_count FROM public.rasmalai_rate_limit_buckets WHERE user_id = $1::uuid AND action_key = 'friend_request'",
      [userC],
    )).rows[0].request_count), 1);

    // A duplicate request is charged too, even though the business RPC rejects
    // it and no second request row is inserted.
    await assumePrismaUser(db, userE);
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('friend_request') AS allowed",
    )).rows[0].allowed, true);
    await db.query("SELECT public.rasmalai_send_friend_request($1::uuid)", [userC]);
    await assumePrismaUser(db, userE);
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('friend_request') AS allowed",
    )).rows[0].allowed, true);
    await assert.rejects(
      db.query("SELECT public.rasmalai_send_friend_request($1::uuid)", [userC]),
      /already pending|already exists/i,
    );
    await db.exec("RESET ROLE");
    assert.equal((await db.query("SELECT id FROM public.friend_requests WHERE sender_id = $1::uuid", [userE])).rows.length, 1);
    assert.equal(Number((await db.query<{ request_count: number }>(
      "SELECT request_count FROM public.rasmalai_rate_limit_buckets WHERE user_id = $1::uuid AND action_key = 'friend_request'",
      [userE],
    )).rows[0].request_count), 2);

    // Browser roles cannot invoke the server-only social limiter, generic
    // limiter, or social mutation RPCs directly.
    await assumeUser(db, userA);
    await assert.rejects(
      db.query("SELECT public.rasmalai_consume_social_action_limit('social_notification_read')"),
      /permission denied for function rasmalai_consume_social_action_limit/i,
    );
    await assert.rejects(
      db.query("SELECT public.rasmalai_consume_rate_limit('social_notification_read')"),
      /permission denied for function rasmalai_consume_rate_limit/i,
    );
    const mutationCalls: Array<[string, unknown[]]> = [
      ["SELECT public.rasmalai_send_friend_request($1::uuid)", [userC]],
      ["SELECT public.rasmalai_respond_friend_request($1::uuid, true)", [userC]],
      ["SELECT public.rasmalai_cancel_friend_request($1::uuid)", [userC]],
      ["SELECT public.rasmalai_unfriend($1::uuid)", [userC]],
      ["SELECT public.rasmalai_open_direct_conversation($1::uuid)", [userC]],
      ["SELECT public.rasmalai_send_message_request($1::uuid, 'test')", [userC]],
      ["SELECT public.rasmalai_respond_message_request($1::uuid, true)", [userC]],
      ["SELECT public.rasmalai_send_message($1::uuid, 'test')", [userC]],
      ["SELECT public.rasmalai_mark_conversation_read($1::uuid)", [userC]],
      ["SELECT public.rasmalai_mark_notifications_read($1::uuid)", [userC]],
    ];
    for (const [sql, params] of mutationCalls) {
      await assert.rejects(db.query(sql, params), /permission denied for function/i, sql);
    }
    await db.exec("RESET ROLE");
    await db.exec("SET ROLE anon");
    await db.query("SELECT set_config('request.jwt.claims', '', false)");
    await assert.rejects(
      db.query("SELECT public.rasmalai_consume_social_action_limit('social_notification_read')"),
      /permission denied for function rasmalai_consume_social_action_limit/i,
    );
  } finally {
    await db.close();
  }
});

test("all social mutation categories have independent attempt quotas including notification reads", async () => {
  const db = await createDatabase();
  try {
    const actions = [
      "friend_request", "message_request", "direct_message_send",
      "social_friend_mutation", "social_message_request_mutation", "social_conversation_open",
      "social_conversation_read", "social_notification_read",
    ];
    for (const action of actions) {
      await assumePrismaUser(db, userA);
      const result = await db.query<{ allowed: boolean }>(
        "SELECT public.rasmalai_consume_social_action_limit($1::text) AS allowed", [action],
      );
      assert.equal(result.rows[0].allowed, true, `${action} should be allowed for an unused user bucket`);
    }

    // A read attempt for a nonexistent notification still consumes the
    // preflight quota even though the business function updates no row.
    await db.query("SELECT public.rasmalai_mark_notifications_read($1::uuid)", ["f0000000-0000-4000-8000-000000000001"]);
    assert.equal((await db.query("SELECT id FROM public.notifications")).rows.length, 0);

    await assumePrismaUser(db, userA);
    const notifications = await Promise.all(Array.from({ length: 125 }, () => db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('social_notification_read') AS allowed",
    )));
    assert.equal(notifications.filter((result) => result.rows[0].allowed).length, 119, "one request was already consumed in the initial category check");
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('social_notification_read') AS allowed",
    )).rows[0].allowed, false);
    await assumePrismaUser(db, userB);
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('social_notification_read') AS allowed",
    )).rows[0].allowed, true);
  } finally {
    await db.close();
  }
});

test("social send preflights enforce shared quotas once per request before inserts", async () => {
  const db = await createDatabase();
  try {
    const recipients = Array.from({ length: 6 }, (_, index) => crypto.randomUUID());
    await db.query(
      "INSERT INTO public.profiles (id, username, nickname) SELECT value::uuid, 'limit_' || ordinal::text, 'Limit Target' FROM unnest($1::text[]) WITH ORDINALITY AS entries(value, ordinal)",
      [recipients],
    );
    await assumePrismaUser(db, userA);

    for (const recipientId of recipients.slice(0, 5)) {
      assert.equal((await db.query<{ allowed: boolean }>(
        "SELECT public.rasmalai_consume_social_action_limit('friend_request') AS allowed",
      )).rows[0].allowed, true);
      await db.query("SELECT public.rasmalai_send_friend_request($1::uuid)", [recipientId]);
    }
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('friend_request') AS allowed",
    )).rows[0].allowed, false);

    for (const recipientId of recipients.slice(0, 5)) {
      assert.equal((await db.query<{ allowed: boolean }>(
        "SELECT public.rasmalai_consume_social_action_limit('message_request') AS allowed",
      )).rows[0].allowed, true);
      await db.query("SELECT public.rasmalai_send_message_request($1::uuid, 'Hello')", [recipientId]);
    }
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('message_request') AS allowed",
    )).rows[0].allowed, false);

    const conversation = await db.query<{ conversation_id: string }>(
      "SELECT public.rasmalai_open_direct_conversation($1::uuid) AS conversation_id", [userB],
    );
    for (let index = 0; index < 30; index += 1) {
      assert.equal((await db.query<{ allowed: boolean }>(
        "SELECT public.rasmalai_consume_social_action_limit('direct_message_send') AS allowed",
      )).rows[0].allowed, true);
      await db.query("SELECT public.rasmalai_send_message($1::uuid, $2::text)", [conversation.rows[0].conversation_id, `Message ${index}`]);
    }
    assert.equal((await db.query<{ allowed: boolean }>(
      "SELECT public.rasmalai_consume_social_action_limit('direct_message_send') AS allowed",
    )).rows[0].allowed, false);

    assert.equal((await db.query("SELECT id FROM public.friend_requests WHERE sender_id = $1::uuid", [userA])).rows.length, 5);
    assert.equal((await db.query("SELECT id FROM public.message_requests WHERE sender_id = $1::uuid", [userA])).rows.length, 5);
    await db.exec("RESET ROLE");
    assert.equal(Number((await db.query<{ request_count: number }>(
      "SELECT request_count FROM public.rasmalai_rate_limit_buckets WHERE user_id = $1::uuid AND action_key = 'friend_request'", [userA],
    )).rows[0].request_count), 5, "the request bucket is charged once, not again by an insert trigger");
    assert.equal(Number((await db.query<{ request_count: number }>(
      "SELECT request_count FROM public.rasmalai_rate_limit_buckets WHERE user_id = $1::uuid AND action_key = 'message_request'", [userA],
    )).rows[0].request_count), 5);
    assert.equal(Number((await db.query<{ request_count: number }>(
      "SELECT request_count FROM public.rasmalai_rate_limit_buckets WHERE user_id = $1::uuid AND action_key = 'direct_message_send'", [userA],
    )).rows[0].request_count), 30);
    assert.equal((await db.query<{ tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.friend_requests'::regclass AND tgname = 'friend_requests_shared_rate_limit'",
    )).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("0011 rollback restores the previous authenticated RPC and trigger path without deleting rows", async () => {
  const db = await createDatabase();
  try {
    await assumePrismaUser(db, userA);
    await db.query("SELECT public.rasmalai_send_friend_request($1::uuid)", [userC]);
    await db.exec("RESET ROLE");
    const rollbackPath = fileURLToPath(new URL("../prisma/migrations/0011_social_action_rate_limits/rollback.sql", import.meta.url));
    await db.exec(await readFile(rollbackPath, "utf8"));

    const triggers = await db.query<{ tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE tgrelid IN ('public.friend_requests'::regclass, 'public.message_requests'::regclass, 'public.messages'::regclass) AND tgname IN ('friend_requests_shared_rate_limit', 'message_requests_shared_rate_limit', 'messages_shared_rate_limit')",
    );
    assert.equal(triggers.rows.length, 3);

    await assumeUser(db, userA);
    await assert.rejects(
      db.query("SELECT public.rasmalai_send_friend_request($1::uuid)", [userA]),
      /choose another player/i,
      "authenticated can call the restored RPC and reach its business validation",
    );
    await db.exec("RESET ROLE");
    assert.equal((await db.query("SELECT id FROM public.friend_requests WHERE sender_id = $1::uuid", [userA])).rows.length, 1);
  } finally {
    await db.close();
  }
});

function asJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

test("friend requests, accepted message requests, private conversations and unread counts enforce user isolation", async () => {
  const db = await createDatabase();
  try {
    await assumePrismaUser(db, userA);
    const opened = await db.query<{ conversation_id: string }>(
      "SELECT public.rasmalai_open_direct_conversation($1::uuid) AS conversation_id", [userB],
    );
    const friendConversationId = opened.rows[0].conversation_id;
    await db.query("SELECT public.rasmalai_send_message($1::uuid, $2)", [friendConversationId, "A private hello for B"]);

    await assumeUser(db, userA);
    const ownMessages = await db.query<{ body: string }>("SELECT body FROM public.messages WHERE conversation_id = $1::uuid", [friendConversationId]);
    assert.deepEqual(ownMessages.rows.map((row) => row.body), ["A private hello for B"]);
    await assert.rejects(
      db.query("INSERT INTO public.messages (id, conversation_id, author_id, body) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'bypass')", [friendConversationId, userA]),
      /permission denied for table messages/i,
    );

    await assumeUser(db, userD);
    assert.equal((await db.query("SELECT id FROM public.conversations WHERE id = $1::uuid", [friendConversationId])).rows.length, 0);
    assert.equal((await db.query("SELECT id FROM public.messages WHERE conversation_id = $1::uuid", [friendConversationId])).rows.length, 0);
    await assumePrismaUser(db, userD);
    await db.query("SELECT public.rasmalai_consume_social_action_limit('direct_message_send')");
    await assert.rejects(
      db.query("SELECT public.rasmalai_send_message($1::uuid, 'unauthorized')", [friendConversationId]),
      /Conversation not found/,
    );
    await db.exec("RESET ROLE");
    assert.equal((await db.query("SELECT id FROM public.messages WHERE conversation_id = $1::uuid", [friendConversationId])).rows.length, 1);
    assert.equal(Number((await db.query<{ request_count: number }>(
      "SELECT request_count FROM public.rasmalai_rate_limit_buckets WHERE user_id = $1::uuid AND action_key = 'direct_message_send'",
      [userD],
    )).rows[0].request_count), 1);

    await assumeUser(db, userB);
    let counts = await db.query<{ message_unread_count: bigint; notification_unread_count: bigint }>(
      "SELECT * FROM public.rasmalai_social_unread_counts()",
    );
    assert.equal(Number(counts.rows[0].message_unread_count), 1);
    assert.equal(Number(counts.rows[0].notification_unread_count), 1);
    await assumePrismaUser(db, userB);
    await db.query("SELECT public.rasmalai_mark_conversation_read($1::uuid)", [friendConversationId]);
    await assumeUser(db, userB);
    counts = await db.query("SELECT * FROM public.rasmalai_social_unread_counts()");
    assert.equal(Number(counts.rows[0].message_unread_count), 0);
    assert.equal(Number(counts.rows[0].notification_unread_count), 0);

    await assumePrismaUser(db, userA);
    const request = await db.query<{ rasmalai_send_friend_request: string }>(
      "SELECT public.rasmalai_send_friend_request($1::uuid)", [userC],
    );
    const friendRequestId = request.rows[0].rasmalai_send_friend_request;
    assert.equal((await db.query("SELECT id FROM public.notifications")).rows.length, 0);

    await assumeUser(db, userC);
    assert.equal((await db.query("SELECT id FROM public.friend_requests WHERE recipient_id = auth.uid()")).rows.length, 1);
    assert.equal((await db.query("SELECT id FROM public.notifications WHERE recipient_id = auth.uid() AND type = 'FRIEND_REQUEST'")).rows.length, 1);
    await assumePrismaUser(db, userC);
    await db.query("SELECT public.rasmalai_respond_friend_request($1::uuid, true)", [friendRequestId]);

    await assumePrismaUser(db, userA);
    assert.equal((await db.query("SELECT id FROM public.friendships WHERE profile_a_id = $1::uuid OR profile_b_id = $1::uuid", [userC])).rows.length, 1);
    assert.equal((await db.query("SELECT id FROM public.notifications WHERE type = 'FRIEND_ACCEPTED'")).rows.length, 1);

    await assumePrismaUser(db, userB);
    const messageRequest = await db.query<{ rasmalai_send_message_request: string }>(
      "SELECT public.rasmalai_send_message_request($1::uuid, $2)", [userC, "A hello before chatting"],
    );
    const messageRequestId = messageRequest.rows[0].rasmalai_send_message_request;

    await assumeUser(db, userD);
    assert.equal((await db.query("SELECT id FROM public.message_requests")).rows.length, 0);

    await assumeUser(db, userC);
    assert.equal((await db.query("SELECT id FROM public.message_requests WHERE recipient_id = auth.uid()")).rows.length, 1);
    await assumePrismaUser(db, userC);
    const accepted = await db.query<{ conversation_id: string }>(
      "SELECT public.rasmalai_respond_message_request($1::uuid, true) AS conversation_id", [messageRequestId],
    );
    const requestConversationId = accepted.rows[0].conversation_id;
    await assumeUser(db, userC);
    const initial = await db.query<{ author_id: string; body: string }>(
      "SELECT author_id, body FROM public.messages WHERE conversation_id = $1::uuid", [requestConversationId],
    );
    assert.deepEqual(initial.rows, [{ author_id: userB, body: "A hello before chatting" }]);

    await assumePrismaUser(db, userB);
    await db.query("SELECT public.rasmalai_send_message($1::uuid, 'Thanks for accepting')", [requestConversationId]);

    await assumeUser(db, userA);
    assert.equal((await db.query("SELECT id FROM public.messages WHERE conversation_id = $1::uuid", [requestConversationId])).rows.length, 0);

    await assumeUser(db, userB);
    const acceptedNotice = await db.query("SELECT id FROM public.notifications WHERE recipient_id = auth.uid() AND type = 'MESSAGE_REQUEST_ACCEPTED'");
    assert.equal(acceptedNotice.rows.length, 1);

    await assumeUser(db, userC);
    const received = await db.query<{ body: string }>("SELECT body FROM public.messages WHERE conversation_id = $1::uuid ORDER BY created_at", [requestConversationId]);
    assert.deepEqual(received.rows.map((row) => row.body), ["A hello before chatting", "Thanks for accepting"]);
    counts = await db.query("SELECT * FROM public.rasmalai_social_unread_counts()");
    assert.equal(Number(counts.rows[0].message_unread_count), 1);
    assert.equal(Number(counts.rows[0].notification_unread_count), 1);
  } finally {
    await db.close();
  }
});

test("an existing direct conversation becomes read-only after unfriend and resumes after friendship is restored", async () => {
  const db = await createDatabase();
  try {
    await assumePrismaUser(db, userA);
    const opened = await db.query<{ conversation_id: string }>(
      "SELECT public.rasmalai_open_direct_conversation($1::uuid) AS conversation_id", [userB],
    );
    const conversationId = opened.rows[0].conversation_id;
    await db.query("SELECT public.rasmalai_send_message($1::uuid, 'Before the friendship ended')", [conversationId]);
    await assumePrismaUser(db, userB);
    await db.query("SELECT public.rasmalai_mark_conversation_read($1::uuid)", [conversationId]);

    await assumePrismaUser(db, userA);
    await db.query("SELECT public.rasmalai_unfriend($1::uuid)", [userB]);
    await assumePrismaUser(db, userA);
    await db.query("SELECT public.rasmalai_consume_social_action_limit('direct_message_send')");
    await assert.rejects(
      db.query("SELECT public.rasmalai_send_message($1::uuid, 'Must not be inserted')", [conversationId]),
      /no longer have permission to message this player/i,
    );
    await db.exec("RESET ROLE");
    assert.equal((await db.query("SELECT id FROM public.messages WHERE conversation_id = $1::uuid", [conversationId])).rows.length, 1);

    await assumePrismaUser(db, userA);
    const request = await db.query<{ rasmalai_send_friend_request: string }>(
      "SELECT public.rasmalai_send_friend_request($1::uuid)", [userB],
    );
    await assumePrismaUser(db, userB);
    await db.query("SELECT public.rasmalai_respond_friend_request($1::uuid, true)", [request.rows[0].rasmalai_send_friend_request]);
    await assumePrismaUser(db, userA);
    await db.query("SELECT public.rasmalai_send_message($1::uuid, 'After the friendship was restored')", [conversationId]);
    await db.exec("RESET ROLE");
    const rows = await db.query<{ body: string }>(
      "SELECT body FROM public.messages WHERE conversation_id = $1::uuid ORDER BY created_at", [conversationId],
    );
    assert.deepEqual(rows.rows.map((row) => row.body), ["Before the friendship ended", "After the friendship was restored"]);

    await assumeUser(db, userB);
    const unread = await db.query<{ message_unread_count: bigint; notification_unread_count: bigint }>(
      "SELECT * FROM public.rasmalai_social_unread_counts()",
    );
    assert.equal(Number(unread.rows[0].message_unread_count), 1);
    assert.equal(Number(unread.rows[0].notification_unread_count), 1);
  } finally {
    await db.close();
  }
});

test("Phase 4 rooms enforce invite-only joins, server-only writes, turn order, persistence and chat isolation", async () => {
  const db = await createDatabase();
  const outsider = "e21aa111-5d0b-4e12-9a80-82db9ec88f03";
  try {
    await db.query("INSERT INTO public.profiles (id, username, nickname) VALUES ($1::uuid, 'player_echo', 'Player Echo')", [outsider]);

    await assumePrismaUser(db, userA);
    const createdRows = await db.query<{ room: unknown }>(
      "SELECT public.rasmalai_realtime_create_room('LUDO', 'PUBLIC', 4) AS room",
    );
    const created = asJson<{ roomId: string; roomCode: string; status: string }>(createdRows.rows[0].room);
    assert.equal(created.status, "WAITING");
    assert.match(created.roomCode, /^[A-F0-9]{8}$/);
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_room_summary($1::uuid)", [created.roomId]),
      /permission denied for function rasmalai_realtime_room_summary/i,
    );

    for (const user of [userB, userC, userD]) {
      await assumePrismaUser(db, user);
      const joined = await db.query<{ room: unknown }>(
        "SELECT public.rasmalai_realtime_join_room($1::uuid) AS room", [created.roomId],
      );
      const room = asJson<{ status: string; players: unknown[] }>(joined.rows[0].room);
      assert.equal(room.players.length, user === userD ? 4 : (user === userB ? 2 : 3));
      assert.equal(room.status, user === userD ? "IN_PROGRESS" : "WAITING");
    }

    const initialState = {
      players: ["Player Alpha", "Player Bravo", "Player Charlie", "Player Delta"].map((name) => ({ name, tokens: [-1, -1, -1, -1] })),
      turnIndex: 0, pendingRoll: null, winnerIndex: null, message: "Roll a six.",
    };
    await assumePrismaUser(db, userA);
    await db.query(
      "SELECT public.rasmalai_realtime_initialize_match($1::uuid, $2::jsonb)",
      [created.roomId, JSON.stringify(initialState)],
    );
    const chat = await db.query<{ message: unknown }>(
      "SELECT public.rasmalai_realtime_send_chat($1::uuid, $2) AS message", [created.roomId, "hello from player A"],
    );
    const message = asJson<{ id: string; body: string }>(chat.rows[0].message);
    assert.equal(message.body, "hello from player A");

    const rolledState = { ...initialState, pendingRoll: 6, message: "Player Alpha rolled 6." };
    const actionId = "a1111111-1111-4111-8111-111111111111";
    await db.query(
      "SELECT public.rasmalai_realtime_persist_action($1::uuid, 0, $2, $3::jsonb, $4::jsonb, false, NULL)",
      [created.roomId, actionId, JSON.stringify({ type: "roll", die: 6 }), JSON.stringify(rolledState)],
    );
    const duplicate = await db.query<{ room: unknown }>(
      "SELECT public.rasmalai_realtime_persist_action($1::uuid, 0, $2, $3::jsonb, $4::jsonb, false, NULL) AS room",
      [created.roomId, actionId, JSON.stringify({ type: "roll", die: 6 }), JSON.stringify(rolledState)],
    );
    assert.equal(asJson<{ version: number }>(duplicate.rows[0].room).version, 1);

    await assumePrismaUser(db, userB);
    await assert.rejects(
      db.query(
        "SELECT public.rasmalai_realtime_persist_action($1::uuid, 1, $2, $3::jsonb, $4::jsonb, false, NULL)",
        [created.roomId, "b1111111-1111-4111-8111-111111111111", JSON.stringify({ type: "roll", die: 5 }), JSON.stringify({ ...rolledState, turnIndex: 1 })],
      ),
      /another player’s turn/,
    );

    await assumePrismaUser(db, userA);
    const winningState = { ...rolledState, pendingRoll: null, winnerIndex: 0, message: "Player Alpha wins." };
    const finished = await db.query<{ room: unknown }>(
      "SELECT public.rasmalai_realtime_persist_action($1::uuid, 1, $2, $3::jsonb, $4::jsonb, true, 0) AS room",
      [created.roomId, "c1111111-1111-4111-8111-111111111111", JSON.stringify({ type: "move", tokenIndex: 0 }), JSON.stringify(winningState)],
    );
    assert.equal(asJson<{ status: string; version: number }>(finished.rows[0].room).status, "COMPLETED");
    assert.equal(asJson<{ status: string; version: number }>(finished.rows[0].room).version, 2);
    const updatedStats = await db.query<{ games_played: number; wins: number }>(
      "SELECT games_played, wins FROM public.profiles WHERE id = $1::uuid", [userA],
    );
    assert.deepEqual(updatedStats.rows[0], { games_played: 1, wins: 1 });
    assert.equal((await db.query("SELECT id FROM public.matches WHERE room_id = $1::uuid AND status = 'COMPLETED'", [created.roomId])).rows.length, 1);
    assert.equal((await db.query("SELECT id FROM public.notifications WHERE type = 'MATCH_RESULT' AND recipient_id = auth.uid()")).rows.length, 1);

    await db.query(
      "SELECT public.rasmalai_realtime_toggle_reaction($1::uuid, $2::uuid, '🎉')",
      [created.roomId, message.id],
    );

    await assumeUser(db, userA);
    const participantChat = await db.query<{ id: string }>(
      "SELECT id FROM public.game_chat_messages WHERE room_id = $1::uuid", [created.roomId],
    );
    assert.equal(participantChat.rows.length, 1);
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_chat_history($1::uuid)", [created.roomId]),
      /permission denied for function rasmalai_realtime_chat_history/i,
    );
    await assert.rejects(
      db.query("INSERT INTO public.game_chat_messages (room_id, author_id, body) VALUES ($1::uuid, $2::uuid, 'direct write')", [created.roomId, userA]),
      /permission denied for table game_chat_messages/i,
    );

    await assumeUser(db, userD);
    assert.equal((await db.query("SELECT id FROM public.game_chat_messages WHERE room_id = $1::uuid", [created.roomId])).rows.length, 1);

    await assumeUser(db, outsider);
    assert.equal((await db.query("SELECT id FROM public.room_players WHERE room_id = $1::uuid", [created.roomId])).rows.length, 0);
    assert.equal((await db.query("SELECT room_id FROM public.game_states WHERE room_id = $1::uuid", [created.roomId])).rows.length, 0);
    assert.equal((await db.query("SELECT id FROM public.game_chat_messages WHERE room_id = $1::uuid", [created.roomId])).rows.length, 0);
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_load_room($1::uuid)", [created.roomId]),
      /permission denied for function rasmalai_realtime_load_room/i,
    );
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_join_room($1::uuid)", [created.roomId]),
      /permission denied for function rasmalai_realtime_join_room/i,
    );

    await assumePrismaUser(db, userA);
    const privateRows = await db.query<{ room: unknown }>(
      "SELECT public.rasmalai_realtime_create_room('TIC_TAC_TOE', 'PRIVATE', 2) AS room",
    );
    const privateRoom = asJson<{ roomId: string; visibility: string }>(privateRows.rows[0].room);
    assert.equal(privateRoom.visibility, "PRIVATE");
    await db.query("SELECT public.rasmalai_realtime_invite_player($1::uuid, 'player_delta')", [privateRoom.roomId]);
    await assumePrismaUser(db, userB);
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_join_room($1::uuid)", [privateRoom.roomId]),
      /valid invitation is required/,
    );
    await assumePrismaUser(db, userD);
    const invitedJoin = await db.query<{ room: unknown }>(
      "SELECT public.rasmalai_realtime_join_room($1::uuid) AS room", [privateRoom.roomId],
    );
    assert.equal(asJson<{ status: string }>(invitedJoin.rows[0].room).status, "IN_PROGRESS");
  } finally {
    await db.close();
  }
});

test("online Tic Tac Toe rematches require consent, alternate X and preserve completed history", async () => {
  const db = await createDatabase();
  try {
    await assumePrismaUser(db, userA);
    const created = await db.query<{ room: unknown }>(
      "SELECT public.rasmalai_realtime_create_room('TIC_TAC_TOE', 'PUBLIC', 2) AS room",
    );
    const roomId = asJson<{ roomId: string }>(created.rows[0].room).roomId;
    await assumePrismaUser(db, userB);
    await db.query("SELECT public.rasmalai_realtime_join_room($1::uuid)", [roomId]);

    const initial = { players: [{ name: "Player Alpha" }, { name: "Player Bravo" }], turnIndex: 0, board: Array(9).fill(null), winnerIndex: null, isDraw: false, xPlayerIndex: 0 };
    await assumePrismaUser(db, userA);
    await db.query("SELECT public.rasmalai_realtime_initialize_match($1::uuid, $2::jsonb)", [roomId, JSON.stringify(initial)]);
    const states = [
      { ...initial, board: ["X", null, null, null, null, null, null, null, null], turnIndex: 1 },
      { ...initial, board: ["X", null, null, "O", null, null, null, null, null], turnIndex: 0 },
      { ...initial, board: ["X", "X", null, "O", null, null, null, null, null], turnIndex: 1 },
      { ...initial, board: ["X", "X", null, "O", "O", null, null, null, null], turnIndex: 0 },
      { ...initial, board: ["X", "X", "X", "O", "O", null, null, null, null], winnerIndex: 0 },
    ];
    const moves = [
      [userA, 0], [userB, 3], [userA, 1], [userB, 4], [userA, 2],
    ] as const;
    for (let index = 0; index < moves.length; index += 1) {
      const [actor, cell] = moves[index];
      await assumePrismaUser(db, actor);
      await db.query(
        "SELECT public.rasmalai_realtime_persist_action($1::uuid, $2::integer, $3::text, $4::jsonb, $5::jsonb, $6::boolean, $7::integer)",
        [roomId, index, crypto.randomUUID(), JSON.stringify({ type: "move", cell }), JSON.stringify(states[index]), index === 4, index === 4 ? 0 : null],
      );
    }

    await db.exec("RESET ROLE");
    const before = await db.query<{ id: string; status: string; winner_id: string; final_state: unknown }>(
      "SELECT id, status, winner_id, final_state FROM public.matches WHERE room_id = $1::uuid", [roomId],
    );
    assert.equal(before.rows.length, 1);
    const previous = before.rows[0];
    const historyMoves = await db.query<{ count: bigint }>("SELECT count(*) FROM public.game_moves WHERE match_id = $1::uuid", [previous.id]);
    assert.equal(Number(historyMoves.rows[0].count), 5);

    await assumePrismaUser(db, userC);
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'request', NULL, NULL, $2::jsonb)", [roomId, JSON.stringify(initial)]),
      /room membership required/i,
    );
    await assumeUser(db, userA);
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'request', NULL, NULL, $2::jsonb)", [roomId, JSON.stringify(initial)]),
      /permission denied for function rasmalai_realtime_rematch_action/i,
    );

    const secondRound = { ...initial, turnIndex: 1, xPlayerIndex: 1 };
    await assumePrismaUser(db, userA);
    let result = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'request', NULL, NULL, $2::jsonb) AS result",
      [roomId, JSON.stringify(secondRound)],
    );
    let response = asJson<{ room: { status: string; rematch: { requestId: string; acceptedPlayerIds: string[]; requiredPlayers: number } }; status: string }>(result.rows[0].result);
    const requestId = response.room.rematch.requestId;
    assert.equal(response.status, "PENDING");
    assert.deepEqual(response.room.rematch.acceptedPlayerIds, [userA]);
    assert.equal(response.room.rematch.requiredPlayers, 2);
    await assumePrismaUser(db, userB);
    const resumed = await db.query<{ room: unknown }>("SELECT public.rasmalai_realtime_load_room($1::uuid) AS room", [roomId]);
    assert.equal(asJson<{ rematch: { requestId: string } }>(resumed.rows[0].room).rematch.requestId, requestId);

    // Duplicate delivery is idempotent; one player's repeated click is still one vote.
    await assumePrismaUser(db, userA);
    const duplicateRequests = await Promise.all(Array.from({ length: 4 }, () => db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'request', NULL, NULL, $2::jsonb) AS result",
      [roomId, JSON.stringify(secondRound)],
    )));
    assert.ok(duplicateRequests.every((duplicate) => asJson<{ status: string }>(duplicate.rows[0].result).status === "PENDING"));
    await db.exec("RESET ROLE");
    assert.equal((await db.query("SELECT id FROM public.matches WHERE room_id = $1::uuid", [roomId])).rows.length, 1);

    await assumePrismaUser(db, userB);
    result = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'respond', $2::uuid, false, NULL) AS result",
      [roomId, requestId],
    );
    response = asJson(result.rows[0].result);
    assert.equal(response.status, "DECLINED");
    await assumePrismaUser(db, userA);
    result = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'request', NULL, NULL, $2::jsonb) AS result",
      [roomId, JSON.stringify(secondRound)],
    );
    response = asJson(result.rows[0].result);
    assert.equal(response.status, "PENDING");
    assert.notEqual(response.room.rematch.requestId, requestId);

    await assumePrismaUser(db, userB);
    result = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'respond', $2::uuid, true, $3::jsonb) AS result",
      [roomId, response.room.rematch.requestId, JSON.stringify(secondRound)],
    );
    response = asJson(result.rows[0].result);
    assert.equal(response.status, "STARTED");
    assert.equal(response.room.status, "IN_PROGRESS");
    assert.notEqual(response.room.matchId, previous.id);
    assert.equal(response.room.startingSeat, 1);
    assert.equal(response.room.state.turnIndex, 1);
    assert.equal(response.room.state.xPlayerIndex, 1);
    assert.deepEqual(response.room.state.board, Array(9).fill(null));
    assert.equal(response.room.state.winnerIndex, null);

    for (const [userId, body] of [[userA, "Player A after rematch"], [userB, "Player B after rematch"]] as const) {
      await assumePrismaUser(db, userId);
      const chat = await db.query<{ message: unknown }>(
        "SELECT public.rasmalai_realtime_send_chat($1::uuid, $2) AS message", [roomId, body],
      );
      const message = asJson<{ authorId: string; body: string }>(chat.rows[0].message);
      assert.equal(message.authorId, userId);
      assert.equal(message.body, body);
    }
    await assumePrismaUser(db, userC);
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_send_chat($1::uuid, 'outsider after rematch')", [roomId]),
      /room membership required/i,
    );

    await db.exec("RESET ROLE");
    const after = await db.query<{ id: string; status: string; winner_id: string | null; final_state: unknown }>(
      "SELECT id, status, winner_id, final_state FROM public.matches WHERE room_id = $1::uuid ORDER BY started_at, id", [roomId],
    );
    assert.equal(after.rows.length, 2);
    assert.deepEqual(after.rows[0], previous);
    assert.equal((await db.query("SELECT id FROM public.rematch_requests WHERE previous_match_id = $1::uuid", [previous.id])).rows.length, 2);
    assert.equal(after.rows[1].status, "IN_PROGRESS");
    assert.equal((await db.query("SELECT id FROM public.match_players WHERE match_id = $1::uuid", [after.rows[1].id])).rows.length, 2);
    assert.equal(Number((await db.query("SELECT count(*) FROM public.game_moves WHERE match_id = $1::uuid", [previous.id])).rows[0].count), 5);
    assert.deepEqual((await db.query("SELECT games_played, wins FROM public.profiles WHERE id = $1::uuid", [userA])).rows[0], { games_played: 1, wins: 1 });

    await assumePrismaUser(db, userB);
    await db.query(
      "SELECT public.rasmalai_realtime_persist_action($1::uuid, 6, $2, $3::jsonb, $4::jsonb, false, NULL)",
      [roomId, crypto.randomUUID(), JSON.stringify({ type: "move", cell: 4 }), JSON.stringify({ ...secondRound, board: [null, null, null, null, "X", null, null, null, null], turnIndex: 0, xPlayerIndex: 1 })],
    );
    await db.exec("RESET ROLE");
    assert.equal(Number((await db.query("SELECT count(*) FROM public.game_moves WHERE match_id = $1::uuid", [after.rows[1].id])).rows[0].count), 1);
  } finally {
    await db.close();
  }
});

test("multiplayer rematches wait for every Ludo or Snakes and Ladders player", async () => {
  const db = await createDatabase();
  try {
    async function createCompletedRoom(gameType: "LUDO" | "SNAKES_AND_LADDERS", playerCount: number) {
      await assumePrismaUser(db, userA);
      const created = await db.query<{ room: unknown }>(
        "SELECT public.rasmalai_realtime_create_room($1::public.\"GameType\", 'PUBLIC', $2::integer) AS room",
        [gameType, playerCount],
      );
      const roomId = asJson<{ roomId: string }>(created.rows[0].room).roomId;
      for (const player of [userB, userC, userD].slice(0, playerCount - 1)) {
        await assumePrismaUser(db, player);
        await db.query("SELECT public.rasmalai_realtime_join_room($1::uuid)", [roomId]);
      }
      const players = Array.from({ length: playerCount }, (_, index) => gameType === "LUDO"
        ? { name: `Player ${index + 1}`, tokens: [-1, -1, -1, -1], color: ["red", "green", "yellow", "blue"][index] }
        : { name: `Player ${index + 1}`, position: 0 });
      const initial = gameType === "LUDO"
        ? { players, turnIndex: 0, pendingRoll: null, winnerIndex: null, message: "Roll a six." }
        : { players, turnIndex: 0, winnerIndex: null, lastMove: null };
      await assumePrismaUser(db, userA);
      await db.query("SELECT public.rasmalai_realtime_initialize_match($1::uuid, $2::jsonb)", [roomId, JSON.stringify(initial)]);
      const finished = { ...initial, winnerIndex: 0 };
      await db.query(
        "SELECT public.rasmalai_realtime_persist_action($1::uuid, 0, $2, $3::jsonb, $4::jsonb, true, 0)",
        [roomId, crypto.randomUUID(), JSON.stringify({ type: "roll", die: 1 }), JSON.stringify(finished)],
      );
      return { roomId, players, initial };
    }

    const ludo = await createCompletedRoom("LUDO", 4);
    const ludoState = { players: ludo.players.map((player) => ({ ...player, tokens: [-1, -1, -1, -1] })), turnIndex: 1, pendingRoll: null, winnerIndex: null, message: "Roll a six." };
    await assumePrismaUser(db, userA);
    let response = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'request', NULL, NULL, $2::jsonb) AS result", [ludo.roomId, JSON.stringify(ludoState)],
    );
    let roomResult = asJson<{ room: { rematch: { requestId: string }; status: string }; status: string }>(response.rows[0].result);
    const requestId = roomResult.room.rematch.requestId;
    for (const player of [userB, userC]) {
      await assumePrismaUser(db, player);
      response = await db.query<{ result: unknown }>(
        "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'respond', $2::uuid, true, $3::jsonb) AS result",
        [ludo.roomId, requestId, JSON.stringify(ludoState)],
      );
      roomResult = asJson(response.rows[0].result);
      assert.equal(roomResult.status, "PENDING");
    }
    await assumePrismaUser(db, userD);
    response = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'respond', $2::uuid, false, NULL) AS result", [ludo.roomId, requestId],
    );
    assert.equal(asJson<{ status: string }>(response.rows[0].result).status, "DECLINED");
    await assumePrismaUser(db, userB);
    response = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'request', NULL, NULL, $2::jsonb) AS result", [ludo.roomId, JSON.stringify(ludoState)],
    );
    roomResult = asJson(response.rows[0].result);
    const retryId = roomResult.room.rematch.requestId;
    for (const player of [userA, userC, userD]) {
      await assumePrismaUser(db, player);
      response = await db.query<{ result: unknown }>(
        "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'respond', $2::uuid, true, $3::jsonb) AS result",
        [ludo.roomId, retryId, JSON.stringify(ludoState)],
      );
    }
    roomResult = asJson(response.rows[0].result);
    assert.equal(roomResult.status, "STARTED");
    assert.equal(roomResult.room.startingSeat, 1);
    assert.equal(roomResult.room.state.turnIndex, 1);
    assert.deepEqual(roomResult.room.state.players[0].tokens, [-1, -1, -1, -1]);

    const snakes = await createCompletedRoom("SNAKES_AND_LADDERS", 3);
    const snakesState = { players: snakes.players.map((player) => ({ name: player.name, position: 0 })), turnIndex: 1, winnerIndex: null, lastMove: null };
    await assumePrismaUser(db, userA);
    response = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'request', NULL, NULL, $2::jsonb) AS result", [snakes.roomId, JSON.stringify(snakesState)],
    );
    roomResult = asJson(response.rows[0].result);
    const snakesRequestId = roomResult.room.rematch.requestId;
    await assumePrismaUser(db, userB);
    response = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'respond', $2::uuid, true, $3::jsonb) AS result",
      [snakes.roomId, snakesRequestId, JSON.stringify(snakesState)],
    );
    assert.equal(asJson<{ status: string }>(response.rows[0].result).status, "PENDING");
    await assumePrismaUser(db, userC);
    response = await db.query<{ result: unknown }>(
      "SELECT public.rasmalai_realtime_rematch_action($1::uuid, 'respond', $2::uuid, true, $3::jsonb) AS result",
      [snakes.roomId, snakesRequestId, JSON.stringify(snakesState)],
    );
    roomResult = asJson(response.rows[0].result);
    assert.equal(roomResult.status, "STARTED");
    assert.equal(roomResult.room.startingSeat, 1);
    assert.equal(roomResult.room.state.turnIndex, 1);
    assert.ok(roomResult.room.state.players.every((player: { position: number }) => player.position === 0));
  } finally {
    await db.close();
  }
});

test("Phase 5 public watching is read-only and spectator chat is isolated", async () => {
  const db = await createDatabase();
  try {
    await db.query("INSERT INTO public.profiles (id, username, nickname) VALUES ($1::uuid, 'player_echo', 'Player Echo'), ($2::uuid, 'player_foxtrot', 'Player Foxtrot')", [userE, userF]);
    await assumePrismaUser(db, userA);
    const createdRows = await db.query<{ room: unknown }>(
      "SELECT public.rasmalai_realtime_create_room('TIC_TAC_TOE', 'PUBLIC', 2) AS room",
    );
    const roomId = asJson<{ roomId: string }>(createdRows.rows[0].room).roomId;
    await assumePrismaUser(db, userB);
    await db.query("SELECT public.rasmalai_realtime_join_room($1::uuid)", [roomId]);
    await db.query(
      "SELECT public.rasmalai_realtime_initialize_match($1::uuid, $2::jsonb)",
      [roomId, JSON.stringify({ players: [{ name: "Player Alpha" }, { name: "Player Bravo" }], turnIndex: 0, board: Array(9).fill(null), winnerIndex: null, isDraw: false })],
    );

    await assumePrismaUser(db, userE);
    const liveRooms = await db.query<{ rooms: unknown }>("SELECT public.rasmalai_realtime_list_public_live_rooms() AS rooms");
    assert.equal(asJson<Array<{ roomId: string; spectatorCount: number }>>(liveRooms.rows[0].rooms)[0].roomId, roomId);
    assert.equal(asJson<Array<{ spectatorCount: number }>>(liveRooms.rows[0].rooms)[0].spectatorCount, 0);
    const watched = await db.query<{ room: unknown }>("SELECT public.rasmalai_realtime_watch_room($1::uuid) AS room", [roomId]);
    assert.equal(asJson<{ status: string; spectatorCount: number }>(watched.rows[0].room).status, "IN_PROGRESS");
    assert.equal(asJson<{ spectatorCount: number }>(watched.rows[0].room).spectatorCount, 1);

    await assumePrismaUser(db, userA);
    await db.query(
      "SELECT public.rasmalai_realtime_persist_action($1::uuid, 0, $2, $3::jsonb, $4::jsonb, false, NULL)",
      [roomId, "a1111111-1111-4111-8111-111111111111", JSON.stringify({ type: "move", cell: 0 }), JSON.stringify({ players: [{ name: "Player Alpha" }, { name: "Player Bravo" }], turnIndex: 1, board: ["X", ...Array(8).fill(null)], winnerIndex: null, isDraw: false })],
    );
    await assumePrismaUser(db, userE);
    const refreshed = await db.query<{ room: unknown }>("SELECT public.rasmalai_realtime_watch_room($1::uuid) AS room", [roomId]);
    const refreshedRoom = asJson<{ version: number; state: { board: Array<string | null>; turnIndex: number } }>(refreshed.rows[0].room);
    assert.equal(refreshedRoom.version, 1);
    assert.equal(refreshedRoom.state.board[0], "X");
    assert.equal(refreshedRoom.state.turnIndex, 1);

    await assumeUser(db, userE);
    assert.equal((await db.query("SELECT id FROM public.game_rooms WHERE id = $1::uuid", [roomId])).rows.length, 0);
    assert.equal((await db.query("SELECT room_id FROM public.room_players WHERE room_id = $1::uuid", [roomId])).rows.length, 0);
    assert.equal((await db.query("SELECT room_id FROM public.game_states WHERE room_id = $1::uuid", [roomId])).rows.length, 0);
    assert.equal((await db.query("SELECT id FROM public.matches WHERE room_id = $1::uuid", [roomId])).rows.length, 0);
    assert.equal((await db.query("SELECT id FROM public.game_moves WHERE room_id = $1::uuid", [roomId])).rows.length, 0);
    assert.equal((await db.query("SELECT id FROM public.game_chat_messages WHERE room_id = $1::uuid", [roomId])).rows.length, 0);
    await assert.rejects(
      db.query("SELECT id FROM public.spectator_chat_messages WHERE room_id = $1::uuid", [roomId]),
      /permission denied for table spectator_chat_messages/i,
    );
    await assert.rejects(
      db.query("INSERT INTO public.spectator_chat_messages (room_id, author_id, body) VALUES ($1::uuid, $2::uuid, 'direct write')", [roomId, userE]),
      /permission denied for table spectator_chat_messages/i,
    );
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_send_chat($1::uuid, 'leak into player chat')", [roomId]),
      /permission denied for function rasmalai_realtime_send_chat/i,
    );
    await assumePrismaUser(db, userE);
    await assert.rejects(
      db.query("SELECT public.rasmalai_realtime_persist_action($1::uuid, 0, 'a1111111-1111-4111-8111-111111111111', '{\"type\":\"move\",\"cell\":0}'::jsonb, '{\"turnIndex\":1,\"board\":[\"X\",null,null,null,null,null,null,null,null],\"winnerIndex\":null,\"isDraw\":false}'::jsonb, false, NULL)", [roomId]),
      /room membership required/i,
    );

    await assumePrismaUser(db, userE);
    const sent = await db.query<{ message: unknown }>(
      "SELECT public.rasmalai_realtime_send_spectator_chat($1::uuid, $2) AS message", [roomId, "Hello from the audience"],
    );
    const message = asJson<{ id: string; body: string }>(sent.rows[0].message);
    assert.equal(message.body, "Hello from the audience");
    const history = await db.query<{ messages: unknown }>("SELECT public.rasmalai_realtime_toggle_spectator_reaction($1::uuid, $2::uuid, '👏') AS messages", [roomId, message.id]);
    assert.equal(asJson<Array<{ reactions: Array<{ emoji: string; count: number; mine: boolean }> }>>(history.rows[0].messages)[0].reactions[0].emoji, "👏");

    await assumeUser(db, userA);
    await assert.rejects(
      db.query("SELECT id FROM public.spectator_chat_messages WHERE room_id = $1::uuid", [roomId]),
      /permission denied for table spectator_chat_messages/i,
    );
    assert.equal((await db.query("SELECT id FROM public.game_chat_messages WHERE room_id = $1::uuid", [roomId])).rows.length, 0);

    await assumePrismaUser(db, userE);
    const left = await db.query<{ count: number }>("SELECT public.rasmalai_realtime_set_spectator_presence($1::uuid, false, true) AS count", [roomId]);
    assert.equal(left.rows[0].count, 0);
    await assumeUser(db, userE);
    assert.equal((await db.query("SELECT room_id FROM public.game_states WHERE room_id = $1::uuid", [roomId])).rows.length, 0);
    await assert.rejects(db.query("SELECT public.rasmalai_realtime_watch_room($1::uuid)", [roomId]), /permission denied for function rasmalai_realtime_watch_room/i);
  } finally {
    await db.close();
  }
});

test("Phase 5 private spectator invitations are explicit, revocable, and scoped to the recipient", async () => {
  const db = await createDatabase();
  try {
    await db.query("INSERT INTO public.profiles (id, username, nickname) VALUES ($1::uuid, 'player_echo', 'Player Echo'), ($2::uuid, 'player_foxtrot', 'Player Foxtrot')", [userE, userF]);
    await assumePrismaUser(db, userA);
    const createdRows = await db.query<{ room: unknown }>(
      "SELECT public.rasmalai_realtime_create_room('TIC_TAC_TOE', 'PRIVATE', 2) AS room",
    );
    const roomId = asJson<{ roomId: string }>(createdRows.rows[0].room).roomId;
    await db.query("SELECT public.rasmalai_realtime_invite_player($1::uuid, 'player_bravo')", [roomId]);
    await assumePrismaUser(db, userB);
    await db.query("SELECT public.rasmalai_realtime_join_room($1::uuid)", [roomId]);
    await db.query(
      "SELECT public.rasmalai_realtime_initialize_match($1::uuid, $2::jsonb)",
      [roomId, JSON.stringify({ players: [{ name: "Player Alpha" }, { name: "Player Bravo" }], turnIndex: 0, board: Array(9).fill(null), winnerIndex: null, isDraw: false })],
    );

    await assumePrismaUser(db, userA);
    const invitation = await db.query<{ invite: unknown }>(
      "SELECT public.rasmalai_realtime_invite_spectator($1::uuid, 'player_echo') AS invite", [roomId],
    );
    const inviteId = asJson<{ inviteId: string }>(invitation.rows[0].invite).inviteId;
    await assumeUser(db, userE);
    assert.equal((await db.query("SELECT id FROM public.notifications WHERE recipient_id = $1::uuid AND type = 'GAME_INVITE'", [userE])).rows.length, 1);

    await assumePrismaUser(db, userF);
    await assert.rejects(db.query("SELECT public.rasmalai_realtime_watch_room($1::uuid)", [roomId]), /public live match or accepted spectator invitation is required/i);
    await assert.rejects(db.query("SELECT id FROM public.spectator_invites"), /permission denied for table spectator_invites/i);

    await assumePrismaUser(db, userE);
    const pending = await db.query<{ invite: unknown }>("SELECT public.rasmalai_realtime_spectator_invite_info($1::uuid) AS invite", [roomId]);
    assert.equal(asJson<{ status: string }>(pending.rows[0].invite).status, "PENDING");
    await assert.rejects(db.query("SELECT public.rasmalai_realtime_watch_room($1::uuid)", [roomId]), /public live match or accepted spectator invitation is required/i);
    const accepted = await db.query<{ room: unknown }>("SELECT public.rasmalai_realtime_accept_spectator_invite($1::uuid) AS room", [roomId]);
    assert.equal(asJson<{ visibility: string; spectatorCount: number }>(accepted.rows[0].room).visibility, "PRIVATE");
    assert.equal(asJson<{ spectatorCount: number }>(accepted.rows[0].room).spectatorCount, 1);
    await assumeUser(db, userE);
    assert.equal((await db.query("SELECT room_id FROM public.game_states WHERE room_id = $1::uuid", [roomId])).rows.length, 0);
    assert.equal((await db.query("SELECT id FROM public.game_chat_messages WHERE room_id = $1::uuid", [roomId])).rows.length, 0);

    await assumePrismaUser(db, userA);
    assert.equal((await db.query("SELECT public.rasmalai_realtime_revoke_spectator_invite($1::uuid, $2::uuid) AS recipient", [roomId, inviteId])).rows[0].recipient, userE);
    assert.equal((await db.query("SELECT public.rasmalai_realtime_spectator_count($1::uuid) AS count", [roomId])).rows[0].count, 0);
    await assumePrismaUser(db, userE);
    await assert.rejects(db.query("SELECT public.rasmalai_realtime_watch_room($1::uuid)", [roomId]), /public live match or accepted spectator invitation is required/i);
    await assert.rejects(db.query("SELECT public.rasmalai_realtime_spectator_chat_history($1::uuid)", [roomId]), /active spectator access is required/i);
    await assumeUser(db, userE);
    await assert.rejects(db.query("SELECT id FROM public.spectator_chat_messages WHERE room_id = $1::uuid", [roomId]), /permission denied for table spectator_chat_messages/i);
    assert.equal((await db.query("SELECT room_id FROM public.game_states WHERE room_id = $1::uuid", [roomId])).rows.length, 0);
  } finally {
    await db.close();
  }
});

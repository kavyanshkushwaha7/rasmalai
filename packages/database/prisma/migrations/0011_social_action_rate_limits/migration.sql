-- Charge the existing friend/message/direct-message quotas before validation
-- so failed attempts count. Remove their insert triggers to avoid charging a
-- successful send twice. The web server commits this quota in a separate,
-- verified transaction before calling the mutation RPC.
ALTER TABLE public.rasmalai_rate_limit_buckets
  DROP CONSTRAINT rasmalai_rate_limit_action_key_check;
ALTER TABLE public.rasmalai_rate_limit_buckets
  ADD CONSTRAINT rasmalai_rate_limit_action_key_check CHECK (action_key IN (
    'room_create', 'room_join', 'game_action', 'player_chat_send', 'player_chat_react',
    'match_reaction', 'room_invite', 'spectator_join', 'spectator_accept',
    'spectator_invite', 'spectator_chat_send', 'spectator_chat_react',
    'voice_join', 'voice_signal', 'room_list', 'spectator_list',
    'friend_request', 'message_request', 'direct_message_send',
    'rematch_request', 'rematch_response',
    'social_friend_mutation',
    'social_message_request_mutation', 'social_conversation_open',
    'social_conversation_read', 'social_notification_read'
  ));

CREATE OR REPLACE FUNCTION public.rasmalai_consume_rate_limit(p_action TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_limit INTEGER;
  v_window_seconds INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;

  SELECT policy.max_requests, policy.window_seconds
    INTO v_limit, v_window_seconds
  FROM (VALUES
    ('room_create', 3, 60), ('room_join', 12, 10), ('game_action', 18, 10),
    ('player_chat_send', 8, 10), ('player_chat_react', 20, 10),
    ('match_reaction', 12, 10), ('room_invite', 10, 60),
    ('spectator_join', 8, 10), ('spectator_accept', 5, 30),
    ('spectator_invite', 8, 60), ('spectator_chat_send', 8, 10),
    ('spectator_chat_react', 20, 10), ('voice_join', 10, 10),
    ('voice_signal', 60, 10), ('room_list', 20, 10), ('spectator_list', 20, 10),
    ('friend_request', 5, 60), ('message_request', 5, 60),
    ('direct_message_send', 30, 60), ('rematch_request', 5, 60),
    ('rematch_response', 12, 60),
    ('social_friend_mutation', 30, 60),
    ('social_message_request_mutation', 30, 60),
    ('social_conversation_open', 60, 60),
    ('social_conversation_read', 120, 60),
    ('social_notification_read', 120, 60)
  ) AS policy(action_key, max_requests, window_seconds)
  WHERE policy.action_key = p_action;

  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'Unknown rate limit action' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rasmalai_rate_limit_buckets AS bucket
    (user_id, action_key, window_started_at, request_count)
  VALUES (v_user_id, p_action, v_now, 1)
  ON CONFLICT (user_id, action_key) DO UPDATE
    SET window_started_at = CASE
          WHEN bucket.window_started_at <= v_now - make_interval(secs => v_window_seconds) THEN v_now
          ELSE bucket.window_started_at
        END,
        request_count = CASE
          WHEN bucket.window_started_at <= v_now - make_interval(secs => v_window_seconds) THEN 1
          ELSE bucket.request_count + 1
        END
    WHERE bucket.window_started_at <= v_now - make_interval(secs => v_window_seconds)
       OR bucket.request_count < v_limit
  RETURNING bucket.request_count INTO v_count;

  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.rasmalai_consume_rate_limit(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_consume_rate_limit(TEXT) TO prisma;

-- App server only: callers cannot choose another user's identity or arbitrary
-- action keys. The server wrapper derives its JWT subject from a verified token.
CREATE OR REPLACE FUNCTION public.rasmalai_consume_social_action_limit(p_action TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN (
    'friend_request', 'message_request', 'direct_message_send',
    'social_friend_mutation',
    'social_message_request_mutation', 'social_conversation_open',
    'social_conversation_read', 'social_notification_read'
  ) THEN
    RAISE EXCEPTION 'Unknown social rate limit action' USING ERRCODE = '22023';
  END IF;
  RETURN public.rasmalai_consume_rate_limit(p_action);
END;
$function$;
REVOKE ALL ON FUNCTION public.rasmalai_consume_social_action_limit(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_consume_social_action_limit(TEXT) TO prisma;

-- Social mutations are exposed only through the authenticated web server, which
-- verifies the Supabase user and charges the attempt bucket in a committed
-- transaction before invoking these SECURITY DEFINER functions. Direct
-- PostgREST RPC calls by browser roles are closed; read-only RLS access remains.
REVOKE EXECUTE ON FUNCTION public.rasmalai_send_friend_request(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rasmalai_respond_friend_request(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rasmalai_cancel_friend_request(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rasmalai_unfriend(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rasmalai_open_direct_conversation(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rasmalai_send_message_request(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rasmalai_respond_message_request(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rasmalai_send_message(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rasmalai_mark_conversation_read(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rasmalai_mark_notifications_read(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rasmalai_send_friend_request(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_respond_friend_request(UUID, BOOLEAN) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_cancel_friend_request(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_unfriend(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_open_direct_conversation(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_send_message_request(UUID, TEXT) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_respond_message_request(UUID, BOOLEAN) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_send_message(UUID, TEXT) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_mark_conversation_read(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_mark_notifications_read(UUID) TO prisma;

-- These inserts are already charged in the preflight transaction using their
-- existing shared keys. Leaving the legacy triggers attached would count one
-- successful action twice. The trigger function and existing bucket rows stay
-- intact, so rollback can recreate the triggers without data restoration.
DROP TRIGGER IF EXISTS friend_requests_shared_rate_limit ON public.friend_requests;
DROP TRIGGER IF EXISTS message_requests_shared_rate_limit ON public.message_requests;
DROP TRIGGER IF EXISTS messages_shared_rate_limit ON public.messages;

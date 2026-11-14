-- Shared, atomic per-user request budgets. Buckets live in PostgreSQL so a new
-- socket or another web/realtime instance observes the same counter.
CREATE TABLE public.rasmalai_rate_limit_buckets (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_key VARCHAR(40) NOT NULL,
  window_started_at TIMESTAMPTZ(6) NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (user_id, action_key),
  CONSTRAINT rasmalai_rate_limit_action_key_check CHECK (action_key IN (
    'room_create', 'room_join', 'game_action', 'player_chat_send', 'player_chat_react',
    'match_reaction', 'room_invite', 'spectator_join', 'spectator_accept',
    'spectator_invite', 'spectator_chat_send', 'spectator_chat_react',
    'voice_join', 'voice_signal', 'room_list', 'spectator_list',
    'friend_request', 'message_request', 'direct_message_send'
  ))
);
ALTER TABLE public.rasmalai_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rasmalai_rate_limit_buckets FROM PUBLIC, anon, authenticated, prisma;

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
    ('room_create', 3, 60),
    ('room_join', 12, 10),
    ('game_action', 18, 10),
    ('player_chat_send', 8, 10),
    ('player_chat_react', 20, 10),
    ('match_reaction', 12, 10),
    ('room_invite', 10, 60),
    ('spectator_join', 8, 10),
    ('spectator_accept', 5, 30),
    ('spectator_invite', 8, 60),
    ('spectator_chat_send', 8, 10),
    ('spectator_chat_react', 20, 10),
    ('voice_join', 10, 10),
    ('voice_signal', 60, 10),
    ('room_list', 20, 10),
    ('spectator_list', 20, 10),
    ('friend_request', 5, 60),
    ('message_request', 5, 60),
    ('direct_message_send', 30, 60)
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

CREATE OR REPLACE FUNCTION public.rasmalai_rate_limit_social_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_action TEXT;
  v_actor UUID;
BEGIN
  IF TG_TABLE_NAME = 'friend_requests' THEN
    v_action := 'friend_request';
    v_actor := NEW.sender_id;
  ELSIF TG_TABLE_NAME = 'message_requests' THEN
    v_action := 'message_request';
    v_actor := NEW.sender_id;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    -- Accepting a message request writes the requester's initial message on
    -- their behalf; only count messages sent by the currently verified actor.
    IF auth.uid() IS NULL OR NEW.author_id IS DISTINCT FROM auth.uid() THEN
      RETURN NEW;
    END IF;
    v_action := 'direct_message_send';
    v_actor := NEW.author_id;
  ELSE
    RAISE EXCEPTION 'Unsupported rate-limited table' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NULL OR v_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'The request actor is invalid' USING ERRCODE = '42501';
  END IF;
  IF NOT public.rasmalai_consume_rate_limit(v_action) THEN
    RAISE EXCEPTION 'Too many requests; please try again shortly' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.rasmalai_rate_limit_social_insert() FROM PUBLIC, anon, authenticated, prisma;

CREATE TRIGGER friend_requests_shared_rate_limit
  BEFORE INSERT ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.rasmalai_rate_limit_social_insert();
CREATE TRIGGER message_requests_shared_rate_limit
  BEFORE INSERT ON public.message_requests
  FOR EACH ROW EXECUTE FUNCTION public.rasmalai_rate_limit_social_insert();
CREATE TRIGGER messages_shared_rate_limit
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rasmalai_rate_limit_social_insert();

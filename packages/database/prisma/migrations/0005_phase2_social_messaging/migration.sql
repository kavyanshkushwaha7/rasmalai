-- Phase 2 social foundation. This migration is additive and preserves Phase 1 data.
-- Social writes are exposed only through SECURITY DEFINER functions that derive
-- the actor from auth.uid(); direct Data API writes remain revoked.

ALTER TABLE public.conversations
  ADD COLUMN direct_key TEXT;

CREATE UNIQUE INDEX conversations_direct_key_key
  ON public.conversations (direct_key);

REVOKE ALL ON TABLE public.friend_requests, public.friendships,
  public.message_requests, public.conversations, public.conversation_members,
  public.messages, public.notifications
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, sender_id, recipient_id, status, created_at)
  ON TABLE public.friend_requests TO authenticated;
GRANT SELECT (id, profile_a_id, profile_b_id, accepted_at)
  ON TABLE public.friendships TO authenticated;
GRANT SELECT (id, sender_id, recipient_id, initial_message, status, created_at)
  ON TABLE public.message_requests TO authenticated;
GRANT SELECT (id, kind, created_at)
  ON TABLE public.conversations TO authenticated;
GRANT SELECT (id, conversation_id, profile_id, joined_at)
  ON TABLE public.conversation_members TO authenticated;
GRANT SELECT (id, conversation_id, author_id, body, created_at, edited_at, deleted_at)
  ON TABLE public.messages TO authenticated;
GRANT SELECT (id, recipient_id, actor_id, type, payload, read_at, created_at)
  ON TABLE public.notifications TO authenticated;

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rasmalai_is_conversation_member(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.conversation_members AS member
    WHERE member.conversation_id = p_conversation_id
      AND member.profile_id = auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION public.rasmalai_is_conversation_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rasmalai_is_conversation_member(UUID) TO authenticated;

DROP POLICY IF EXISTS friend_requests_participant_read ON public.friend_requests;
CREATE POLICY friend_requests_participant_read ON public.friend_requests
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

DROP POLICY IF EXISTS friendships_participant_read ON public.friendships;
CREATE POLICY friendships_participant_read ON public.friendships
  FOR SELECT TO authenticated
  USING (profile_a_id = auth.uid() OR profile_b_id = auth.uid());

DROP POLICY IF EXISTS message_requests_participant_read ON public.message_requests;
CREATE POLICY message_requests_participant_read ON public.message_requests
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

DROP POLICY IF EXISTS conversations_member_read ON public.conversations;
CREATE POLICY conversations_member_read ON public.conversations
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_conversation_member(id));

DROP POLICY IF EXISTS conversation_members_member_read ON public.conversation_members;
CREATE POLICY conversation_members_member_read ON public.conversation_members
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_conversation_member(conversation_id));

DROP POLICY IF EXISTS messages_member_read ON public.messages;
CREATE POLICY messages_member_read ON public.messages
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_conversation_member(conversation_id));

DROP POLICY IF EXISTS notifications_recipient_read ON public.notifications;
CREATE POLICY notifications_recipient_read ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

CREATE OR REPLACE FUNCTION public.rasmalai_send_friend_request(p_recipient_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_request_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_user_id THEN
    RAISE EXCEPTION 'Choose another player' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_recipient_id) THEN
    RAISE EXCEPTION 'Player not found' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    LEAST(v_user_id::TEXT, p_recipient_id::TEXT) || ':' || GREATEST(v_user_id::TEXT, p_recipient_id::TEXT), 0
  ));
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = v_user_id AND blocked_id = p_recipient_id)
       OR (blocker_id = p_recipient_id AND blocked_id = v_user_id)
  ) THEN
    RAISE EXCEPTION 'This player is unavailable' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.friendships
    WHERE (profile_a_id = LEAST(v_user_id, p_recipient_id)
       AND profile_b_id = GREATEST(v_user_id, p_recipient_id))
  ) THEN
    RAISE EXCEPTION 'You are already friends' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.friend_requests
    WHERE status = 'PENDING'
      AND ((sender_id = v_user_id AND recipient_id = p_recipient_id)
        OR (sender_id = p_recipient_id AND recipient_id = v_user_id))
  ) THEN
    RAISE EXCEPTION 'A friend request is already pending' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.friend_requests (id, sender_id, recipient_id, status, created_at, updated_at)
  VALUES (gen_random_uuid(), v_user_id, p_recipient_id, 'PENDING', clock_timestamp(), clock_timestamp())
  ON CONFLICT (sender_id, recipient_id) DO UPDATE
    SET status = 'PENDING', created_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE public.friend_requests.status IN ('REJECTED', 'CANCELLED')
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'A friend request already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.notifications (id, recipient_id, actor_id, type, payload)
  VALUES (gen_random_uuid(), p_recipient_id, v_user_id, 'FRIEND_REQUEST', jsonb_build_object('request_id', v_request_id));
  RETURN v_request_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_respond_friend_request(p_request_id UUID, p_accept BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_sender_id UUID;
  v_recipient_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;

  SELECT sender_id, recipient_id INTO v_sender_id, v_recipient_id
  FROM public.friend_requests
  WHERE id = p_request_id AND recipient_id = v_user_id AND status = 'PENDING'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending friend request not found' USING ERRCODE = '42501';
  END IF;

  IF p_accept THEN
    IF EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = v_user_id AND blocked_id = v_sender_id)
         OR (blocker_id = v_sender_id AND blocked_id = v_user_id)
    ) THEN
      RAISE EXCEPTION 'This player is unavailable' USING ERRCODE = '42501';
    END IF;
    UPDATE public.friend_requests SET status = 'ACCEPTED', updated_at = clock_timestamp() WHERE id = p_request_id;
    INSERT INTO public.friendships (id, profile_a_id, profile_b_id)
    VALUES (gen_random_uuid(), LEAST(v_user_id, v_sender_id), GREATEST(v_user_id, v_sender_id))
    ON CONFLICT (profile_a_id, profile_b_id) DO NOTHING;
    INSERT INTO public.notifications (id, recipient_id, actor_id, type, payload)
    VALUES (gen_random_uuid(), v_sender_id, v_user_id, 'FRIEND_ACCEPTED', jsonb_build_object('request_id', p_request_id));
    UPDATE public.notifications SET read_at = clock_timestamp()
      WHERE recipient_id = v_user_id AND read_at IS NULL AND type = 'FRIEND_REQUEST'
        AND payload ->> 'request_id' = p_request_id::TEXT;
    RETURN 'ACCEPTED';
  END IF;

  UPDATE public.friend_requests SET status = 'REJECTED', updated_at = clock_timestamp() WHERE id = p_request_id;
  UPDATE public.notifications SET read_at = clock_timestamp()
    WHERE recipient_id = v_user_id AND read_at IS NULL AND type = 'FRIEND_REQUEST'
      AND payload ->> 'request_id' = p_request_id::TEXT;
  RETURN 'REJECTED';
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_cancel_friend_request(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.friend_requests SET status = 'CANCELLED', updated_at = clock_timestamp()
  WHERE id = p_request_id AND sender_id = v_user_id AND status = 'PENDING';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending friend request not found' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET read_at = clock_timestamp()
    WHERE recipient_id = (SELECT recipient_id FROM public.friend_requests WHERE id = p_request_id)
      AND read_at IS NULL AND type = 'FRIEND_REQUEST'
      AND payload ->> 'request_id' = p_request_id::TEXT;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_unfriend(p_friend_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_friend_id IS NULL OR p_friend_id = v_user_id THEN
    RAISE EXCEPTION 'An authenticated user and friend are required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.friendships
  WHERE profile_a_id = LEAST(v_user_id, p_friend_id)
    AND profile_b_id = GREATEST(v_user_id, p_friend_id);
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_open_direct_conversation(p_friend_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT;
  v_conversation_id UUID;
BEGIN
  IF v_user_id IS NULL OR p_friend_id IS NULL OR p_friend_id = v_user_id THEN
    RAISE EXCEPTION 'An authenticated friend is required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = v_user_id AND blocked_id = p_friend_id)
       OR (blocker_id = p_friend_id AND blocked_id = v_user_id)
  ) THEN
    RAISE EXCEPTION 'This player is unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE profile_a_id = LEAST(v_user_id, p_friend_id)
      AND profile_b_id = GREATEST(v_user_id, p_friend_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.message_requests
    WHERE status = 'ACCEPTED'
      AND ((sender_id = v_user_id AND recipient_id = p_friend_id)
        OR (sender_id = p_friend_id AND recipient_id = v_user_id))
  ) THEN
    RAISE EXCEPTION 'You can start a conversation with friends or accepted message requests only' USING ERRCODE = '42501';
  END IF;

  v_key := LEAST(v_user_id::TEXT, p_friend_id::TEXT) || ':' || GREATEST(v_user_id::TEXT, p_friend_id::TEXT);
  INSERT INTO public.conversations (id, kind, direct_key, created_at, updated_at)
  VALUES (gen_random_uuid(), 'DIRECT', v_key, clock_timestamp(), clock_timestamp())
  ON CONFLICT (direct_key) DO NOTHING;
  SELECT id INTO v_conversation_id FROM public.conversations WHERE direct_key = v_key;
  INSERT INTO public.conversation_members (id, conversation_id, profile_id)
  VALUES (gen_random_uuid(), v_conversation_id, v_user_id), (gen_random_uuid(), v_conversation_id, p_friend_id)
  ON CONFLICT (conversation_id, profile_id) DO NOTHING;
  RETURN v_conversation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_send_message_request(p_recipient_id UUID, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_request_id UUID;
  v_body TEXT := btrim(p_body);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_user_id THEN
    RAISE EXCEPTION 'Choose another player' USING ERRCODE = '22023';
  END IF;
  IF v_body IS NULL OR length(v_body) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Message requests must contain 1 to 1000 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_recipient_id) THEN
    RAISE EXCEPTION 'Player not found' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    LEAST(v_user_id::TEXT, p_recipient_id::TEXT) || ':' || GREATEST(v_user_id::TEXT, p_recipient_id::TEXT), 0
  ));
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = v_user_id AND blocked_id = p_recipient_id)
       OR (blocker_id = p_recipient_id AND blocked_id = v_user_id)
  ) THEN
    RAISE EXCEPTION 'This player is unavailable' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.friendships
    WHERE profile_a_id = LEAST(v_user_id, p_recipient_id)
      AND profile_b_id = GREATEST(v_user_id, p_recipient_id)
  ) THEN
    RAISE EXCEPTION 'You are already friends; start a conversation instead' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.message_requests
    WHERE sender_id = p_recipient_id AND recipient_id = v_user_id AND status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'Accept the message request from this player first' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.message_requests (id, sender_id, recipient_id, initial_message, status, created_at, updated_at)
  VALUES (gen_random_uuid(), v_user_id, p_recipient_id, v_body, 'PENDING', clock_timestamp(), clock_timestamp())
  ON CONFLICT (sender_id, recipient_id) DO UPDATE
    SET initial_message = EXCLUDED.initial_message, status = 'PENDING',
        created_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE public.message_requests.status = 'REJECTED'
  RETURNING id INTO v_request_id;
  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'A message request already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.notifications (id, recipient_id, actor_id, type, payload)
  VALUES (gen_random_uuid(), p_recipient_id, v_user_id, 'MESSAGE_REQUEST', jsonb_build_object('request_id', v_request_id));
  RETURN v_request_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_respond_message_request(p_request_id UUID, p_accept BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_sender_id UUID;
  v_recipient_id UUID;
  v_body TEXT;
  v_key TEXT;
  v_conversation_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;
  SELECT sender_id, recipient_id, initial_message
    INTO v_sender_id, v_recipient_id, v_body
  FROM public.message_requests
  WHERE id = p_request_id AND recipient_id = v_user_id AND status = 'PENDING'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending message request not found' USING ERRCODE = '42501';
  END IF;
  IF NOT p_accept THEN
    UPDATE public.message_requests SET status = 'REJECTED', updated_at = clock_timestamp() WHERE id = p_request_id;
    UPDATE public.notifications SET read_at = clock_timestamp()
      WHERE recipient_id = v_user_id AND read_at IS NULL AND type = 'MESSAGE_REQUEST'
        AND payload ->> 'request_id' = p_request_id::TEXT;
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = v_user_id AND blocked_id = v_sender_id)
       OR (blocker_id = v_sender_id AND blocked_id = v_user_id)
  ) THEN
    RAISE EXCEPTION 'This player is unavailable' USING ERRCODE = '42501';
  END IF;

  v_key := LEAST(v_user_id::TEXT, v_sender_id::TEXT) || ':' || GREATEST(v_user_id::TEXT, v_sender_id::TEXT);
  INSERT INTO public.conversations (id, kind, direct_key, created_at, updated_at)
  VALUES (gen_random_uuid(), 'DIRECT', v_key, clock_timestamp(), clock_timestamp())
  ON CONFLICT (direct_key) DO NOTHING;
  SELECT id INTO v_conversation_id FROM public.conversations WHERE direct_key = v_key;
  INSERT INTO public.conversation_members (id, conversation_id, profile_id)
  VALUES (gen_random_uuid(), v_conversation_id, v_user_id), (gen_random_uuid(), v_conversation_id, v_sender_id)
  ON CONFLICT (conversation_id, profile_id) DO NOTHING;
  INSERT INTO public.messages (id, conversation_id, author_id, body)
  VALUES (gen_random_uuid(), v_conversation_id, v_sender_id, v_body);
  UPDATE public.message_requests SET status = 'ACCEPTED', updated_at = clock_timestamp() WHERE id = p_request_id;
  UPDATE public.notifications SET read_at = clock_timestamp()
    WHERE recipient_id = v_user_id AND read_at IS NULL AND type = 'MESSAGE_REQUEST'
      AND payload ->> 'request_id' = p_request_id::TEXT;
  INSERT INTO public.notifications (id, recipient_id, actor_id, type, payload)
  VALUES (gen_random_uuid(), v_sender_id, v_user_id, 'MESSAGE_REQUEST_ACCEPTED', jsonb_build_object('request_id', p_request_id));
  RETURN v_conversation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_send_message(p_conversation_id UUID, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_other_id UUID;
  v_member_count INTEGER;
  v_message_id UUID;
  v_body TEXT := btrim(p_body);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;
  IF v_body IS NULL OR length(v_body) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Messages must contain 1 to 4000 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = p_conversation_id AND profile_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = '42501';
  END IF;
  SELECT count(*), min(profile_id::TEXT) FILTER (WHERE profile_id <> v_user_id)::UUID
    INTO v_member_count, v_other_id
  FROM public.conversation_members WHERE conversation_id = p_conversation_id;
  IF v_member_count <> 2 OR v_other_id IS NULL THEN
    RAISE EXCEPTION 'This conversation is unavailable' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = v_user_id AND blocked_id = v_other_id)
       OR (blocker_id = v_other_id AND blocked_id = v_user_id)
  ) THEN
    RAISE EXCEPTION 'This player is unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE profile_a_id = LEAST(v_user_id, v_other_id)
      AND profile_b_id = GREATEST(v_user_id, v_other_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.message_requests
    WHERE status = 'ACCEPTED'
      AND ((sender_id = v_user_id AND recipient_id = v_other_id)
        OR (sender_id = v_other_id AND recipient_id = v_user_id))
  ) THEN
    RAISE EXCEPTION 'You no longer have permission to message this player' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.messages (id, conversation_id, author_id, body)
  VALUES (gen_random_uuid(), p_conversation_id, v_user_id, v_body)
  RETURNING id INTO v_message_id;
  INSERT INTO public.notifications (id, recipient_id, actor_id, type, payload)
  VALUES (gen_random_uuid(), v_other_id, v_user_id, 'NEW_MESSAGE', jsonb_build_object('conversation_id', p_conversation_id, 'message_id', v_message_id));
  RETURN v_message_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_mark_conversation_read(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = p_conversation_id AND profile_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = '42501';
  END IF;
  UPDATE public.conversation_members
  SET last_read_at = clock_timestamp()
  WHERE conversation_id = p_conversation_id AND profile_id = v_user_id;
  UPDATE public.notifications
  SET read_at = clock_timestamp()
  WHERE recipient_id = v_user_id AND read_at IS NULL AND type = 'NEW_MESSAGE'
    AND payload ->> 'conversation_id' = p_conversation_id::TEXT;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_mark_notifications_read(p_notification_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_updated INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications
  SET read_at = clock_timestamp()
  WHERE recipient_id = v_user_id AND read_at IS NULL
    AND (p_notification_id IS NULL OR id = p_notification_id);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_social_unread_counts()
RETURNS TABLE (message_unread_count BIGINT, notification_unread_count BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.messages AS message
      JOIN public.conversation_members AS member ON member.conversation_id = message.conversation_id
      WHERE member.profile_id = v_user_id
        AND message.author_id <> v_user_id
        AND message.created_at > COALESCE(member.last_read_at, member.joined_at)),
    (SELECT count(*) FROM public.notifications AS notification
      WHERE notification.recipient_id = v_user_id AND notification.read_at IS NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.rasmalai_send_friend_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_respond_friend_request(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_cancel_friend_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_unfriend(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_open_direct_conversation(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_send_message_request(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_respond_message_request(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_send_message(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_mark_conversation_read(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_mark_notifications_read(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_social_unread_counts() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rasmalai_send_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_respond_friend_request(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_cancel_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_unfriend(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_open_direct_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_send_message_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_respond_message_request(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_send_message(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_mark_conversation_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_mark_notifications_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_social_unread_counts() TO authenticated;

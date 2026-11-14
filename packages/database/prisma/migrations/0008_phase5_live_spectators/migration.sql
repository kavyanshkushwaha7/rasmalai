-- Phase 5 live spectators. Additive tables and guarded server RPCs only.
-- Spectators never join the player Socket.IO channel and never receive player chat/voice events.

ALTER TABLE public.spectators
  ADD COLUMN last_seen_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN disconnected_at TIMESTAMPTZ(6),
  ADD COLUMN left_at TIMESTAMPTZ(6);

CREATE TABLE public.spectator_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public."GameInviteStatus" NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ(6) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT spectator_invites_not_self CHECK (sender_id <> recipient_id),
  CONSTRAINT spectator_invites_room_recipient_unique UNIQUE (room_id, recipient_id)
);
CREATE INDEX spectator_invites_recipient_status_created_idx
  ON public.spectator_invites(recipient_id, status, created_at DESC);
CREATE INDEX spectator_invites_room_status_idx ON public.spectator_invites(room_id, status);

CREATE TABLE public.spectator_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT spectator_chat_messages_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 500)
);
CREATE INDEX spectator_chat_messages_room_created_idx
  ON public.spectator_chat_messages(room_id, created_at DESC);

CREATE TABLE public.spectator_chat_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.spectator_chat_messages(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT spectator_chat_reactions_emoji_check CHECK (emoji IN ('👍','👏','😂','😮','😢','🎉','❤️','🔥')),
  CONSTRAINT spectator_chat_reactions_unique UNIQUE (message_id, profile_id, emoji)
);
CREATE INDEX spectator_chat_reactions_room_message_idx
  ON public.spectator_chat_reactions(room_id, message_id);

ALTER TABLE public.spectator_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectator_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectator_chat_reactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.spectator_invites, public.spectator_chat_messages, public.spectator_chat_reactions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.spectator_invites, public.spectator_chat_messages, public.spectator_chat_reactions
  TO authenticated;

CREATE OR REPLACE FUNCTION public.rasmalai_is_active_spectator(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.spectators AS spectator
    WHERE spectator.room_id = p_room_id AND spectator.profile_id = auth.uid()
      AND spectator.left_at IS NULL
  )
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_is_match_spectator(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.matches AS match
    JOIN public.spectators AS spectator ON spectator.room_id = match.room_id
    WHERE match.id = p_match_id AND spectator.profile_id = auth.uid() AND spectator.left_at IS NULL
  )
$function$;

REVOKE ALL ON FUNCTION public.rasmalai_is_active_spectator(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_is_match_spectator(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rasmalai_is_active_spectator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_is_match_spectator(UUID) TO authenticated;

DROP POLICY spectators_owner_read ON public.spectators;
CREATE POLICY spectators_owner_read ON public.spectators
  FOR SELECT TO authenticated USING (profile_id = auth.uid() AND left_at IS NULL);

DROP POLICY game_rooms_public_lobby_or_player_read ON public.game_rooms;
CREATE POLICY game_rooms_public_lobby_or_player_read ON public.game_rooms
  FOR SELECT TO authenticated
  USING ((visibility = 'PUBLIC' AND status = 'WAITING')
    OR public.rasmalai_is_room_player(id) OR public.rasmalai_is_active_spectator(id));

DROP POLICY room_players_participant_read ON public.room_players;
CREATE POLICY room_players_participant_read ON public.room_players
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.rasmalai_is_room_player(room_id)
    OR public.rasmalai_is_active_spectator(room_id));

DROP POLICY game_states_player_read ON public.game_states;
CREATE POLICY game_states_player_read ON public.game_states
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_room_player(room_id) OR public.rasmalai_is_active_spectator(room_id));

DROP POLICY matches_participant_read ON public.matches;
CREATE POLICY matches_participant_read ON public.matches
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_match_player(id) OR public.rasmalai_is_match_spectator(id));

DROP POLICY match_players_participant_read ON public.match_players;
CREATE POLICY match_players_participant_read ON public.match_players
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_match_player(match_id) OR public.rasmalai_is_match_spectator(match_id));

DROP POLICY game_moves_player_read ON public.game_moves;
CREATE POLICY game_moves_player_read ON public.game_moves
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_room_player(room_id) OR public.rasmalai_is_active_spectator(room_id));

CREATE POLICY spectator_invites_participant_read ON public.spectator_invites
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid() OR (sender_id = auth.uid() AND public.rasmalai_is_room_player(room_id)));

CREATE POLICY spectator_chat_messages_active_spectator_read ON public.spectator_chat_messages
  FOR SELECT TO authenticated USING (public.rasmalai_is_active_spectator(room_id));

CREATE POLICY spectator_chat_reactions_active_spectator_read ON public.spectator_chat_reactions
  FOR SELECT TO authenticated USING (public.rasmalai_is_active_spectator(room_id));

CREATE OR REPLACE FUNCTION public.rasmalai_spectator_count(p_room_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT count(*)::INTEGER FROM public.spectators AS spectator
  WHERE spectator.room_id = p_room_id AND spectator.left_at IS NULL
    AND spectator.disconnected_at IS NULL
    AND spectator.last_seen_at > now() - INTERVAL '90 seconds'
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_spectator_count(p_room_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.rasmalai_is_room_player(p_room_id) OR public.rasmalai_is_active_spectator(p_room_id)
    OR EXISTS (SELECT 1 FROM public.game_rooms WHERE id = p_room_id AND visibility = 'PUBLIC' AND status IN ('IN_PROGRESS', 'COMPLETED'))
  ) THEN RAISE EXCEPTION 'Room access is required' USING ERRCODE = '42501'; END IF;
  RETURN public.rasmalai_spectator_count(p_room_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_list_public_live_rooms()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_rooms JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(
    public.rasmalai_realtime_room_summary(room.id) || jsonb_build_object('spectatorCount', public.rasmalai_spectator_count(room.id))
    ORDER BY room.started_at DESC
  ), '[]'::JSONB) INTO v_rooms
  FROM (
    SELECT game.id, game.started_at FROM public.game_rooms AS game
    WHERE game.visibility = 'PUBLIC' AND game.status = 'IN_PROGRESS'
    ORDER BY game.started_at DESC NULLS LAST LIMIT 50
  ) AS room;
  RETURN v_rooms;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_watch_room(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_can_watch BOOLEAN;
  v_snapshot JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
  IF public.rasmalai_is_room_player(p_room_id) THEN RAISE EXCEPTION 'Players cannot join the spectator channel'; END IF;

  SELECT (v_room.visibility = 'PUBLIC' AND (
      v_room.status = 'IN_PROGRESS' OR EXISTS (
        SELECT 1 FROM public.spectators AS current_watch
        WHERE current_watch.room_id = p_room_id AND current_watch.profile_id = v_user_id
      )
    )) OR (v_room.visibility = 'PRIVATE' AND EXISTS (
      SELECT 1 FROM public.spectator_invites AS invite
      WHERE invite.room_id = p_room_id AND invite.recipient_id = v_user_id AND invite.status = 'ACCEPTED'
    ) AND (v_room.status = 'IN_PROGRESS' OR EXISTS (
      SELECT 1 FROM public.spectators AS current_watch
      WHERE current_watch.room_id = p_room_id AND current_watch.profile_id = v_user_id
    ))) INTO v_can_watch;

  IF NOT COALESCE(v_can_watch, FALSE) OR v_room.status NOT IN ('IN_PROGRESS', 'COMPLETED') THEN
    RAISE EXCEPTION 'A public live match or accepted spectator invitation is required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.spectators (id, room_id, profile_id, joined_at, last_seen_at, disconnected_at, left_at)
  VALUES (gen_random_uuid(), p_room_id, v_user_id, clock_timestamp(), clock_timestamp(), NULL, NULL)
  ON CONFLICT (room_id, profile_id) DO UPDATE
    SET last_seen_at = clock_timestamp(), disconnected_at = NULL, left_at = NULL;

  SELECT public.rasmalai_realtime_room_summary(p_room_id) ||
    jsonb_build_object('spectatorCount', public.rasmalai_spectator_count(p_room_id)) INTO v_snapshot;
  RETURN v_snapshot;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_spectator_invite_info(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'roomId', invite.room_id,
    'inviteId', invite.id,
    'status', CASE WHEN invite.status = 'PENDING' AND invite.expires_at <= now() THEN 'EXPIRED' ELSE invite.status::TEXT END,
    'gameType', room.game_type::TEXT,
    'roomCode', room.room_code,
    'invitedBy', COALESCE(NULLIF(btrim(sender.nickname), ''), sender.username),
    'expiresAt', invite.expires_at
  ) INTO v_result
  FROM public.spectator_invites AS invite
  JOIN public.game_rooms AS room ON room.id = invite.room_id
  JOIN public.profiles AS sender ON sender.id = invite.sender_id
  WHERE invite.room_id = p_room_id AND invite.recipient_id = v_user_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'No spectator invitation is available' USING ERRCODE = '42501'; END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_accept_spectator_invite(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_invite public.spectator_invites%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  IF public.rasmalai_is_room_player(p_room_id) THEN RAISE EXCEPTION 'Players cannot join the spectator channel' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_invite FROM public.spectator_invites
  WHERE room_id = p_room_id AND recipient_id = v_user_id AND status = 'PENDING' AND expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No valid spectator invitation is available' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_rooms WHERE id = p_room_id AND status = 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'This match is no longer in progress';
  END IF;
  UPDATE public.spectator_invites SET status = 'ACCEPTED', updated_at = clock_timestamp() WHERE id = v_invite.id;
  INSERT INTO public.spectators (id, room_id, profile_id, joined_at, last_seen_at, disconnected_at, left_at)
  VALUES (gen_random_uuid(), p_room_id, v_user_id, clock_timestamp(), clock_timestamp(), clock_timestamp(), NULL)
  ON CONFLICT (room_id, profile_id) DO UPDATE SET last_seen_at = clock_timestamp(), disconnected_at = clock_timestamp(), left_at = NULL;
  RETURN public.rasmalai_realtime_watch_room(p_room_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_set_spectator_presence(p_room_id UUID, p_connected BOOLEAN, p_leave BOOLEAN DEFAULT FALSE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  UPDATE public.spectators SET
    last_seen_at = clock_timestamp(),
    disconnected_at = CASE WHEN p_connected AND NOT p_leave THEN NULL ELSE clock_timestamp() END,
    left_at = CASE WHEN p_leave THEN clock_timestamp() ELSE left_at END
  WHERE room_id = p_room_id AND profile_id = auth.uid() AND left_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active spectator access is required' USING ERRCODE = '42501'; END IF;
  RETURN public.rasmalai_spectator_count(p_room_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_invite_spectator(p_room_id UUID, p_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_sender UUID := auth.uid();
  v_recipient UUID;
  v_invite_id UUID;
BEGIN
  IF v_sender IS NULL OR NOT public.rasmalai_is_room_player(p_room_id) THEN
    RAISE EXCEPTION 'Only a match player can invite a spectator' USING ERRCODE = '42501';
  END IF;
  IF p_username !~ '^[A-Za-z0-9_]{3,24}$' THEN RAISE EXCEPTION 'Enter a valid username'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_rooms WHERE id = p_room_id AND visibility = 'PRIVATE' AND status = 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Spectator invitations are available for private live matches';
  END IF;
  SELECT id INTO v_recipient FROM public.profiles WHERE lower(username) = lower(p_username);
  IF v_recipient IS NULL OR v_recipient = v_sender THEN RAISE EXCEPTION 'Choose a different existing player'; END IF;
  IF EXISTS (SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND profile_id = v_recipient) THEN
    RAISE EXCEPTION 'That player is already in this match';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_blocks WHERE (blocker_id = v_sender AND blocked_id = v_recipient)
      OR (blocker_id = v_recipient AND blocked_id = v_sender)) THEN RAISE EXCEPTION 'This player cannot be invited'; END IF;

  INSERT INTO public.spectator_invites (id, room_id, sender_id, recipient_id, status, expires_at, created_at, updated_at)
  VALUES (gen_random_uuid(), p_room_id, v_sender, v_recipient, 'PENDING', clock_timestamp() + INTERVAL '7 days', clock_timestamp(), clock_timestamp())
  ON CONFLICT (room_id, recipient_id) DO UPDATE
    SET sender_id = EXCLUDED.sender_id, status = 'PENDING', expires_at = EXCLUDED.expires_at, updated_at = clock_timestamp()
  RETURNING id INTO v_invite_id;

  INSERT INTO public.notifications (id, recipient_id, actor_id, type, payload, created_at)
  VALUES (gen_random_uuid(), v_recipient, v_sender, 'GAME_INVITE',
    jsonb_build_object('room_id', p_room_id, 'invite_kind', 'SPECTATOR', 'invite_id', v_invite_id), clock_timestamp());
  RETURN jsonb_build_object('inviteId', v_invite_id, 'roomId', p_room_id, 'recipientId', v_recipient);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_list_spectator_invites(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.rasmalai_is_room_player(p_room_id) THEN
    RAISE EXCEPTION 'Only match players can view spectator invitations' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'inviteId', invite.id, 'recipientId', invite.recipient_id,
    'name', COALESCE(NULLIF(btrim(profile.nickname), ''), profile.username),
    'username', profile.username,
    'status', CASE WHEN invite.status = 'PENDING' AND invite.expires_at <= now() THEN 'EXPIRED' ELSE invite.status::TEXT END,
    'expiresAt', invite.expires_at
  ) ORDER BY invite.created_at DESC), '[]'::JSONB) INTO v_result
  FROM public.spectator_invites AS invite JOIN public.profiles AS profile ON profile.id = invite.recipient_id
  WHERE invite.room_id = p_room_id AND invite.status IN ('PENDING', 'ACCEPTED');
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_revoke_spectator_invite(p_room_id UUID, p_invite_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE v_recipient UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.rasmalai_is_room_player(p_room_id) THEN
    RAISE EXCEPTION 'Only match players can revoke spectator access' USING ERRCODE = '42501';
  END IF;
  UPDATE public.spectator_invites SET status = 'CANCELLED', updated_at = clock_timestamp()
  WHERE id = p_invite_id AND room_id = p_room_id AND status IN ('PENDING', 'ACCEPTED')
  RETURNING recipient_id INTO v_recipient;
  IF v_recipient IS NULL THEN RAISE EXCEPTION 'That spectator invitation is no longer active'; END IF;
  UPDATE public.spectators SET left_at = clock_timestamp(), disconnected_at = clock_timestamp(), last_seen_at = clock_timestamp()
  WHERE room_id = p_room_id AND profile_id = v_recipient AND left_at IS NULL;
  RETURN v_recipient;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_spectator_chat_history(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.rasmalai_is_active_spectator(p_room_id) THEN
    RAISE EXCEPTION 'Active spectator access is required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(entry.message ORDER BY entry.created_at), '[]'::JSONB) INTO v_result
  FROM (
    SELECT message.created_at,
      jsonb_build_object(
        'id', message.id, 'roomId', message.room_id, 'authorId', message.author_id,
        'authorName', COALESCE(NULLIF(btrim(profile.nickname), ''), profile.username),
        'body', message.body, 'createdAt', message.created_at,
        'reactions', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('emoji', reaction.emoji, 'count', reaction.count, 'mine', reaction.mine))
          FROM (
            SELECT emoji, count(*)::INTEGER AS count, bool_or(profile_id = auth.uid()) AS mine
            FROM public.spectator_chat_reactions WHERE message_id = message.id GROUP BY emoji
          ) AS reaction
        ), '[]'::JSONB)
      ) AS message
    FROM (
      SELECT * FROM public.spectator_chat_messages WHERE room_id = p_room_id ORDER BY created_at DESC LIMIT 50
    ) AS message JOIN public.profiles AS profile ON profile.id = message.author_id
  ) AS entry;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_send_spectator_chat(p_room_id UUID, p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE v_id UUID; v_user_id UUID := auth.uid(); v_room public.game_rooms%ROWTYPE; v_message JSONB;
BEGIN
  IF v_user_id IS NULL OR NOT public.rasmalai_is_active_spectator(p_room_id) THEN
    RAISE EXCEPTION 'Active spectator access is required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF v_room.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'Spectator chat is closed for this match'; END IF;
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Message length must be 1–500 characters'; END IF;
  INSERT INTO public.spectator_chat_messages (id, room_id, author_id, body, created_at)
  VALUES (gen_random_uuid(), p_room_id, v_user_id, btrim(p_body), clock_timestamp()) RETURNING id INTO v_id;
  SELECT item.value INTO v_message
  FROM jsonb_array_elements(public.rasmalai_realtime_spectator_chat_history(p_room_id)) AS item(value)
  WHERE item.value->>'id' = v_id::TEXT;
  RETURN v_message;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_toggle_spectator_reaction(p_room_id UUID, p_message_id UUID, p_emoji TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.rasmalai_is_active_spectator(p_room_id) THEN
    RAISE EXCEPTION 'Active spectator access is required' USING ERRCODE = '42501';
  END IF;
  IF p_emoji NOT IN ('👍','👏','😂','😮','😢','🎉','❤️','🔥') OR NOT EXISTS (
    SELECT 1 FROM public.spectator_chat_messages WHERE id = p_message_id AND room_id = p_room_id
  ) THEN RAISE EXCEPTION 'That reaction is unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.spectator_chat_reactions WHERE message_id = p_message_id AND profile_id = auth.uid() AND emoji = p_emoji) THEN
    DELETE FROM public.spectator_chat_reactions WHERE message_id = p_message_id AND profile_id = auth.uid() AND emoji = p_emoji;
  ELSE
    INSERT INTO public.spectator_chat_reactions (id, message_id, room_id, profile_id, emoji)
    VALUES (gen_random_uuid(), p_message_id, p_room_id, auth.uid(), p_emoji);
  END IF;
  RETURN public.rasmalai_realtime_spectator_chat_history(p_room_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.rasmalai_spectator_count(UUID) FROM PUBLIC, anon, authenticated, prisma;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_spectator_count(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_list_public_live_rooms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_watch_room(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_spectator_invite_info(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_accept_spectator_invite(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_set_spectator_presence(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_invite_spectator(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_list_spectator_invites(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_revoke_spectator_invite(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_spectator_chat_history(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_send_spectator_chat(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_toggle_spectator_reaction(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_list_public_live_rooms() TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_spectator_count(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_watch_room(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_spectator_invite_info(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_accept_spectator_invite(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_set_spectator_presence(UUID, BOOLEAN, BOOLEAN) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_invite_spectator(UUID, TEXT) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_list_spectator_invites(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_revoke_spectator_invite(UUID, UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_spectator_chat_history(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_send_spectator_chat(UUID, TEXT) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_toggle_spectator_reaction(UUID, UUID, TEXT) TO prisma;

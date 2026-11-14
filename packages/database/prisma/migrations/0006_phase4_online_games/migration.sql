-- Phase 4 online play. This migration is additive: it adds presence/chat
-- storage, enables participant-scoped reads, and exposes narrow server RPCs.
-- Browser roles receive no game-state or chat write permissions.

ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ(6);

CREATE TABLE public.game_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT game_chat_messages_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 500)
);

CREATE INDEX game_chat_messages_room_created_idx
  ON public.game_chat_messages(room_id, created_at DESC);

CREATE TABLE public.game_chat_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.game_chat_messages(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT game_chat_reactions_emoji_check CHECK (emoji IN ('👍','👏','😂','😮','😢','🎉','❤️','🔥')),
  CONSTRAINT game_chat_reactions_unique UNIQUE (message_id, profile_id, emoji)
);

CREATE INDEX game_chat_reactions_room_message_idx
  ON public.game_chat_reactions(room_id, message_id);

ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_chat_reactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.game_rooms, public.room_players, public.spectators,
  public.game_states, public.matches, public.match_players, public.game_moves,
  public.game_invites, public.game_chat_messages, public.game_chat_reactions
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.game_rooms, public.room_players, public.spectators,
  public.game_states, public.matches, public.match_players, public.game_moves,
  public.game_invites, public.game_chat_messages, public.game_chat_reactions
  TO authenticated;

CREATE OR REPLACE FUNCTION public.rasmalai_is_room_player(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.room_players AS player
    WHERE player.room_id = p_room_id AND player.profile_id = auth.uid()
  )
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_is_match_player(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.match_players AS player
    WHERE player.match_id = p_match_id AND player.profile_id = auth.uid()
  )
$function$;

REVOKE ALL ON FUNCTION public.rasmalai_is_room_player(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rasmalai_is_match_player(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rasmalai_is_room_player(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_is_match_player(UUID) TO authenticated;

CREATE POLICY game_rooms_public_lobby_or_player_read ON public.game_rooms
  FOR SELECT TO authenticated
  USING ((visibility = 'PUBLIC' AND status = 'WAITING') OR public.rasmalai_is_room_player(id));

CREATE POLICY room_players_participant_read ON public.room_players
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.rasmalai_is_room_player(room_id));

CREATE POLICY spectators_owner_read ON public.spectators
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY game_states_player_read ON public.game_states
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_room_player(room_id));

CREATE POLICY matches_participant_read ON public.matches
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_match_player(id));

CREATE POLICY match_players_participant_read ON public.match_players
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_match_player(match_id));

CREATE POLICY game_moves_player_read ON public.game_moves
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_room_player(room_id));

CREATE POLICY game_invites_participant_read ON public.game_invites
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

CREATE POLICY game_chat_messages_player_read ON public.game_chat_messages
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_room_player(room_id));

CREATE POLICY game_chat_reactions_player_read ON public.game_chat_reactions
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_room_player(room_id));

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_room_summary(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_room public.game_rooms%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'roomId', v_room.id,
    'roomCode', v_room.room_code,
    'gameType', v_room.game_type::TEXT,
    'visibility', v_room.visibility::TEXT,
    'status', v_room.status::TEXT,
    'creatorId', v_room.creator_id,
    'maxPlayers', v_room.max_players,
    'createdAt', v_room.created_at,
    'startedAt', v_room.started_at,
    'completedAt', v_room.completed_at,
    'matchId', (SELECT match.id FROM public.matches AS match WHERE match.room_id = v_room.id),
    'version', (SELECT state.version FROM public.game_states AS state WHERE state.room_id = v_room.id),
    'state', (SELECT state.state FROM public.game_states AS state WHERE state.room_id = v_room.id),
    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'profileId', player.profile_id,
        'seatIndex', player.seat_index,
        'name', COALESCE(NULLIF(btrim(profile.nickname), ''), profile.username),
        'avatarUrl', profile.avatar_url,
        'connected', player.disconnected_at IS NULL,
        'lastSeenAt', player.last_seen_at
      ) ORDER BY player.seat_index)
      FROM public.room_players AS player
      JOIN public.profiles AS profile ON profile.id = player.profile_id
      WHERE player.room_id = v_room.id
    ), '[]'::JSONB)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_list_public_rooms()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_rooms JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(public.rasmalai_realtime_room_summary(room.id) ORDER BY room.created_at DESC), '[]'::JSONB)
    INTO v_rooms
  FROM (
    SELECT game.id, game.created_at
    FROM public.game_rooms AS game
    WHERE game.visibility = 'PUBLIC' AND game.status = 'WAITING'
      AND (SELECT count(*) FROM public.room_players AS player WHERE player.room_id = game.id) < game.max_players
    ORDER BY game.created_at DESC
    LIMIT 50
  ) AS room;
  RETURN v_rooms;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_create_room(
  p_game_type public."GameType",
  p_visibility public."RoomVisibility",
  p_max_players INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_room_id UUID := gen_random_uuid();
  v_room_code TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'Complete profile setup before creating a room' USING ERRCODE = '42501';
  END IF;
  IF (p_game_type = 'LUDO' AND p_max_players <> 4)
    OR (p_game_type = 'TIC_TAC_TOE' AND p_max_players <> 2)
    OR (p_game_type = 'SNAKES_AND_LADDERS' AND p_max_players NOT BETWEEN 2 AND 4) THEN
    RAISE EXCEPTION 'Player count does not match this game' USING ERRCODE = '22023';
  END IF;
  IF p_visibility NOT IN ('PUBLIC', 'PRIVATE') THEN
    RAISE EXCEPTION 'Choose public or private visibility' USING ERRCODE = '22023';
  END IF;

  LOOP
    v_room_code := upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.game_rooms WHERE room_code = v_room_code);
  END LOOP;

  INSERT INTO public.game_rooms (id, room_code, game_type, visibility, status, creator_id, max_players)
  VALUES (v_room_id, v_room_code, p_game_type, p_visibility, 'WAITING', v_user_id, p_max_players);
  INSERT INTO public.room_players (id, room_id, profile_id, seat_index)
  VALUES (gen_random_uuid(), v_room_id, v_user_id, 0);
  RETURN public.rasmalai_realtime_room_summary(v_room_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_invite_player(p_room_id UUID, p_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_recipient_id UUID;
  v_invite_id UUID;
  v_invite public.game_invites%ROWTYPE;
  v_occupied INTEGER;
  v_reserved INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.creator_id <> v_user_id OR v_room.visibility <> 'PRIVATE' OR v_room.status <> 'WAITING' THEN
    RAISE EXCEPTION 'Only the room creator can invite players to a waiting private room' USING ERRCODE = '42501';
  END IF;
  IF p_username IS NULL OR lower(btrim(p_username)) !~ '^[a-z0-9_]{3,24}$' THEN
    RAISE EXCEPTION 'Enter a valid player username' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_recipient_id FROM public.profiles WHERE lower(username) = lower(btrim(p_username));
  IF v_recipient_id IS NULL OR v_recipient_id = v_user_id THEN
    RAISE EXCEPTION 'Player not found' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND profile_id = v_recipient_id) THEN
    RAISE EXCEPTION 'That player already joined this room' USING ERRCODE = '23505';
  END IF;
  SELECT count(*) INTO v_occupied FROM public.room_players WHERE room_id = p_room_id;
  SELECT count(*) INTO v_reserved FROM public.game_invites WHERE room_id = p_room_id AND status = 'PENDING' AND expires_at > clock_timestamp();
  IF v_occupied + v_reserved >= v_room.max_players THEN
    RAISE EXCEPTION 'This room has no open seats' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_invite FROM public.game_invites
  WHERE room_id = p_room_id AND recipient_id = v_recipient_id AND status = 'PENDING' AND expires_at > clock_timestamp()
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    v_invite_id := v_invite.id;
  ELSE
    v_invite_id := gen_random_uuid();
    INSERT INTO public.game_invites (id, room_id, sender_id, recipient_id, status, expires_at)
    VALUES (v_invite_id, p_room_id, v_user_id, v_recipient_id, 'PENDING', clock_timestamp() + INTERVAL '24 hours');
    INSERT INTO public.notifications (id, recipient_id, actor_id, type, payload)
    VALUES (gen_random_uuid(), v_recipient_id, v_user_id, 'GAME_INVITE', jsonb_build_object('room_id', p_room_id, 'game_type', v_room.game_type::TEXT));
  END IF;
  RETURN jsonb_build_object('inviteId', v_invite_id, 'roomId', p_room_id, 'recipientId', v_recipient_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_join_room(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_count INTEGER;
  v_seat INTEGER;
  v_match_id UUID;
  v_invite_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002'; END IF;

  IF EXISTS (SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND profile_id = v_user_id) THEN
    UPDATE public.room_players SET last_seen_at = clock_timestamp(), disconnected_at = NULL
      WHERE room_id = p_room_id AND profile_id = v_user_id;
    RETURN public.rasmalai_realtime_room_summary(p_room_id);
  END IF;
  IF v_room.status <> 'WAITING' THEN RAISE EXCEPTION 'This match has already started' USING ERRCODE = '42501'; END IF;

  IF v_room.visibility = 'PRIVATE' THEN
    SELECT id INTO v_invite_id FROM public.game_invites
    WHERE room_id = p_room_id AND recipient_id = v_user_id AND status = 'PENDING' AND expires_at > clock_timestamp()
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF v_invite_id IS NULL THEN RAISE EXCEPTION 'A valid invitation is required for this private room' USING ERRCODE = '42501'; END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.room_players WHERE room_id = p_room_id;
  IF v_count >= v_room.max_players THEN RAISE EXCEPTION 'This room is full' USING ERRCODE = '23505'; END IF;
  v_seat := v_count;
  INSERT INTO public.room_players (id, room_id, profile_id, seat_index)
  VALUES (gen_random_uuid(), p_room_id, v_user_id, v_seat);
  UPDATE public.room_players SET last_seen_at = clock_timestamp(), disconnected_at = NULL
    WHERE room_id = p_room_id AND profile_id = v_user_id;
  IF v_invite_id IS NOT NULL THEN
    UPDATE public.game_invites SET status = 'ACCEPTED' WHERE id = v_invite_id;
    UPDATE public.notifications SET read_at = clock_timestamp()
      WHERE recipient_id = v_user_id AND type = 'GAME_INVITE' AND read_at IS NULL
        AND payload ->> 'room_id' = p_room_id::TEXT;
  END IF;

  IF v_count + 1 = v_room.max_players THEN
    v_match_id := gen_random_uuid();
    UPDATE public.game_rooms SET status = 'IN_PROGRESS', started_at = clock_timestamp()
      WHERE id = p_room_id;
    INSERT INTO public.matches (id, room_id, game_type, status, started_at)
    VALUES (v_match_id, p_room_id, v_room.game_type, 'IN_PROGRESS', clock_timestamp());
    INSERT INTO public.match_players (id, match_id, profile_id, seat_index)
    SELECT gen_random_uuid(), v_match_id, profile_id, seat_index
    FROM public.room_players WHERE room_id = p_room_id;
  END IF;
  RETURN public.rasmalai_realtime_room_summary(p_room_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_load_room(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.rasmalai_is_room_player(p_room_id) THEN
    RAISE EXCEPTION 'Room membership required' USING ERRCODE = '42501';
  END IF;
  RETURN public.rasmalai_realtime_room_summary(p_room_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_initialize_match(p_room_id UUID, p_state JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_player_count INTEGER;
BEGIN
  IF v_user_id IS NULL OR NOT public.rasmalai_is_room_player(p_room_id) THEN
    RAISE EXCEPTION 'Room membership required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.status <> 'IN_PROGRESS' OR NOT EXISTS (SELECT 1 FROM public.matches WHERE room_id = p_room_id AND status = 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'The room is not ready to start' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_player_count FROM public.room_players WHERE room_id = p_room_id;
  IF jsonb_typeof(p_state) <> 'object' OR jsonb_typeof(p_state -> 'players') <> 'array'
    OR jsonb_array_length(p_state -> 'players') <> v_player_count OR p_state ->> 'turnIndex' <> '0' THEN
    RAISE EXCEPTION 'Invalid initial game state' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.game_states (room_id, version, state, updated_at)
  VALUES (p_room_id, 0, p_state, clock_timestamp())
  ON CONFLICT (room_id) DO NOTHING;
  RETURN public.rasmalai_realtime_room_summary(p_room_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_persist_action(
  p_room_id UUID,
  p_expected_version INTEGER,
  p_action_id TEXT,
  p_action JSONB,
  p_state JSONB,
  p_finished BOOLEAN,
  p_winner_seat INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_match_id UUID;
  v_version INTEGER;
  v_current_state JSONB;
  v_turn_index INTEGER;
  v_current_player UUID;
  v_player_count INTEGER;
  v_winner_id UUID;
  v_state_winner INTEGER;
  v_is_draw BOOLEAN;
  v_idempotency_key TEXT;
  v_existing_actor UUID;
BEGIN
  IF v_user_id IS NULL OR NOT public.rasmalai_is_room_player(p_room_id) THEN
    RAISE EXCEPTION 'Room membership required' USING ERRCODE = '42501';
  END IF;
  IF p_action_id IS NULL OR p_action_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_action) <> 'object' OR jsonb_typeof(p_state) <> 'object' THEN
    RAISE EXCEPTION 'Invalid game action' USING ERRCODE = '22023';
  END IF;
  v_idempotency_key := p_room_id::TEXT || ':' || p_action_id;
  SELECT actor_id INTO v_existing_actor FROM public.game_moves WHERE idempotency_key = v_idempotency_key;
  IF FOUND THEN
    IF v_existing_actor <> v_user_id THEN RAISE EXCEPTION 'Action identifier is already used' USING ERRCODE = '23505'; END IF;
    RETURN public.rasmalai_realtime_room_summary(p_room_id);
  END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'This match is not accepting moves' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_match_id FROM public.matches WHERE room_id = p_room_id AND status = 'IN_PROGRESS' FOR UPDATE;
  IF v_match_id IS NULL THEN RAISE EXCEPTION 'Active match not found' USING ERRCODE = '42501'; END IF;
  SELECT version, state INTO v_version, v_current_state FROM public.game_states WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game state is not initialized' USING ERRCODE = '42501'; END IF;
  IF v_version <> p_expected_version THEN RAISE EXCEPTION 'Game state changed; reload and try again' USING ERRCODE = '40001'; END IF;

  BEGIN
    v_turn_index := (v_current_state ->> 'turnIndex')::INTEGER;
    v_state_winner := NULLIF(p_state ->> 'winnerIndex', '')::INTEGER;
    v_is_draw := COALESCE((p_state ->> 'isDraw')::BOOLEAN, FALSE);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid game state' USING ERRCODE = '22023';
  END;
  SELECT count(*) INTO v_player_count FROM public.room_players WHERE room_id = p_room_id;
  IF v_turn_index < 0 OR v_turn_index >= v_player_count OR p_state ->> 'turnIndex' !~ '^[0-3]$' THEN
    RAISE EXCEPTION 'Invalid turn state' USING ERRCODE = '22023';
  END IF;
  SELECT profile_id INTO v_current_player FROM public.room_players
    WHERE room_id = p_room_id AND seat_index = v_turn_index;
  IF v_current_player <> v_user_id THEN RAISE EXCEPTION 'It is another player’s turn' USING ERRCODE = '42501'; END IF;
  IF p_finished <> (v_state_winner IS NOT NULL OR v_is_draw) THEN
    RAISE EXCEPTION 'Match result does not match the game state' USING ERRCODE = '22023';
  END IF;
  IF p_winner_seat IS DISTINCT FROM v_state_winner OR (v_is_draw AND p_winner_seat IS NOT NULL) THEN
    RAISE EXCEPTION 'Winner does not match the game state' USING ERRCODE = '22023';
  END IF;
  IF p_winner_seat IS NOT NULL THEN
    SELECT profile_id INTO v_winner_id FROM public.room_players
      WHERE room_id = p_room_id AND seat_index = p_winner_seat;
    IF v_winner_id IS NULL THEN RAISE EXCEPTION 'Winner seat is invalid' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO public.game_moves (id, room_id, match_id, actor_id, sequence, idempotency_key, action)
  VALUES (gen_random_uuid(), p_room_id, v_match_id, v_user_id, v_version + 1, v_idempotency_key, p_action);
  UPDATE public.game_states SET version = v_version + 1, state = p_state, updated_at = clock_timestamp()
    WHERE room_id = p_room_id;

  IF p_finished THEN
    UPDATE public.matches SET status = 'COMPLETED', winner_id = v_winner_id,
      final_state = p_state, completed_at = clock_timestamp()
      WHERE id = v_match_id AND status = 'IN_PROGRESS';
    UPDATE public.game_rooms SET status = 'COMPLETED', completed_at = clock_timestamp()
      WHERE id = p_room_id AND status = 'IN_PROGRESS';
    UPDATE public.match_players SET did_win = (profile_id = v_winner_id)
      WHERE match_id = v_match_id;
    UPDATE public.profiles AS profile
      SET games_played = profile.games_played + 1,
          wins = profile.wins + CASE WHEN player.did_win THEN 1 ELSE 0 END
      FROM public.match_players AS player
      WHERE player.match_id = v_match_id AND profile.id = player.profile_id;
    INSERT INTO public.notifications (id, recipient_id, actor_id, type, payload)
      SELECT gen_random_uuid(), player.profile_id, v_user_id, 'MATCH_RESULT',
        jsonb_build_object('room_id', p_room_id, 'match_id', v_match_id, 'winner_id', v_winner_id, 'is_draw', v_is_draw)
      FROM public.match_players AS player WHERE player.match_id = v_match_id;
  END IF;
  RETURN public.rasmalai_realtime_room_summary(p_room_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_set_presence(p_room_id UUID, p_connected BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_connected IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  UPDATE public.room_players SET last_seen_at = clock_timestamp(),
    disconnected_at = CASE WHEN p_connected THEN NULL ELSE clock_timestamp() END
    WHERE room_id = p_room_id AND profile_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room membership required' USING ERRCODE = '42501'; END IF;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_send_chat(p_room_id UUID, p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_message_id UUID;
  v_body TEXT := btrim(p_body);
  v_name TEXT;
BEGIN
  IF v_user_id IS NULL OR NOT public.rasmalai_is_room_player(p_room_id) THEN
    RAISE EXCEPTION 'Room membership required' USING ERRCODE = '42501';
  END IF;
  IF v_body IS NULL OR length(v_body) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Chat messages must contain 1 to 500 characters' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF v_room.status NOT IN ('WAITING', 'IN_PROGRESS') THEN RAISE EXCEPTION 'Room chat is closed' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(NULLIF(btrim(nickname), ''), username) INTO v_name FROM public.profiles WHERE id = v_user_id;
  INSERT INTO public.game_chat_messages (id, room_id, author_id, body)
    VALUES (gen_random_uuid(), p_room_id, v_user_id, v_body) RETURNING id INTO v_message_id;
  RETURN jsonb_build_object('id', v_message_id, 'roomId', p_room_id, 'authorId', v_user_id,
    'authorName', v_name, 'body', v_body, 'createdAt', clock_timestamp());
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_chat_history(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_messages JSONB;
BEGIN
  IF v_user_id IS NULL OR NOT public.rasmalai_is_room_player(p_room_id) THEN
    RAISE EXCEPTION 'Room membership required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', recent.id, 'roomId', recent.room_id, 'authorId', recent.author_id,
    'authorName', COALESCE(NULLIF(btrim(profile.nickname), ''), profile.username),
    'body', recent.body, 'createdAt', recent.created_at,
    'reactions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('emoji', grouped.emoji, 'count', grouped.reaction_count, 'mine', grouped.mine))
      FROM (
        SELECT reaction.emoji, count(*) AS reaction_count, bool_or(reaction.profile_id = v_user_id) AS mine
        FROM public.game_chat_reactions AS reaction
        WHERE reaction.message_id = recent.id
        GROUP BY reaction.emoji
      ) AS grouped
    ), '[]'::JSONB)
  ) ORDER BY recent.created_at), '[]'::JSONB)
    INTO v_messages
  FROM (
    SELECT message.id, message.room_id, message.author_id, message.body, message.created_at
    FROM public.game_chat_messages AS message
    WHERE message.room_id = p_room_id
    ORDER BY message.created_at DESC
    LIMIT 50
  ) AS recent
  JOIN public.profiles AS profile ON profile.id = recent.author_id;
  RETURN v_messages;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_toggle_reaction(p_room_id UUID, p_message_id UUID, p_emoji TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT public.rasmalai_is_room_player(p_room_id) THEN
    RAISE EXCEPTION 'Room membership required' USING ERRCODE = '42501';
  END IF;
  IF p_emoji NOT IN ('👍','👏','😂','😮','😢','🎉','❤️','🔥') OR NOT EXISTS (
    SELECT 1 FROM public.game_chat_messages WHERE id = p_message_id AND room_id = p_room_id
  ) THEN
    RAISE EXCEPTION 'That reaction is not available' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.game_chat_reactions
    WHERE message_id = p_message_id AND profile_id = v_user_id AND emoji = p_emoji;
  IF NOT FOUND THEN
    INSERT INTO public.game_chat_reactions (id, message_id, room_id, profile_id, emoji)
    VALUES (gen_random_uuid(), p_message_id, p_room_id, v_user_id, p_emoji);
  END IF;
  RETURN public.rasmalai_realtime_chat_history(p_room_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.rasmalai_realtime_room_summary(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_list_public_rooms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_create_room(public."GameType", public."RoomVisibility", INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_invite_player(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_join_room(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_load_room(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_initialize_match(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_persist_action(UUID, INTEGER, TEXT, JSONB, JSONB, BOOLEAN, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_set_presence(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_send_chat(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_chat_history(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_realtime_toggle_reaction(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_list_public_rooms() TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_create_room(public."GameType", public."RoomVisibility", INTEGER) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_invite_player(UUID, TEXT) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_join_room(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_load_room(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_initialize_match(UUID, JSONB) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_persist_action(UUID, INTEGER, TEXT, JSONB, JSONB, BOOLEAN, INTEGER) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_set_presence(UUID, BOOLEAN) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_send_chat(UUID, TEXT) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_chat_history(UUID) TO prisma;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_toggle_reaction(UUID, UUID, TEXT) TO prisma;

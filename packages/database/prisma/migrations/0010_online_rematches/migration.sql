-- Online rematches are additive. Each round gets a new match row so completed
-- results, moves, history, statistics, and notifications remain immutable.

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_room_id_key;
DROP INDEX IF EXISTS public.matches_room_id_key;

ALTER TABLE public.matches
  ADD COLUMN starting_seat INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT matches_starting_seat_check CHECK (starting_seat BETWEEN 0 AND 3);

CREATE INDEX matches_room_id_started_at_idx
  ON public.matches(room_id, started_at);
CREATE UNIQUE INDEX matches_one_in_progress_per_room
  ON public.matches(room_id) WHERE status = 'IN_PROGRESS';

CREATE TYPE public."RematchStatus" AS ENUM ('PENDING', 'DECLINED', 'STARTED');

CREATE TABLE public.rematch_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  previous_match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
  status public."RematchStatus" NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX rematch_requests_room_id_created_at_idx
  ON public.rematch_requests(room_id, created_at DESC);
CREATE INDEX rematch_requests_previous_match_id_status_created_at_idx
  ON public.rematch_requests(previous_match_id, status, created_at DESC);
CREATE UNIQUE INDEX rematch_requests_one_pending_per_match
  ON public.rematch_requests(previous_match_id) WHERE status = 'PENDING';

CREATE TABLE public.rematch_votes (
  request_id UUID NOT NULL REFERENCES public.rematch_requests(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  accepted BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (request_id, generation, profile_id)
);
CREATE INDEX rematch_votes_profile_id_created_at_idx
  ON public.rematch_votes(profile_id, created_at DESC);

ALTER TABLE public.rematch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rematch_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rematch_requests, public.rematch_votes
  FROM PUBLIC, anon, authenticated, prisma;

-- Extend the shared PostgreSQL buckets. Existing buckets and counters remain intact.
ALTER TABLE public.rasmalai_rate_limit_buckets
  DROP CONSTRAINT rasmalai_rate_limit_action_key_check;
ALTER TABLE public.rasmalai_rate_limit_buckets
  ADD CONSTRAINT rasmalai_rate_limit_action_key_check CHECK (action_key IN (
    'room_create', 'room_join', 'game_action', 'player_chat_send', 'player_chat_react',
    'match_reaction', 'room_invite', 'spectator_join', 'spectator_accept',
    'spectator_invite', 'spectator_chat_send', 'spectator_chat_react',
    'voice_join', 'voice_signal', 'room_list', 'spectator_list',
    'friend_request', 'message_request', 'direct_message_send',
    'rematch_request', 'rematch_response'
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
    ('rematch_response', 12, 60)
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

-- This private helper is reached only from the verified, room-locked rematch RPC.
CREATE OR REPLACE FUNCTION public.rasmalai_start_rematch_if_ready(
  p_room_id UUID,
  p_request_id UUID,
  p_generation INTEGER,
  p_initial_state JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_room public.game_rooms%ROWTYPE;
  v_old_match public.matches%ROWTYPE;
  v_new_match_id UUID := gen_random_uuid();
  v_player_count INTEGER;
  v_next_seat INTEGER;
  v_accepted_count INTEGER;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  SELECT match.* INTO v_old_match
    FROM public.matches AS match
    JOIN public.rematch_requests AS request ON request.previous_match_id = match.id
    WHERE request.id = p_request_id AND request.room_id = p_room_id
      AND request.generation = p_generation AND request.status = 'PENDING'
    FOR UPDATE OF match;
  IF NOT FOUND OR v_room.status <> 'COMPLETED' OR v_old_match.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'A completed match is required for a rematch' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.matches AS newer
    WHERE newer.room_id = p_room_id AND newer.status IN ('IN_PROGRESS', 'COMPLETED')
      AND (newer.started_at, newer.id) > (v_old_match.started_at, v_old_match.id)
  ) THEN
    RAISE EXCEPTION 'This is no longer the latest completed match' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_player_count FROM public.room_players WHERE room_id = p_room_id;
  IF v_player_count <> v_room.max_players OR v_player_count < 2
    OR (v_room.game_type = 'TIC_TAC_TOE' AND v_player_count <> 2)
    OR (v_room.game_type = 'LUDO' AND v_player_count <> 4)
    OR (v_room.game_type = 'SNAKES_AND_LADDERS' AND v_player_count NOT BETWEEN 2 AND 4)
    OR (SELECT count(*) FROM public.match_players WHERE match_id = v_old_match.id) <> v_player_count
    OR EXISTS (
      SELECT profile_id, seat_index FROM public.room_players WHERE room_id = p_room_id
      EXCEPT
      SELECT profile_id, seat_index FROM public.match_players WHERE match_id = v_old_match.id
    )
    OR EXISTS (
      SELECT profile_id, seat_index FROM public.match_players WHERE match_id = v_old_match.id
      EXCEPT
      SELECT profile_id, seat_index FROM public.room_players WHERE room_id = p_room_id
    ) THEN
    RAISE EXCEPTION 'The original player roster is no longer valid' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_accepted_count
    FROM public.rematch_votes AS vote
    JOIN public.match_players AS player
      ON player.match_id = v_old_match.id AND player.profile_id = vote.profile_id
    WHERE vote.request_id = p_request_id AND vote.generation = p_generation AND vote.accepted;
  IF v_accepted_count <> v_player_count THEN
    RETURN;
  END IF;

  v_next_seat := (v_old_match.starting_seat + 1) % v_player_count;
  IF p_initial_state IS NULL
    OR jsonb_typeof(p_initial_state) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_initial_state -> 'players') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_initial_state -> 'players') <> v_player_count
    OR p_initial_state ->> 'turnIndex' IS DISTINCT FROM v_next_seat::TEXT
    OR p_initial_state -> 'winnerIndex' IS DISTINCT FROM 'null'::JSONB THEN
    RAISE EXCEPTION 'Invalid rematch initial state' USING ERRCODE = '22023';
  END IF;

  IF v_room.game_type = 'TIC_TAC_TOE' THEN
    IF p_initial_state ->> 'xPlayerIndex' IS DISTINCT FROM v_next_seat::TEXT
      OR p_initial_state -> 'isDraw' IS DISTINCT FROM 'false'::JSONB
      OR p_initial_state -> 'board' IS DISTINCT FROM '[null,null,null,null,null,null,null,null,null]'::JSONB THEN
      RAISE EXCEPTION 'Invalid Tic Tac Toe rematch state' USING ERRCODE = '22023';
    END IF;
  ELSIF v_room.game_type = 'LUDO' THEN
    IF p_initial_state -> 'pendingRoll' IS DISTINCT FROM 'null'::JSONB
      OR p_initial_state -> 'message' IS NULL
      OR p_initial_state -> 'winnerIndex' IS DISTINCT FROM 'null'::JSONB
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_initial_state -> 'players') AS player
        WHERE jsonb_typeof(player -> 'tokens') <> 'array'
          OR player -> 'tokens' IS DISTINCT FROM '[-1,-1,-1,-1]'::JSONB
      ) THEN
      RAISE EXCEPTION 'Invalid Ludo rematch state' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_initial_state -> 'lastMove' IS DISTINCT FROM 'null'::JSONB
      OR p_initial_state -> 'winnerIndex' IS DISTINCT FROM 'null'::JSONB
      OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_initial_state -> 'players') AS player
      WHERE player ->> 'position' IS DISTINCT FROM '0'
    ) THEN
      RAISE EXCEPTION 'Invalid Snakes and Ladders rematch state' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.matches (id, room_id, game_type, status, starting_seat, started_at)
    VALUES (v_new_match_id, p_room_id, v_room.game_type, 'IN_PROGRESS', v_next_seat, clock_timestamp());
  INSERT INTO public.match_players (id, match_id, profile_id, seat_index, did_win, score)
    SELECT gen_random_uuid(), v_new_match_id, profile_id, seat_index, false, 0
    FROM public.room_players WHERE room_id = p_room_id ORDER BY seat_index;
  UPDATE public.game_rooms SET status = 'IN_PROGRESS', started_at = clock_timestamp(), completed_at = NULL
    WHERE id = p_room_id;
  UPDATE public.game_states SET version = version + 1, state = p_initial_state, updated_at = clock_timestamp()
    WHERE room_id = p_room_id;
  IF NOT FOUND THEN
    INSERT INTO public.game_states (room_id, version, state, updated_at)
      VALUES (p_room_id, 0, p_initial_state, clock_timestamp());
  END IF;
  UPDATE public.rematch_requests SET status = 'STARTED', updated_at = clock_timestamp()
    WHERE id = p_request_id AND generation = p_generation;
END;
$function$;
REVOKE ALL ON FUNCTION public.rasmalai_start_rematch_if_ready(UUID, UUID, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated, prisma;

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_room_summary(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_room public.game_rooms%ROWTYPE;
  v_latest_match public.matches%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT match.* INTO v_latest_match FROM public.matches AS match
    WHERE match.room_id = v_room.id ORDER BY match.started_at DESC, match.id DESC LIMIT 1;

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
    'matchId', v_latest_match.id,
    'startingSeat', v_latest_match.starting_seat,
    'rematch', CASE WHEN v_latest_match.status = 'COMPLETED' THEN (
      SELECT jsonb_build_object(
        'requestId', request.id,
        'previousMatchId', request.previous_match_id,
        'requesterId', request.requester_id,
        'status', request.status::TEXT,
        'acceptedPlayerIds', COALESCE((
          SELECT jsonb_agg(vote.profile_id ORDER BY player.seat_index)
          FROM public.rematch_votes AS vote
          JOIN public.match_players AS player
            ON player.match_id = v_latest_match.id AND player.profile_id = vote.profile_id
          WHERE vote.request_id = request.id AND vote.generation = request.generation AND vote.accepted
        ), '[]'::JSONB),
        'requiredPlayers', (SELECT count(*) FROM public.match_players WHERE match_id = v_latest_match.id)
      )
      FROM public.rematch_requests AS request
      WHERE request.previous_match_id = v_latest_match.id AND request.status IN ('PENDING', 'DECLINED')
      ORDER BY request.created_at DESC, request.id DESC LIMIT 1
    ) ELSE NULL END,
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

CREATE OR REPLACE FUNCTION public.rasmalai_realtime_rematch_action(
  p_room_id UUID,
  p_action TEXT,
  p_request_id UUID DEFAULT NULL,
  p_accept BOOLEAN DEFAULT NULL,
  p_initial_state JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.game_rooms%ROWTYPE;
  v_match public.matches%ROWTYPE;
  v_request public.rematch_requests%ROWTYPE;
  v_status public."RematchStatus";
  v_request_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('request', 'respond') THEN RAISE EXCEPTION 'Invalid rematch action' USING ERRCODE = '22023'; END IF;
  IF p_action = 'respond' AND p_accept IS NULL THEN RAISE EXCEPTION 'Choose accept or decline' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND profile_id = v_user_id
  ) THEN RAISE EXCEPTION 'Room membership required' USING ERRCODE = '42501'; END IF;

  -- Repeated delivery after a successful start is idempotent and returns the
  -- active snapshot without touching the new round.
  IF p_action = 'respond' AND p_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.rematch_requests WHERE id = p_request_id AND room_id = p_room_id FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.match_players WHERE match_id = v_request.previous_match_id AND profile_id = v_user_id
    ) THEN RAISE EXCEPTION 'A valid rematch request and match membership are required' USING ERRCODE = '42501'; END IF;
    IF v_request.status = 'STARTED' THEN
      RETURN jsonb_build_object('room', public.rasmalai_realtime_room_summary(p_room_id), 'status', 'STARTED');
    END IF;
  END IF;

  IF v_room.status <> 'COMPLETED' THEN RAISE EXCEPTION 'A completed match is required for a rematch' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_match FROM public.matches WHERE room_id = p_room_id AND status = 'COMPLETED'
    ORDER BY started_at DESC, id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.match_players WHERE match_id = v_match.id AND profile_id = v_user_id
  ) THEN RAISE EXCEPTION 'Completed match membership is required' USING ERRCODE = '42501'; END IF;

  IF p_action = 'request' THEN
    SELECT * INTO v_request FROM public.rematch_requests
      WHERE previous_match_id = v_match.id AND status IN ('PENDING', 'DECLINED')
      ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.rematch_requests (room_id, previous_match_id, requester_id)
        VALUES (p_room_id, v_match.id, v_user_id) RETURNING * INTO v_request;
    ELSIF v_request.status = 'DECLINED' THEN
      INSERT INTO public.rematch_requests (room_id, previous_match_id, requester_id, generation)
        VALUES (p_room_id, v_match.id, v_user_id, v_request.generation + 1) RETURNING * INTO v_request;
    ELSIF v_request.status = 'STARTED' THEN
      RAISE EXCEPTION 'This rematch has already started' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.rematch_votes (request_id, generation, profile_id, accepted)
      VALUES (v_request.id, v_request.generation, v_user_id, true)
      ON CONFLICT (request_id, generation, profile_id) DO UPDATE
        SET accepted = true, updated_at = clock_timestamp();
  ELSE
    IF v_request.id IS NULL OR v_request.previous_match_id <> v_match.id OR v_request.status <> 'PENDING' THEN
      RAISE EXCEPTION 'This rematch request is no longer pending' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.rematch_votes (request_id, generation, profile_id, accepted)
      VALUES (v_request.id, v_request.generation, v_user_id, p_accept)
      ON CONFLICT (request_id, generation, profile_id) DO UPDATE
        SET accepted = EXCLUDED.accepted, updated_at = clock_timestamp();
    IF NOT p_accept THEN
      UPDATE public.rematch_requests SET status = 'DECLINED', updated_at = clock_timestamp()
        WHERE id = v_request.id AND generation = v_request.generation;
    END IF;
  END IF;

  SELECT * INTO v_request FROM public.rematch_requests WHERE id = v_request.id;
  v_status := v_request.status;
  IF v_status = 'PENDING' THEN
    IF (SELECT count(*) FROM public.rematch_votes AS vote
        JOIN public.match_players AS player
          ON player.match_id = v_match.id AND player.profile_id = vote.profile_id
        WHERE vote.request_id = v_request.id AND vote.generation = v_request.generation AND vote.accepted)
       = (SELECT count(*) FROM public.match_players WHERE match_id = v_match.id) THEN
      PERFORM public.rasmalai_start_rematch_if_ready(p_room_id, v_request.id, v_request.generation, p_initial_state);
    END IF;
    SELECT status INTO v_status FROM public.rematch_requests WHERE id = v_request.id;
  END IF;

  RETURN jsonb_build_object(
    'room', public.rasmalai_realtime_room_summary(p_room_id),
    'status', v_status::TEXT
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rasmalai_realtime_rematch_action(UUID, TEXT, UUID, BOOLEAN, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rasmalai_realtime_rematch_action(UUID, TEXT, UUID, BOOLEAN, JSONB) TO prisma;

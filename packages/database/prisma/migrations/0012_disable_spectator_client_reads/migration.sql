-- Launch hardening: retain all spectator data and server-only RPCs, but do not
-- allow authenticated clients to read game state through the Supabase Data API
-- merely because they have a spectator roster row. The realtime service remains
-- the only route that can deliver a spectator view when its server flag is on.
BEGIN;

DROP POLICY IF EXISTS game_rooms_public_lobby_or_player_read ON public.game_rooms;
CREATE POLICY game_rooms_public_lobby_or_player_read ON public.game_rooms
  FOR SELECT TO authenticated
  USING ((visibility = 'PUBLIC' AND status = 'WAITING') OR public.rasmalai_is_room_player(id));

DROP POLICY IF EXISTS room_players_participant_read ON public.room_players;
CREATE POLICY room_players_participant_read ON public.room_players
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.rasmalai_is_room_player(room_id));

DROP POLICY IF EXISTS game_states_player_read ON public.game_states;
CREATE POLICY game_states_player_read ON public.game_states
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_room_player(room_id));

DROP POLICY IF EXISTS matches_participant_read ON public.matches;
CREATE POLICY matches_participant_read ON public.matches
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_match_player(id));

DROP POLICY IF EXISTS match_players_participant_read ON public.match_players;
CREATE POLICY match_players_participant_read ON public.match_players
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_match_player(match_id));

DROP POLICY IF EXISTS game_moves_player_read ON public.game_moves;
CREATE POLICY game_moves_player_read ON public.game_moves
  FOR SELECT TO authenticated
  USING (public.rasmalai_is_room_player(room_id));

-- The app reads these through permission-checked SECURITY DEFINER RPCs using
-- the restricted Prisma role. Browser clients receive no direct table access.
REVOKE SELECT ON TABLE public.spectator_invites,
  public.spectator_chat_messages,
  public.spectator_chat_reactions
  FROM PUBLIC, anon, authenticated;

-- These helpers were needed by the former spectator RLS policies. The guarded
-- server RPCs still call them as their function owner; direct client calls are
-- unnecessary and could reveal membership state.
REVOKE ALL ON FUNCTION public.rasmalai_is_active_spectator(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rasmalai_is_match_spectator(UUID)
  FROM PUBLIC, anon, authenticated;

COMMIT;

-- The room summary helper returns private room and game state. Keep direct
-- execution owner-only; guarded SECURITY DEFINER RPCs call it internally.
REVOKE ALL ON FUNCTION public.rasmalai_realtime_room_summary(UUID)
  FROM PUBLIC, anon, authenticated, prisma;

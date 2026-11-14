-- Manual rollback for 0011_social_action_rate_limits.
-- Roll the web application back to the prior version before running this file;
-- that version depends on authenticated RPC grants and insert-trigger quotas.
-- No user, message, notification, match, or rate-limit bucket rows are deleted.

REVOKE ALL ON FUNCTION public.rasmalai_consume_social_action_limit(TEXT)
  FROM PUBLIC, anon, authenticated, prisma;
DROP FUNCTION public.rasmalai_consume_social_action_limit(TEXT);

REVOKE EXECUTE ON FUNCTION public.rasmalai_send_friend_request(UUID) FROM prisma;
REVOKE EXECUTE ON FUNCTION public.rasmalai_respond_friend_request(UUID, BOOLEAN) FROM prisma;
REVOKE EXECUTE ON FUNCTION public.rasmalai_cancel_friend_request(UUID) FROM prisma;
REVOKE EXECUTE ON FUNCTION public.rasmalai_unfriend(UUID) FROM prisma;
REVOKE EXECUTE ON FUNCTION public.rasmalai_open_direct_conversation(UUID) FROM prisma;
REVOKE EXECUTE ON FUNCTION public.rasmalai_send_message_request(UUID, TEXT) FROM prisma;
REVOKE EXECUTE ON FUNCTION public.rasmalai_respond_message_request(UUID, BOOLEAN) FROM prisma;
REVOKE EXECUTE ON FUNCTION public.rasmalai_send_message(UUID, TEXT) FROM prisma;
REVOKE EXECUTE ON FUNCTION public.rasmalai_mark_conversation_read(UUID) FROM prisma;
REVOKE EXECUTE ON FUNCTION public.rasmalai_mark_notifications_read(UUID) FROM prisma;

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

CREATE TRIGGER friend_requests_shared_rate_limit
  BEFORE INSERT ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.rasmalai_rate_limit_social_insert();
CREATE TRIGGER message_requests_shared_rate_limit
  BEFORE INSERT ON public.message_requests
  FOR EACH ROW EXECUTE FUNCTION public.rasmalai_rate_limit_social_insert();
CREATE TRIGGER messages_shared_rate_limit
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rasmalai_rate_limit_social_insert();

import "server-only";

import { withRealtimeUser } from "@rasmalai/database";
import { logSocialActionFailure } from "@/lib/social-action-errors";

export type SocialRateLimitAction =
  | "friend_request"
  | "message_request"
  | "direct_message_send"
  | "social_friend_mutation"
  | "social_message_request_mutation"
  | "social_conversation_open"
  | "social_conversation_read"
  | "social_notification_read";

export type SocialRateLimitResult = "allowed" | "limited" | "unavailable";

/**
 * Commit the attempt quota in its own verified transaction before the social
 * mutation starts. A later validation/authorization/business failure therefore
 * cannot roll back the shared counter.
 */
export async function checkSocialActionRateLimit(
  accessToken: string,
  action: SocialRateLimitAction,
): Promise<SocialRateLimitResult> {
  try {
    const rows = await withRealtimeUser(accessToken, (db) => db.$queryRaw<Array<{ allowed: boolean }>>`
      SELECT public.rasmalai_consume_social_action_limit(${action}::text) AS allowed
    `);
    if (typeof rows[0]?.allowed !== "boolean") return "unavailable";
    return rows[0].allowed ? "allowed" : "limited";
  } catch (error) {
    // Fail closed on missing DB, invalid session, or failed shared-counter RPC.
    logSocialActionFailure(action, "rate-limit", error);
    return "unavailable";
  }
}

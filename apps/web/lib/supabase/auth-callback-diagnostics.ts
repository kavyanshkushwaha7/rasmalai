import { randomUUID } from "node:crypto";
import {
  getAuthUserRejectionReason,
  type AuthBetaConfig,
  type AuthUserRejectionReason,
  type VerifiedAuthUser,
} from "@rasmalai/database/auth-beta-policy";

export type AuthCallbackRejectionReason = "supabase_get_user_error" | "user_missing" | AuthUserRejectionReason;

export function getAuthCallbackRejectionReason(
  user: VerifiedAuthUser | null,
  authError: unknown,
  config: AuthBetaConfig,
): AuthCallbackRejectionReason | null {
  if (authError) return "supabase_get_user_error";
  if (!user) return "user_missing";
  return getAuthUserRejectionReason(user, config);
}

/** Emits only a random correlation ID and a fixed, non-sensitive reason code. */
export function logAuthCallbackRejection(reason: AuthCallbackRejectionReason): string {
  const requestId = randomUUID();
  console.warn(JSON.stringify({ requestId, reason }));
  return requestId;
}

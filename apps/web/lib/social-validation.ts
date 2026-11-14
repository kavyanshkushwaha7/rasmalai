const USERNAME_SEARCH = /^[a-z0-9_]{2,24}$/;

export function parsePlayerSearch(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return USERNAME_SEARCH.test(normalized) ? normalized : null;
}

export function parseSocialMessage(value: FormDataEntryValue | string | null | undefined, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

export function parseUuid(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

export function hasActiveDirectMessageRelationship(friendshipExists: boolean, acceptedMessageRequestExists: boolean) {
  return friendshipExists || acceptedMessageRequestExists;
}

export function getSocialNotice(input: string | string[] | undefined) {
  const code = Array.isArray(input) ? input[0] : input;
  const notices: Record<string, string> = {
    "friend-request-sent": "Friend request sent.",
    "friend-accepted": "Friend request accepted.",
    "friend-rejected": "Friend request declined.",
    "friend-cancelled": "Friend request cancelled.",
    unfriended: "Friend removed.",
    "message-request-sent": "Message request sent.",
    "message-request-rejected": "Message request declined.",
    read: "Marked as read.",
  };
  return code ? notices[code] ?? null : null;
}

export function getSocialError(input: string | string[] | undefined) {
  const code = Array.isArray(input) ? input[0] : input;
  const errors: Record<string, string> = {
    request: "We could not update that request. It may have changed or is no longer available.",
    conversation: "We could not open that conversation. Check that you are still connected.",
    message: "We could not send that message. Check the conversation and try again.",
    notification: "We could not update that notification. Refresh and try again.",
    "rate-limit": "You’re doing that too quickly. Please wait a moment and try again.",
    "temporarily-unavailable": "This action is temporarily unavailable. Please try again shortly.",
    "access-denied": "You no longer have access to this conversation or action.",
    "message-access-denied": "You no longer have permission to send messages in this conversation.",
  };
  return code ? errors[code] ?? null : null;
}

export function getConversationError(input: string | string[] | undefined, relationshipAllowsMessaging: boolean | null) {
  const code = Array.isArray(input) ? input[0] : input;
  if (relationshipAllowsMessaging === false && (code === "message" || code === "message-access-denied")) return null;
  return getSocialError(input);
}

"use server";

import { withRealtimeUser } from "@rasmalai/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSocialContext } from "@/lib/social-data";
import { checkSocialActionRateLimit, type SocialRateLimitAction } from "@/lib/social-rate-limit";
import { classifySocialActionFailure, logSocialActionFailure, type SocialActionFailure } from "@/lib/social-action-errors";
import { parseSocialMessage, parseUuid } from "@/lib/social-validation";

const publicUsername = /^[a-z0-9_]{3,24}$/;

async function execute<T>(accessToken: string, operation: Parameters<typeof withRealtimeUser<T>>[1]) {
  return withRealtimeUser(accessToken, operation);
}

type SocialMutationResult = "ok" | SocialActionFailure;

async function perform<T>(
  accessToken: string,
  action: string,
  operation: Parameters<typeof withRealtimeUser<T>>[1],
): Promise<SocialMutationResult> {
  try {
    await execute(accessToken, operation);
    return "ok";
  } catch (error) {
    logSocialActionFailure(action, "mutation", error);
    return classifySocialActionFailure(error);
  }
}

function redirectForMutationFailure(
  result: SocialMutationResult,
  returnPath: string,
  fallback: string,
  accessDeniedCode: "access-denied" | "message-access-denied" = "access-denied",
): never {
  if (result === "rate-limited") redirectWithSocialError(returnPath, "rate-limit");
  if (result === "access-denied") redirectWithSocialError(returnPath, accessDeniedCode);
  if (result === "temporarily-unavailable") redirectWithSocialError(returnPath, "temporarily-unavailable");
  redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}error=${fallback}`);
}

function redirectWithSocialError(
  path: string,
  code: "rate-limit" | "temporarily-unavailable" | "access-denied" | "message-access-denied",
): never {
  const target = new URL(path, "http://localhost:3000");
  target.searchParams.set("error", code);
  redirect(`${target.pathname}${target.search}`);
}

async function enforceSocialActionLimit(
  accessToken: string,
  action: SocialRateLimitAction,
  returnPath: string,
) {
  const result = await checkSocialActionRateLimit(accessToken, action);
  if (result === "allowed") return;
  redirectWithSocialError(returnPath, result === "limited" ? "rate-limit" : "temporarily-unavailable");
}

export async function sendFriendRequest(formData: FormData) {
  const auth = await requireSocialContext();
  await enforceSocialActionLimit(auth.accessToken, "friend_request", "/players");
  const recipientId = parseUuid(formData.get("recipientId"));
  if (!recipientId) redirect("/players?error=request");
  const ok = await perform(auth.accessToken, "sendFriendRequest", (db) => db.$queryRaw`
    SELECT public.rasmalai_send_friend_request(${recipientId}::uuid)
  `);
  if (ok !== "ok") redirectForMutationFailure(ok, "/players", "request");
  revalidatePath("/friends");
  revalidatePath("/players");
  redirect("/friends?notice=friend-request-sent");
}

export async function respondFriendRequest(formData: FormData) {
  const auth = await requireSocialContext();
  await enforceSocialActionLimit(auth.accessToken, "social_friend_mutation", "/friends");
  const requestId = parseUuid(formData.get("requestId"));
  const decision = formData.get("decision");
  if (!requestId || (decision !== "accept" && decision !== "reject")) redirect("/friends?error=request");
  const ok = await perform(auth.accessToken, "respondFriendRequest", (db) => db.$queryRaw`
    SELECT public.rasmalai_respond_friend_request(${requestId}::uuid, ${decision === "accept"})
  `);
  if (ok !== "ok") redirectForMutationFailure(ok, "/friends", "request");
  revalidatePath("/friends");
  revalidatePath("/notifications");
  redirect(`/friends?notice=${decision === "accept" ? "friend-accepted" : "friend-rejected"}`);
}

export async function cancelFriendRequest(formData: FormData) {
  const auth = await requireSocialContext();
  await enforceSocialActionLimit(auth.accessToken, "social_friend_mutation", "/friends");
  const requestId = parseUuid(formData.get("requestId"));
  if (!requestId) redirect("/friends?error=request");
  const ok = await perform(auth.accessToken, "cancelFriendRequest", (db) => db.$queryRaw`
    SELECT public.rasmalai_cancel_friend_request(${requestId}::uuid)
  `);
  if (ok !== "ok") redirectForMutationFailure(ok, "/friends", "request");
  revalidatePath("/friends");
  redirect("/friends?notice=friend-cancelled");
}

export async function unfriend(formData: FormData) {
  const auth = await requireSocialContext();
  await enforceSocialActionLimit(auth.accessToken, "social_friend_mutation", "/friends");
  const friendId = parseUuid(formData.get("friendId"));
  if (!friendId) redirect("/friends?error=request");
  const ok = await perform(auth.accessToken, "unfriend", (db) => db.$queryRaw`
    SELECT public.rasmalai_unfriend(${friendId}::uuid)
  `);
  if (ok !== "ok") redirectForMutationFailure(ok, "/friends", "request");
  revalidatePath("/friends");
  revalidatePath("/messages");
  redirect("/friends?notice=unfriended");
}

export async function openDirectConversation(formData: FormData) {
  const auth = await requireSocialContext();
  await enforceSocialActionLimit(auth.accessToken, "social_conversation_open", "/friends");
  const playerId = parseUuid(formData.get("playerId"));
  if (!playerId) redirect("/friends?error=conversation");
  let conversationId: string | null = null;
  try {
    const rows = await execute(auth.accessToken, (db) => db.$queryRaw<Array<{ conversation_id: string }>>`
      SELECT public.rasmalai_open_direct_conversation(${playerId}::uuid) AS conversation_id
    `);
    conversationId = rows[0]?.conversation_id ?? null;
  } catch (error) {
    logSocialActionFailure("openDirectConversation", "mutation", error);
    redirectWithSocialError("/friends", classifySocialActionFailure(error) === "access-denied" ? "access-denied" : "temporarily-unavailable");
  }
  if (!conversationId) redirect("/friends?error=conversation");
  revalidatePath("/messages");
  redirect(`/messages/${conversationId}`);
}

export async function sendMessageRequest(formData: FormData) {
  const auth = await requireSocialContext();
  const username = formData.get("username");
  const returnPath = typeof username === "string" && publicUsername.test(username) ? `/players/${username}` : "/players";
  await enforceSocialActionLimit(auth.accessToken, "message_request", returnPath);
  const recipientId = parseUuid(formData.get("recipientId"));
  const body = parseSocialMessage(formData.get("message"), 1000);
  if (!recipientId || !body) redirect(`${returnPath}?error=request`);
  const ok = await perform(auth.accessToken, "sendMessageRequest", (db) => db.$queryRaw`
    SELECT public.rasmalai_send_message_request(${recipientId}::uuid, ${body})
  `);
  if (ok !== "ok") redirectForMutationFailure(ok, returnPath, "request");
  revalidatePath("/messages");
  revalidatePath("/notifications");
  redirect(`${returnPath}?notice=message-request-sent`);
}

export async function respondMessageRequest(formData: FormData) {
  const auth = await requireSocialContext();
  await enforceSocialActionLimit(auth.accessToken, "social_message_request_mutation", "/messages?tab=requests");
  const requestId = parseUuid(formData.get("requestId"));
  const decision = formData.get("decision");
  if (!requestId || (decision !== "accept" && decision !== "reject")) redirect("/messages?tab=requests&error=request");
  if (decision === "reject") {
    const ok = await perform(auth.accessToken, "respondMessageRequest", (db) => db.$queryRaw`
      SELECT public.rasmalai_respond_message_request(${requestId}::uuid, false)
    `);
    if (ok !== "ok") redirectForMutationFailure(ok, "/messages?tab=requests", "request");
    revalidatePath("/messages");
    revalidatePath("/notifications");
    redirect("/messages?tab=requests&notice=message-request-rejected");
  }

  let conversationId: string | null = null;
  try {
    const rows = await execute(auth.accessToken, (db) => db.$queryRaw<Array<{ conversation_id: string | null }>>`
      SELECT public.rasmalai_respond_message_request(${requestId}::uuid, true) AS conversation_id
    `);
    conversationId = rows[0]?.conversation_id ?? null;
  } catch (error) {
    logSocialActionFailure("respondMessageRequest", "mutation", error);
    redirectWithSocialError("/messages?tab=requests", classifySocialActionFailure(error) === "access-denied" ? "access-denied" : "temporarily-unavailable");
  }
  if (!conversationId) redirect("/messages?tab=requests&error=request");
  revalidatePath("/messages");
  revalidatePath("/notifications");
  redirect(`/messages/${conversationId}`);
}

export async function sendDirectMessage(formData: FormData) {
  const auth = await requireSocialContext();
  const rawConversationId = formData.get("conversationId");
  const safeConversationId = typeof rawConversationId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawConversationId)
    ? rawConversationId
    : null;
  const returnPath = safeConversationId ? `/messages/${safeConversationId}` : "/messages";
  await enforceSocialActionLimit(auth.accessToken, "direct_message_send", returnPath);
  const conversationId = parseUuid(rawConversationId);
  const body = parseSocialMessage(formData.get("message"), 4000);
  if (!conversationId || !body) redirect("/messages?error=message");
  const ok = await perform(auth.accessToken, "sendDirectMessage", (db) => db.$queryRaw`
    SELECT public.rasmalai_send_message(${conversationId}::uuid, ${body})
  `);
  if (ok !== "ok") redirectForMutationFailure(ok, `/messages/${conversationId}`, "message", "message-access-denied");
  revalidatePath("/messages");
  revalidatePath(`/messages/${conversationId}`);
  revalidatePath("/notifications");
  redirect(`/messages/${conversationId}?sent=1`);
}

export async function markConversationRead(formData: FormData) {
  const auth = await requireSocialContext();
  await enforceSocialActionLimit(auth.accessToken, "social_conversation_read", "/messages");
  const conversationId = parseUuid(formData.get("conversationId"));
  if (!conversationId) redirect("/messages?error=conversation");
  const ok = await perform(auth.accessToken, "markConversationRead", (db) => db.$queryRaw`
    SELECT public.rasmalai_mark_conversation_read(${conversationId}::uuid)
  `);
  if (ok !== "ok") redirectForMutationFailure(ok, `/messages/${conversationId}`, "conversation");
  revalidatePath("/messages");
  revalidatePath(`/messages/${conversationId}`);
  redirect(`/messages/${conversationId}?read=1`);
}

export async function markConversationReadById(rawConversationId: string) {
  const auth = await requireSocialContext();
  if (await checkSocialActionRateLimit(auth.accessToken, "social_conversation_read") !== "allowed") return;
  const conversationId = parseUuid(rawConversationId);
  if (!conversationId) return;
  await perform(auth.accessToken, "markConversationReadById", (db) => db.$queryRaw`
    SELECT public.rasmalai_mark_conversation_read(${conversationId}::uuid)
  `);
  revalidatePath("/playground");
  revalidatePath("/messages");
}

export async function markNotificationsRead(formData: FormData) {
  const auth = await requireSocialContext();
  await enforceSocialActionLimit(auth.accessToken, "social_notification_read", "/notifications");
  const rawId = formData.get("notificationId");
  const notificationId = rawId ? parseUuid(rawId) : null;
  if (rawId && !notificationId) redirect("/notifications?error=notification");
  const ok = await perform(auth.accessToken, "markNotificationsRead", (db) => db.$queryRaw`
    SELECT public.rasmalai_mark_notifications_read(${notificationId}::uuid)
  `);
  if (ok !== "ok") redirectForMutationFailure(ok, "/notifications", "notification");
  revalidatePath("/notifications");
  revalidatePath("/playground");
  redirect("/notifications?notice=read");
}

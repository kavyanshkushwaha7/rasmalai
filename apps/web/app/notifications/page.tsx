import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bell, CheckCheck } from "lucide-react";
import { withAuthenticatedUser } from "@rasmalai/database";
import { markNotificationsRead } from "@/app/actions/social";
import { SocialNotice, SocialShell } from "@/components/SocialShell";
import { getSocialHeaderData, publicProfileFields, requireSocialContext } from "@/lib/social-data";
import { getSocialError, getSocialNotice } from "@/lib/social-validation";
import { isFeatureFlagEnabled } from "@rasmalai/game-engine/feature-flags";

export const metadata: Metadata = { title: "Notifications" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const notificationText: Record<string, (actor: string) => string> = {
  FRIEND_REQUEST: (actor) => `${actor} sent you a friend request.`,
  FRIEND_ACCEPTED: (actor) => `${actor} accepted your friend request.`,
  MESSAGE_REQUEST: (actor) => `${actor} sent you a message request.`,
  MESSAGE_REQUEST_ACCEPTED: (actor) => `${actor} accepted your message request.`,
  NEW_MESSAGE: (actor) => `${actor} sent you a message.`,
  GAME_INVITE: (actor) => `${actor} invited you to a game.`,
  MATCH_RESULT: () => "A match result is ready.",
  ACCOUNT_ACTIVITY: () => "There is an update to your account.",
};

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const auth = await requireSocialContext();
  const [query, header] = await Promise.all([searchParams, getSocialHeaderData(auth)]);
  const notifications = await withAuthenticatedUser(auth.accessToken, (db) => db.notification.findMany({
    where: { recipientId: auth.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, type: true, payload: true, readAt: true, createdAt: true, actor: { select: publicProfileFields } },
  }));
  const spectatorModeEnabled = isFeatureFlagEnabled(process.env.SPECTATOR_MODE_ENABLED);
  const visibleNotifications = notifications.filter((notification) => {
    if (spectatorModeEnabled || notification.type !== "GAME_INVITE") return true;
    const payload = notification.payload && typeof notification.payload === "object" && !Array.isArray(notification.payload)
      ? notification.payload as Record<string, unknown>
      : {};
    return payload.invite_kind !== "SPECTATOR";
  });
  const hasUnread = visibleNotifications.some((notification) => !notification.readAt);

  return <SocialShell {...header} active="notifications" eyebrow="YOUR UPDATES" title="Notifications." description="Friend activity and new messages, all in one place.">
    <SocialNotice message={getSocialNotice(query.notice)} error={getSocialError(query.error)} />
    {hasUnread && <form className="social-toolbar social-toolbar--end" action={markNotificationsRead}><p>{header.unreadNotifications} unread</p><button className="button button--quiet"><CheckCheck size={14} /> Mark all read</button></form>}
    <section className="social-panel">
      <div className="social-panel-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Your notifications</h2></div><span className="social-panel-icon"><Bell size={19} /></span></div>
      {visibleNotifications.length === 0 ? <div className="social-empty"><Bell size={24} /><h3>Nothing new right now.</h3><p>Friend requests and messages will show up here.</p></div>
        : <div className="social-list">{visibleNotifications.map((notification) => {
          const actor = notification.actor?.nickname ?? "A player";
          const payload = notification.payload && typeof notification.payload === "object" && !Array.isArray(notification.payload)
            ? notification.payload as Record<string, unknown>
            : {};
          const rawConversationId = payload.conversation_id;
          const rawRoomId = payload.room_id;
          const inviteKind = payload.invite_kind;
          const href = notification.type === "GAME_INVITE" && typeof rawRoomId === "string" && UUID.test(rawRoomId)
            ? inviteKind === "SPECTATOR" ? `/games/online/${rawRoomId}/watch` : `/games/online/${rawRoomId}`
            : notification.type === "NEW_MESSAGE" && typeof rawConversationId === "string" && UUID.test(rawConversationId)
            ? `/messages/${rawConversationId}`
            : notification.type === "MESSAGE_REQUEST" ? "/messages?tab=requests"
              : notification.type === "MESSAGE_REQUEST_ACCEPTED" ? "/messages"
                : notification.type === "FRIEND_REQUEST" || notification.type === "FRIEND_ACCEPTED" ? "/friends" : "/playground";
          const message = notificationText[notification.type]?.(actor) ?? "There is a new update.";
          return <article className={`notification-row ${notification.readAt ? "" : "notification-row--unread"}`} key={notification.id}>
            <span className="notification-dot" aria-hidden="true" />
            <div className="notification-copy"><p>{message}</p><time dateTime={notification.createdAt.toISOString()}>{notification.createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></div>
            <div className="notification-actions"><Link className="text-link" href={href}>Open <ArrowRight size={13} /></Link>{!notification.readAt && <form action={markNotificationsRead}><input type="hidden" name="notificationId" value={notification.id} /><button className="icon-button" aria-label="Mark notification as read" title="Mark read"><CheckCheck size={14} /></button></form>}</div>
          </article>;
        })}</div>}
      {visibleNotifications.length === 50 && <p className="social-footnote">Showing the 50 most recent notifications.</p>}
    </section>
  </SocialShell>;
}

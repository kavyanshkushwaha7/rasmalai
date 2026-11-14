import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { notFound } from "next/navigation";
import { withAuthenticatedUser } from "@rasmalai/database";
import { sendDirectMessage } from "@/app/actions/social";
import { SocialNotice, SocialShell } from "@/components/SocialShell";
import { ConversationReadMarker } from "@/components/ConversationReadMarker";
import { getPublicAvatarUrl, getSocialHeaderData, publicProfileFields, requireSocialContext } from "@/lib/social-data";
import { getConversationError, hasActiveDirectMessageRelationship } from "@/lib/social-validation";

export const metadata: Metadata = { title: "Conversation" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ConversationPage({ params, searchParams }: PageProps<"/messages/[conversationId]">) {
  const [{ conversationId }, query, auth] = await Promise.all([params, searchParams, requireSocialContext()]);
  if (!UUID.test(conversationId)) notFound();
  const [header, conversation] = await Promise.all([
    getSocialHeaderData(auth),
    withAuthenticatedUser(auth.accessToken, (db) => db.conversation.findFirst({
      where: { id: conversationId, kind: "DIRECT" },
      select: {
        id: true,
        members: { select: { profileId: true, profile: { select: publicProfileFields } } },
        messages: { orderBy: { createdAt: "desc" }, take: 100, select: { id: true, authorId: true, body: true, createdAt: true, deletedAt: true } },
      },
    })),
  ]);
  const otherMember = conversation?.members.find((member) => member.profileId !== auth.user.id);
  const other = otherMember?.profile;
  if (!conversation || !otherMember || !other || !conversation.members.some((member) => member.profileId === auth.user.id)) notFound();
  const avatarUrl = getPublicAvatarUrl(auth, other);
  const messages = [...conversation.messages].reverse();

  // A direct conversation can outlive a friendship. Read the current
  // relationship under the signed-in user's normal RLS identity so the page
  // does not present a send box that the authoritative RPC must reject.
  // The write RPC remains the final authorization check in case this changes
  // between rendering and submission.
  let relationshipAllowsMessaging: boolean | null = null;
  try {
    const access = await withAuthenticatedUser(auth.accessToken, async (db) => {
      const [friendship, acceptedRequest] = await Promise.all([
        db.friendship.findFirst({
          where: {
            OR: [
              { profileAId: auth.user.id, profileBId: otherMember.profileId },
              { profileAId: otherMember.profileId, profileBId: auth.user.id },
            ],
          },
          select: { id: true },
        }),
        db.messageRequest.findFirst({
          where: {
            status: "ACCEPTED",
            OR: [
              { senderId: auth.user.id, recipientId: otherMember.profileId },
              { senderId: otherMember.profileId, recipientId: auth.user.id },
            ],
          },
          select: { id: true },
        }),
      ]);
      return hasActiveDirectMessageRelationship(Boolean(friendship), Boolean(acceptedRequest));
    });
    relationshipAllowsMessaging = access;
  } catch {
    // If the read check is temporarily unavailable, leave the normal composer
    // available; rasmalai_send_message still enforces authorization securely.
  }

  return <SocialShell {...header} active="messages" eyebrow="PRIVATE CONVERSATION" title={other.nickname} description={`Chatting with @${other.username}`}>
    <ConversationReadMarker conversationId={conversation.id} />
    <SocialNotice error={getConversationError(query.error, relationshipAllowsMessaging)} />
    <section className="social-panel conversation-panel">
      <div className="conversation-topline"><Link className="text-link" href="/messages"><ArrowLeft size={14} /> All conversations</Link><div className="social-player-identity"><span className="avatar social-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : other.nickname.slice(0, 1).toUpperCase()}</span><span><strong>{other.nickname}</strong><small>@{other.username}</small></span></div></div>
      <div className="conversation-messages" aria-label="Messages">
        {messages.length === 0 ? <div className="social-empty conversation-empty"><p>Say hello to start the conversation.</p></div> : messages.map((message) => <article className={`chat-bubble ${message.authorId === auth.user.id ? "chat-bubble--mine" : ""}`} key={message.id}>
          <span>{message.deletedAt ? "This message was removed." : message.body}</span>
          <time dateTime={message.createdAt.toISOString()}>{message.createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
        </article>)}
      </div>
      {relationshipAllowsMessaging === false ? <p className="conversation-readonly" role="status">
        This conversation is read-only. To message again, become friends or accept a message request.
      </p> : <form className="message-composer" action={sendDirectMessage}>
        <input type="hidden" name="conversationId" value={conversation.id} />
        <label className="visually-hidden" htmlFor="chat-message">Write a message</label>
        <textarea id="chat-message" name="message" maxLength={4000} required placeholder={`Message ${other.nickname}…`} />
        <button className="button button--primary" type="submit"><Send size={15} /> Send</button>
      </form>}
    </section>
  </SocialShell>;
}

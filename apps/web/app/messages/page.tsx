import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Inbox, MessageCircle, MessageSquareText } from "lucide-react";
import { withAuthenticatedUser } from "@rasmalai/database";
import { respondMessageRequest } from "@/app/actions/social";
import { SocialNotice, SocialShell } from "@/components/SocialShell";
import { getPublicAvatarUrl, getSocialHeaderData, publicProfileFields, requireSocialContext } from "@/lib/social-data";
import { getSocialError, getSocialNotice } from "@/lib/social-validation";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const auth = await requireSocialContext();
  const [query, header] = await Promise.all([searchParams, getSocialHeaderData(auth)]);
  const [threads, requests] = await withAuthenticatedUser(auth.accessToken, async (db) => Promise.all([
    db.conversationMember.findMany({
      where: { profileId: auth.user.id },
      orderBy: { joinedAt: "desc" },
      select: {
        conversationId: true,
        conversation: {
          select: {
            id: true,
            members: { select: { profileId: true, profile: { select: publicProfileFields } } },
            messages: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, authorId: true, body: true, createdAt: true } },
          },
        },
      },
    }),
    db.messageRequest.findMany({
      where: { recipientId: auth.user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, initialMessage: true, createdAt: true, sender: { select: publicProfileFields } },
    }),
  ]));
  const showingRequests = query.tab === "requests";

  return <SocialShell {...header} active="messages" eyebrow="PRIVATE CHATS" title="Messages." description="Keep the conversation going with friends and players whose requests you accepted.">
    <SocialNotice message={getSocialNotice(query.notice)} error={getSocialError(query.error)} />
    <div className="social-tabs" role="tablist" aria-label="Message inbox">
      <Link role="tab" aria-selected={!showingRequests} className={!showingRequests ? "social-tab-active" : ""} href="/messages">Conversations <span>{threads.length}</span></Link>
      <Link role="tab" aria-selected={showingRequests} className={showingRequests ? "social-tab-active" : ""} href="/messages?tab=requests">Requests <span>{requests.length}</span></Link>
    </div>

    {showingRequests ? <section className="social-panel">
      <div className="social-panel-heading"><div><span className="eyebrow">MESSAGE REQUESTS</span><h2>Choose who can chat with you.</h2></div><span className="social-panel-icon"><Inbox size={19} /></span></div>
      {requests.length === 0 ? <div className="social-empty"><Inbox size={24} /><h3>All caught up.</h3><p>New message requests will show up here. You decide which conversations to open.</p></div>
        : <div className="social-list">{requests.map((request) => {
          const player = request.sender;
          const avatarUrl = getPublicAvatarUrl(auth, player);
          return <article className="message-request-card" key={request.id}>
            <div className="social-player-identity"><span className="avatar social-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : player.nickname.slice(0, 1).toUpperCase()}</span><span><strong>{player.nickname}</strong><small>@{player.username}</small></span></div>
            <p className="message-request-body">{request.initialMessage}</p>
            <div className="social-row-actions"><form action={respondMessageRequest}><input type="hidden" name="requestId" value={request.id} /><button className="button button--mint" name="decision" value="accept"><MessageCircle size={14} /> Accept &amp; chat</button><button className="button button--quiet" name="decision" value="reject">Decline</button></form><Link className="text-link" href={`/players/${player.username}`}>View profile <ArrowRight size={13} /></Link></div>
          </article>;
        })}</div>}
    </section> : <section className="social-panel">
      <div className="social-panel-heading"><div><span className="eyebrow">YOUR INBOX</span><h2>Conversations</h2></div><span className="social-panel-icon"><MessageSquareText size={19} /></span></div>
      {threads.length === 0 ? <div className="social-empty"><MessageCircle size={24} /><h3>Start with a friend.</h3><p>Open a player profile from your friends list to begin a private conversation.</p><Link className="text-link" href="/friends">Go to friends <ArrowRight size={14} /></Link></div>
        : <div className="social-list">{threads.map(({ conversation }) => {
          const other = conversation.members.find((member) => member.profileId !== auth.user.id)?.profile;
          const lastMessage = conversation.messages[0];
          if (!other) return null;
          const avatarUrl = getPublicAvatarUrl(auth, other);
          return <Link className="conversation-row" href={`/messages/${conversation.id}`} key={conversation.id}>
            <span className="avatar social-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : other.nickname.slice(0, 1).toUpperCase()}</span>
            <span className="conversation-copy"><strong>{other.nickname}</strong><small>@{other.username}</small><span>{lastMessage ? `${lastMessage.authorId === auth.user.id ? "You: " : ""}${lastMessage.body}` : "Say hello and start the conversation."}</span></span>
            <ArrowRight className="conversation-arrow" size={16} />
          </Link>;
        })}</div>}
    </section>}
  </SocialShell>;
}

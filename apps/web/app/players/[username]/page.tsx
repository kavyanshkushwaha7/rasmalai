import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, MessageCircle, UserPlus, UsersRound } from "lucide-react";
import { notFound } from "next/navigation";
import { withAuthenticatedUser } from "@rasmalai/database";
import { openDirectConversation, respondFriendRequest, sendFriendRequest, sendMessageRequest } from "@/app/actions/social";
import { SocialNotice, SocialShell } from "@/components/SocialShell";
import { getPublicAvatarUrl, getSocialHeaderData, publicProfileFields, requireSocialContext } from "@/lib/social-data";
import { getSocialError, getSocialNotice } from "@/lib/social-validation";

const usernamePattern = /^[a-z0-9_]{3,24}$/;

export async function generateMetadata({ params }: PageProps<"/players/[username]">): Promise<Metadata> {
  const { username } = await params;
  return { title: usernamePattern.test(username) ? `@${username}` : "Player" };
}

export default async function PlayerProfilePage({ params, searchParams }: PageProps<"/players/[username]">) {
  const [{ username }, query, auth] = await Promise.all([params, searchParams, requireSocialContext()]);
  if (!usernamePattern.test(username)) notFound();
  const [header, profile] = await Promise.all([
    getSocialHeaderData(auth),
    withAuthenticatedUser(auth.accessToken, (db) => db.profile.findUnique({ where: { username }, select: publicProfileFields })),
  ]);
  if (!profile) notFound();

  const relationships = profile.id === auth.user.id ? { friendship: null, friendRequests: [], messageRequests: [] } : await withAuthenticatedUser(auth.accessToken, async (db) => {
    const peers = [{ senderId: auth.user.id, recipientId: profile.id }, { senderId: profile.id, recipientId: auth.user.id }];
    const [friendship, friendRequests, messageRequests] = await Promise.all([
      db.friendship.findFirst({ where: { OR: [{ profileAId: auth.user.id, profileBId: profile.id }, { profileAId: profile.id, profileBId: auth.user.id }] }, select: { profileAId: true } }),
      db.friendRequest.findMany({ where: { status: "PENDING", OR: [{ senderId: auth.user.id, recipientId: profile.id }, { senderId: profile.id, recipientId: auth.user.id }] }, select: { id: true, senderId: true, recipientId: true } }),
      db.messageRequest.findMany({ where: { OR: peers }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, senderId: true, recipientId: true, status: true } }),
    ]);
    return { friendship, friendRequests, messageRequests };
  });

  const incomingFriend = relationships.friendRequests.find((request) => request.senderId === profile.id);
  const outgoingFriend = relationships.friendRequests.find((request) => request.senderId === auth.user.id);
  const incomingMessage = relationships.messageRequests.find((request) => request.senderId === profile.id && request.status === "PENDING");
  const outgoingMessage = relationships.messageRequests.find((request) => request.senderId === auth.user.id && request.status === "PENDING");
  const acceptedMessage = relationships.messageRequests.some((request) => request.status === "ACCEPTED");
  const avatarUrl = getPublicAvatarUrl(auth, profile);
  const gamesPlayed = profile.gamesPlayed;
  const winRate = gamesPlayed === 0 ? 0 : Math.round(profile.wins / gamesPlayed * 100);

  return <SocialShell {...header} active="friends" eyebrow="PLAYER PROFILE" title={profile.nickname} description={`@${profile.username} · A player in the Rasmalai playground`}>
    <SocialNotice message={getSocialNotice(query.notice)} error={getSocialError(query.error)} />
    <section className="public-player-profile social-panel">
      <span className="avatar social-avatar social-avatar--profile">{avatarUrl ? <img src={avatarUrl} alt={`${profile.nickname}'s profile`} /> : profile.nickname.slice(0, 1).toUpperCase()}</span>
      <div className="public-player-copy"><span className="eyebrow">PUBLIC PLAYER CARD</span><h2>{profile.nickname}</h2><p>@{profile.username}</p><div className="public-player-stats"><span><strong>{profile.gamesPlayed}</strong> games</span><span><strong>{profile.wins}</strong> wins</span><span><strong>{winRate}%</strong> win rate</span></div></div>
      <div className="public-player-actions">
        {profile.id === auth.user.id ? <Link className="button button--quiet" href="/profile/setup?edit=1">Edit your profile <ArrowRight size={14} /></Link>
          : relationships.friendship ? <><span className="relationship-badge"><UsersRound size={14} /> Friends</span><form action={openDirectConversation}><input type="hidden" name="playerId" value={profile.id} /><button className="button button--mint"><MessageCircle size={14} /> Open chat</button></form></>
            : acceptedMessage ? <form action={openDirectConversation}><input type="hidden" name="playerId" value={profile.id} /><button className="button button--mint"><MessageCircle size={14} /> Continue chat</button></form>
              : incomingFriend ? <form action={respondFriendRequest}><input type="hidden" name="requestId" value={incomingFriend.id} /><button className="button button--mint" name="decision" value="accept"><UserPlus size={14} /> Accept friend request</button></form>
                : outgoingFriend ? <span className="relationship-badge">Friend request pending</span>
                  : incomingMessage ? <Link className="button button--quiet" href="/messages?tab=requests">Review message request <ArrowRight size={14} /></Link>
                    : outgoingMessage ? <span className="relationship-badge">Message request pending</span>
                      : <>
                        <form action={sendFriendRequest}><input type="hidden" name="recipientId" value={profile.id} /><button className="button button--primary"><UserPlus size={14} /> Add friend</button></form>
                        <form className="message-request-form" action={sendMessageRequest}><input type="hidden" name="recipientId" value={profile.id} /><input type="hidden" name="username" value={profile.username} /><label htmlFor="message-request">Or send a message request</label><textarea id="message-request" name="message" maxLength={1000} required placeholder="Say hello…" /><button className="button button--quiet">Send request <ArrowRight size={14} /></button></form>
                      </>}
      </div>
    </section>
    <Link className="text-link social-return-link" href="/players"><ArrowLeft size={14} /> Back to player search</Link>
  </SocialShell>;
}

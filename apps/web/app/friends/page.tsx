import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, MessageCircle, Search, UserMinus, UsersRound, X } from "lucide-react";
import { withAuthenticatedUser } from "@rasmalai/database";
import { cancelFriendRequest, openDirectConversation, respondFriendRequest, unfriend } from "@/app/actions/social";
import { SocialNotice, SocialShell } from "@/components/SocialShell";
import { getPublicAvatarUrl, getSocialHeaderData, publicProfileFields, requireSocialContext } from "@/lib/social-data";
import { getSocialError, getSocialNotice } from "@/lib/social-validation";

export const metadata: Metadata = { title: "Friends" };

export default async function FriendsPage({ searchParams }: PageProps<"/friends">) {
  const auth = await requireSocialContext();
  const [query, header] = await Promise.all([searchParams, getSocialHeaderData(auth)]);
  const [friendships, incoming, outgoing] = await withAuthenticatedUser(auth.accessToken, async (db) => Promise.all([
    db.friendship.findMany({
      where: { OR: [{ profileAId: auth.user.id }, { profileBId: auth.user.id }] },
      orderBy: { acceptedAt: "desc" },
      select: {
        profileAId: true,
        profileBId: true,
        profileA: { select: publicProfileFields },
        profileB: { select: publicProfileFields },
      },
    }),
    db.friendRequest.findMany({
      where: { recipientId: auth.user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, sender: { select: publicProfileFields } },
    }),
    db.friendRequest.findMany({
      where: { senderId: auth.user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, recipient: { select: publicProfileFields } },
    }),
  ]));

  return <SocialShell {...header} active="friends" eyebrow="GOOD COMPANY" title="Your people." description="Find players, manage requests and bring your crew together.">
    <SocialNotice message={getSocialNotice(query.notice)} error={getSocialError(query.error)} />
    <div className="social-toolbar"><p>{friendships.length} {friendships.length === 1 ? "friend" : "friends"}</p><Link className="button button--primary" href="/players"><Search size={15} /> Find players</Link></div>

    {incoming.length > 0 && <section className="social-panel">
      <div className="social-panel-heading"><div><span className="eyebrow">YOUR INBOX</span><h2>Friend requests <span className="social-count">{incoming.length}</span></h2></div></div>
      <div className="social-list">{incoming.map((request) => {
        const player = request.sender;
        const avatarUrl = getPublicAvatarUrl(auth, player);
        return <article className="social-list-row" key={request.id}>
          <Link className="social-player-identity" href={`/players/${player.username}`}>
            <span className="avatar social-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : player.nickname.slice(0, 1).toUpperCase()}</span>
            <span><strong>{player.nickname}</strong><small>@{player.username}</small></span>
          </Link>
          <div className="social-row-actions"><form action={respondFriendRequest}><input type="hidden" name="requestId" value={request.id} /><button className="button button--mint" name="decision" value="accept"><Check size={14} /> Accept</button><button className="button button--quiet" name="decision" value="reject"><X size={14} /> Decline</button></form></div>
        </article>;
      })}</div>
    </section>}

    <section className="social-panel">
      <div className="social-panel-heading"><div><span className="eyebrow">YOUR CREW</span><h2>Friends</h2></div><span className="social-panel-icon"><UsersRound size={19} /></span></div>
      {friendships.length === 0 ? <div className="social-empty"><UsersRound size={24} /><h3>Your crew starts here.</h3><p>Search by username and send a friend request to find your people.</p><Link className="text-link" href="/players">Search players <ArrowRight size={14} /></Link></div>
        : <div className="social-list">{friendships.map((friendship) => {
          const player = friendship.profileAId === auth.user.id ? friendship.profileB : friendship.profileA;
          const avatarUrl = getPublicAvatarUrl(auth, player);
          return <article className="social-list-row" key={`${friendship.profileAId}:${friendship.profileBId}`}>
            <Link className="social-player-identity" href={`/players/${player.username}`}>
              <span className="avatar social-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : player.nickname.slice(0, 1).toUpperCase()}</span>
              <span><strong>{player.nickname}</strong><small>@{player.username}</small></span>
            </Link>
            <div className="social-row-actions">
              <form action={openDirectConversation}><input type="hidden" name="playerId" value={player.id} /><button className="button button--mint"><MessageCircle size={14} /> Message</button></form>
              <form action={unfriend}><input type="hidden" name="friendId" value={player.id} /><button className="icon-button" aria-label={`Remove ${player.nickname} as a friend`} title="Remove friend"><UserMinus size={15} /></button></form>
            </div>
          </article>;
        })}</div>}
    </section>

    {outgoing.length > 0 && <section className="social-panel">
      <div className="social-panel-heading"><div><span className="eyebrow">OUTGOING</span><h2>Sent requests</h2></div></div>
      <div className="social-list">{outgoing.map((request) => {
        const player = request.recipient;
        const avatarUrl = getPublicAvatarUrl(auth, player);
        return <article className="social-list-row" key={request.id}>
          <Link className="social-player-identity" href={`/players/${player.username}`}>
            <span className="avatar social-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : player.nickname.slice(0, 1).toUpperCase()}</span>
            <span><strong>{player.nickname}</strong><small>@{player.username}</small></span>
          </Link>
          <form action={cancelFriendRequest}><input type="hidden" name="requestId" value={request.id} /><button className="button button--quiet">Cancel request</button></form>
        </article>;
      })}</div>
    </section>}
  </SocialShell>;
}

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search, UsersRound } from "lucide-react";
import { withAuthenticatedUser } from "@rasmalai/database";
import { SocialNotice, SocialShell } from "@/components/SocialShell";
import { getPublicAvatarUrl, getSocialHeaderData, publicProfileFields, requireSocialContext } from "@/lib/social-data";
import { getSocialError, parsePlayerSearch } from "@/lib/social-validation";

export const metadata: Metadata = { title: "Find players" };

export default async function PlayersPage({ searchParams }: PageProps<"/players">) {
  const auth = await requireSocialContext();
  const [query, header] = await Promise.all([searchParams, getSocialHeaderData(auth)]);
  const search = parsePlayerSearch(typeof query.q === "string" ? query.q : null);
  const players = search ? await withAuthenticatedUser(auth.accessToken, (db) => db.profile.findMany({
    where: { username: { startsWith: search }, id: { not: auth.user.id } },
    orderBy: { username: "asc" },
    take: 20,
    select: publicProfileFields,
  })) : [];

  return <SocialShell {...header} active="friends" eyebrow="MEET THE PLAYERS" title="Find your people." description="Search public player profiles by username and send a friend request.">
    <SocialNotice error={getSocialError(query.error)} />
    <section className="social-panel search-panel">
      <form className="player-search-form" action="/players" method="get">
        <label htmlFor="player-search">Player username</label>
        <div><Search size={17} /><input id="player-search" name="q" type="search" minLength={2} maxLength={24} pattern="[A-Za-z0-9_]{2,24}" placeholder="Search usernames" defaultValue={typeof query.q === "string" ? query.q : ""} /><button className="button button--primary" type="submit">Search</button></div>
        <small>Enter at least two letters, numbers or underscores.</small>
      </form>
    </section>
    {search && <section className="social-panel">
      <div className="social-panel-heading"><div><span className="eyebrow">RESULTS</span><h2>Players matching “{search}”</h2></div><span className="social-panel-icon"><UsersRound size={19} /></span></div>
      {players.length === 0 ? <div className="social-empty"><Search size={24} /><h3>No players found yet.</h3><p>Try another username or invite a friend to join the playground.</p></div>
        : <div className="social-card-grid">{players.map((player) => {
          const avatarUrl = getPublicAvatarUrl(auth, player);
          return <article className="social-player-card" key={player.id}>
            <Link className="social-player-card-main" href={`/players/${player.username}`}>
              <span className="avatar social-avatar social-avatar--large">{avatarUrl ? <img src={avatarUrl} alt="" /> : player.nickname.slice(0, 1).toUpperCase()}</span>
              <strong>{player.nickname}</strong><small>@{player.username}</small>
            </Link>
            <Link className="button button--quiet" href={`/players/${player.username}`}>View profile <ArrowRight size={14} /></Link>
          </article>;
        })}</div>}
      {players.length === 20 && <p className="social-footnote">Showing the first 20 matches. Add more characters to narrow your search.</p>}
    </section>}
  </SocialShell>;
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Bell, Compass, Gamepad2, History, Sparkles, UsersRound } from "lucide-react";
import { isDatabaseConfigured, withAuthenticatedUser } from "@rasmalai/database";
import { PlaygroundHeader } from "@/components/PlaygroundHeader";
import { GameArtwork, type GameKind } from "@/components/GameArtwork";
import { PlayerId } from "@/components/PlayerId";
import { getAuthenticatedUserContext, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSocialUnreadCounts } from "@/lib/social-data";

export const metadata: Metadata = { title: "Playground" };

const featuredGames: { name: string; subtitle: string; kind: GameKind; badge: string; href: string }[] = [
  { name: "Ludo", subtitle: "Bring your best lucky roll.", kind: "ludo", badge: "2–4 PLAYERS", href: "/games/ludo" },
  { name: "Tic Tac Toe", subtitle: "A quick little face-off.", kind: "tic-tac-toe", badge: "2 PLAYERS", href: "/games/tic-tac-toe" },
  { name: "Snakes & Ladders", subtitle: "Up the ladder, down the snake.", kind: "snakes-ladders", badge: "2–4 PLAYERS", href: "/games/snakes-and-ladders" },
];

export default async function PlaygroundPage() {
  const auth = await getAuthenticatedUserContext();
  const user = auth?.user ?? null;
  if (!user && isSupabaseConfigured()) redirect("/login");
  if (!user) return <main className="setup-page"><div className="setup-message"><Gamepad2 size={25} /><h1>Your Playground is one sign-in away.</h1><p>Log in to see your player profile and dashboard.</p><Link className="button button--primary" href="/login">Log in</Link></div></main>;
  if (!isDatabaseConfigured()) return <main className="setup-page"><div className="setup-message"><Gamepad2 size={25} /><h1>Let’s connect your player profile.</h1><p>Supabase Auth is ready. Add the database connection variables to finish Phase 1 setup.</p><Link className="button button--primary" href="/profile/setup">Continue setup</Link></div></main>;

  let profile;
  try {
    profile = await withAuthenticatedUser(auth!.accessToken, (db) =>
      db.profile.findUnique({
        where: { id: user.id },
        select: { id: true, username: true, nickname: true, avatarUrl: true, avatarPath: true, gamesPlayed: true, wins: true },
      }),
    );
  } catch (error) {
    console.error("Could not load Rasmalai Playground profile", error);
    return <main className="setup-page"><div className="setup-message"><Gamepad2 size={25} /><h1>Profile storage is unavailable.</h1><p>We could not reach your profile database. Check the database connection and migration setup, then try again.</p><Link className="button button--primary" href="/profile/setup">Open profile setup</Link></div></main>;
  }
  if (!profile) redirect("/profile/setup");

  const avatarUrl = profile.avatarPath
    ? auth!.supabase.storage.from("profile-avatars").getPublicUrl(profile.avatarPath).data.publicUrl
    : profile.avatarUrl;
  const winRate = profile.gamesPlayed === 0 ? 0 : Math.round((profile.wins / profile.gamesPlayed) * 100);
  let unread = { messages: 0, notifications: 0 };
  try {
    unread = await getSocialUnreadCounts(auth!.accessToken);
  } catch {
    // The Phase 1 dashboard remains available while Phase 2 database access is pending.
  }
  return <main className="app-page playground-page">
      <PlaygroundHeader nickname={profile.nickname} avatarUrl={avatarUrl} unreadMessages={unread.messages} unreadNotifications={unread.notifications} />
    <div className="playground-content">
      <section className="welcome-banner">
        <div className="welcome-copy"><span className="eyebrow eyebrow--light"><span className="eyebrow-dot" /> YOUR PLAYGROUND</span><h1>Hey, {profile.nickname}<span className="welcome-period">.</span></h1><p>Your next favorite game night starts right here.</p><div className="welcome-actions"><a className="button button--mint" href="#games">Find a game <ArrowRight size={16} /></a><span className="welcome-note"><Sparkles size={15} /> Made for good company</span></div><PlayerId id={profile.id} /></div>
        <div className="welcome-decoration" aria-hidden="true"><span className="welcome-circle welcome-circle--one" /><span className="welcome-circle welcome-circle--two" /><span className="welcome-token welcome-token--x">×</span><span className="welcome-token welcome-token--o">○</span><span className="welcome-spark">✦</span><span className="welcome-spark welcome-spark--two">✳</span></div>
      </section>

      <section className="dashboard-section" id="games">
        <div className="dashboard-section-head"><div><span className="eyebrow">THE GAME SHELF</span><h2>Pick your next <em>favorite.</em></h2></div><span className="section-note">Three classics to get us started</span></div>
        <div className="dashboard-games">{featuredGames.map((game) => <article className={`dashboard-game-card dashboard-game-card--${game.kind}`} key={game.name}>
          <div className="dashboard-game-art"><GameArtwork kind={game.kind} compact /><span className="player-badge">{game.badge}</span></div>
          <div className="dashboard-game-copy"><div><h3>{game.name}</h3><p>{game.subtitle}</p></div><span className="coming-chip">PLAY OFFLINE</span></div>
          <Link className="button button--mint dashboard-play-button" href={game.href}>Play game <ArrowRight size={15} /></Link>
        </article>)}</div>
      </section>

      <div className="dashboard-lower-grid">
        <section className="dashboard-panel stats-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR STATS</span><h2>Every game <em>counts.</em></h2></div><span className="panel-icon"><History size={19} /></span></div><div className="stat-grid"><div><strong>{profile.gamesPlayed}</strong><span>Games played</span></div><div><strong>{profile.wins}</strong><span>Wins</span></div><div><strong>{winRate}%</strong><span>Win rate</span></div></div><p className="panel-footnote">Your match history will start growing after your first game.</p></section>
        <section className="dashboard-panel friends-panel"><div className="panel-heading"><div><span className="eyebrow">GOOD COMPANY</span><h2>Bring your <em>crew.</em></h2></div><span className="panel-icon panel-icon--pink"><UsersRound size={19} /></span></div><p className="empty-copy">Find your people, grow your friends list and share a private chat.</p><Link className="button button--mint dashboard-friends-cta" href="/friends">Open friends <ArrowRight size={15} /></Link></section>
      </div>

      <section className="public-matches-panel"><div className="public-icon"><Compass size={23} /></div><div><span className="eyebrow">AROUND THE PLAYGROUND</span><h2>Find your next table.</h2><p>Join a public match or invite friends to a private online room.</p></div><Link className="button button--mint" href="/games/online">Open online rooms <ArrowRight size={15} /></Link></section>
      <footer className="dashboard-footer"><span>rasmalai<span className="brand-period">.</span></span><span>Play nice. Laugh lots. Take the rematch.</span><Link href="/profile/setup?edit=1">Edit profile <ArrowRight size={14} /></Link></footer>
    </div>
  </main>;
}

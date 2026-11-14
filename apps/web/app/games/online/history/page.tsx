import type { Metadata } from "next";
import Link from "next/link";
import { History, Trophy } from "lucide-react";
import { withAuthenticatedUser } from "@rasmalai/database";
import { OnlineShell } from "@/components/games/OnlineShell";
import { requireSocialContext } from "@/lib/social-data";

export const metadata: Metadata = { title: "Online match history" };

const gameNames: Record<string, string> = { LUDO: "Ludo", TIC_TAC_TOE: "Tic Tac Toe", SNAKES_AND_LADDERS: "Snakes & Ladders" };

export default async function OnlineMatchHistoryPage() {
  const auth = await requireSocialContext();
  const matches = await withAuthenticatedUser(auth.accessToken, (db) => db.matchPlayer.findMany({
    where: { profileId: auth.user.id, match: { completedAt: { not: null } } },
    orderBy: { match: { completedAt: "desc" } },
    take: 40,
    select: {
      didWin: true,
      score: true,
      match: {
        select: {
          id: true,
          gameType: true,
          startedAt: true,
          completedAt: true,
          room: { select: { roomCode: true } },
          players: {
            orderBy: { seatIndex: "asc" },
            select: { didWin: true, profile: { select: { username: true, nickname: true } } },
          },
        },
      },
    },
  }));
  const wins = matches.filter((entry) => entry.didWin).length;

  return <OnlineShell><section className="online-history-page">
    <header className="online-history-heading"><span className="online-panel-icon"><History size={20} /></span><div><span className="eyebrow">YOUR ONLINE RECORD</span><h1>Match history<em>.</em></h1><p>{matches.length} completed matches · {wins} wins</p></div></header>
    {matches.length === 0 ? <div className="online-history-empty"><Trophy size={27} /><h2>Your first result is waiting.</h2><p>Completed online matches will appear here for every participant.</p><Link href="/games/online" className="button button--mint">Find a table</Link></div> : <div className="online-history-list">{matches.map((entry) => {
      const opponents = entry.match.players.map((player) => player.profile.nickname || player.profile.username).join(" · ");
      return <article className="online-history-row" key={entry.match.id}><span className={`online-history-result ${entry.didWin ? "is-win" : ""}`}>{entry.didWin ? "WIN" : "PLAYED"}</span><div><strong>{gameNames[entry.match.gameType] ?? entry.match.gameType}</strong><small>{opponents}</small></div><time dateTime={entry.match.completedAt?.toISOString()}>{entry.match.completedAt?.toLocaleDateString(undefined, { dateStyle: "medium" })}</time><span className="online-history-code">{entry.match.room.roomCode}</span></article>;
    })}</div>}
    <Link href="/games/online" className="online-back-link">Back to online games</Link>
  </section></OnlineShell>;
}

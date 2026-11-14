import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, UsersRound } from "lucide-react";
import { Brand } from "@/components/Brand";

export const metadata: Metadata = { title: "Play offline" };

const games = [
  { href: "/games/ludo", number: "01", title: "Ludo", players: "2–4 players", text: "Roll sixes, bring your tokens home, and take the shortcut only when it is safe.", color: "ludo" },
  { href: "/games/tic-tac-toe", number: "02", title: "Tic Tac Toe", players: "2 players", text: "Take turns placing X and O. Three in a row wins the round.", color: "tic" },
  { href: "/games/snakes-and-ladders", number: "03", title: "Snakes & Ladders", players: "2–4 players", text: "Climb ladders, slide down snakes, and roll the exact number to finish.", color: "snakes" },
];

export default function GamesPage() {
  return <main className="local-game-page local-game-page--lobby"><header className="local-game-header"><Brand /><nav aria-label="Game navigation"><Link href="/games/online"><UsersRound size={15} /> Play online</Link><Link href="/playground">Playground</Link></nav></header>
    <section className="game-lobby-content"><span className="eyebrow"><span className="eyebrow-dot" /> THREE CLASSICS · ONE DEVICE</span><h1>Pick your next <em>favorite.</em></h1><p>Choose a game, add the players around you, and pass the device between turns.</p>
      <div className="game-lobby-grid">{games.map((game) => <a className={`game-lobby-card game-lobby-card--${game.color}`} href={game.href} key={game.href}>
        <span className="game-lobby-number">{game.number}</span><span className="game-lobby-player-count">{game.players}</span><h2>{game.title}</h2><p>{game.text}</p><span className="game-lobby-play">Play offline <ArrowRight size={17} /></span>
      </a>)}</div>
      <p className="offline-note"><span aria-hidden="true">●</span> Offline games work without an account or internet. <Link href="/games/online">Ready for a room? Play online <ArrowRight size={14} /></Link></p>
    </section>
  </main>;
}

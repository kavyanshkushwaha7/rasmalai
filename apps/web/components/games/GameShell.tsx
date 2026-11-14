import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Grid2X2 } from "lucide-react";
import { Brand } from "@/components/Brand";
import { GameDecor } from "@/components/games/GameDecor";

export function GameShell({ title, eyebrow, theme, children }: { title: string; eyebrow: string; theme: "ludo" | "snakes" | "tic"; children: ReactNode }) {
  return (
    <main className={`local-game-page local-game-page--${theme}`}>
      <div className={`game-backdrop game-backdrop--${theme}`} aria-hidden="true" />
      <header className="local-game-header">
        <Brand light />
        <nav aria-label="Game navigation">
          <a href="/games"><Grid2X2 size={16} /> All games</a>
          <Link href="/playground"><ArrowLeft size={16} /> Playground</Link>
        </nav>
      </header>
      <div className="local-game-content">
        <div className={`game-hero game-hero--${theme}`}>
          <div className="game-hero-copy"><span className="eyebrow"><span className="eyebrow-dot" /> {eyebrow}</span><h1>{title}</h1></div>
          <GameDecor theme={theme} />
        </div>
        {children}
        <p className="offline-note"><span aria-hidden="true">●</span> Local pass-and-play · moves stay on this device</p>
      </div>
    </main>
  );
}

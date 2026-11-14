import type { Metadata } from "next";
import { GameShell } from "@/components/games/GameShell";
import { SnakesAndLaddersGame } from "@/components/games/SnakesAndLaddersGame";

export const metadata: Metadata = { title: "Snakes & Ladders" };

export default function SnakesAndLaddersPage() {
  return <GameShell title="Snakes & Ladders" eyebrow="WILD RIDE · 2–4 PLAYERS" theme="snakes"><SnakesAndLaddersGame /></GameShell>;
}

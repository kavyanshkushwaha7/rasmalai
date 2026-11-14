import type { Metadata } from "next";
import { GameShell } from "@/components/games/GameShell";
import { LudoGame } from "@/components/games/LudoGame";

export const metadata: Metadata = { title: "Ludo" };

export default function LudoPage() {
  return <GameShell title="Ludo" eyebrow="THE CLASSIC · 2–4 PLAYERS" theme="ludo"><LudoGame /></GameShell>;
}

import type { Metadata } from "next";
import { GameShell } from "@/components/games/GameShell";
import { TicTacToeGame } from "@/components/games/TicTacToeGame";

export const metadata: Metadata = { title: "Tic Tac Toe" };

export default function TicTacToePage() {
  return <GameShell title="Tic Tac Toe" eyebrow="QUICK PLAY · 2 PLAYERS" theme="tic"><TicTacToeGame /></GameShell>;
}

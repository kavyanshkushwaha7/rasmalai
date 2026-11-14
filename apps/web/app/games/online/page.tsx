import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isDatabaseConfigured } from "@rasmalai/database";
import { isFeatureFlagEnabled } from "@rasmalai/game-engine/feature-flags";
import { OnlineGameLobby } from "@/components/games/OnlineGameLobby";
import { requireSocialContext } from "@/lib/social-data";

export const metadata: Metadata = { title: "Play online" };

export default async function OnlineGamesPage() {
  await requireSocialContext();
  if (!isDatabaseConfigured()) redirect("/profile/setup?database=missing");
  return <OnlineGameLobby spectatorModeEnabled={isFeatureFlagEnabled(process.env.SPECTATOR_MODE_ENABLED)} />;
}

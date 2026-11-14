import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSocialContext } from "@/lib/social-data";
import { isFeatureFlagEnabled } from "@rasmalai/game-engine/feature-flags";
import { OnlineGameRoom } from "@/components/games/OnlineGameRoom";

export const metadata: Metadata = { title: "Online game room" };
const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function OnlineGameRoomPage({ params }: PageProps<"/games/online/[roomId]">) {
  const { roomId } = await params;
  if (!ROOM_ID.test(roomId)) notFound();
  const auth = await requireSocialContext();
  return <OnlineGameRoom roomId={roomId} userId={auth.user.id} spectatorModeEnabled={isFeatureFlagEnabled(process.env.SPECTATOR_MODE_ENABLED)} />;
}

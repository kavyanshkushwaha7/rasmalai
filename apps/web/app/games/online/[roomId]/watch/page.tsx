import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSocialContext } from "@/lib/social-data";
import { OnlineSpectatorRoom } from "@/components/games/OnlineSpectatorRoom";
import { OnlineShell } from "@/components/games/OnlineShell";
import { isFeatureFlagEnabled, SPECTATOR_MODE_DISABLED_MESSAGE } from "@rasmalai/game-engine/feature-flags";

export const metadata: Metadata = { title: "Watch live match" };
const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function OnlineSpectatorPage({ params }: PageProps<"/games/online/[roomId]/watch">) {
  const { roomId } = await params;
  if (!ROOM_ID.test(roomId)) notFound();
  if (!isFeatureFlagEnabled(process.env.SPECTATOR_MODE_ENABLED)) {
    return <OnlineShell><section className="online-room-loading spectator-gate"><span className="eyebrow">RASMALAI ONLINE</span><h1>{SPECTATOR_MODE_DISABLED_MESSAGE}</h1><p>Live spectating is temporarily unavailable. Your game rooms and player features are unchanged.</p><Link className="button button--soft" href="/games/online"><ArrowLeft size={15} /> Back to online games</Link></section></OnlineShell>;
  }
  const auth = await requireSocialContext();
  return <OnlineSpectatorRoom roomId={roomId} userId={auth.user.id} />;
}

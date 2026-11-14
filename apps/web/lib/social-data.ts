import "server-only";

import { isDatabaseConfigured, withAuthenticatedUser } from "@rasmalai/database";
import { redirect } from "next/navigation";
import { isFeatureFlagEnabled } from "@rasmalai/game-engine/feature-flags";
import { getAuthenticatedUserContext } from "@/lib/supabase/server";
import { visibleUnreadNotificationCount } from "@/lib/spectator-ui";

type SocialAuth = NonNullable<Awaited<ReturnType<typeof getAuthenticatedUserContext>>>;

export const publicProfileFields = {
  id: true,
  username: true,
  nickname: true,
  avatarUrl: true,
  avatarPath: true,
  gamesPlayed: true,
  wins: true,
} as const;

export async function requireSocialContext() {
  const auth = await getAuthenticatedUserContext();
  if (!auth) redirect("/login");
  if (!isDatabaseConfigured()) redirect("/profile/setup?database=missing");
  const profile = await withAuthenticatedUser(auth.accessToken, (db) =>
    db.profile.findUnique({ where: { id: auth.user.id }, select: publicProfileFields }),
  );
  if (!profile) redirect("/profile/setup");
  return { ...auth, profile };
}

export type SocialContext = Awaited<ReturnType<typeof requireSocialContext>>;

export function getPublicAvatarUrl(
  auth: Pick<SocialAuth, "supabase">,
  profile: { avatarPath: string | null; avatarUrl: string | null },
) {
  return profile.avatarPath
    ? auth.supabase.storage.from("profile-avatars").getPublicUrl(profile.avatarPath).data.publicUrl
    : profile.avatarUrl;
}

export async function getSocialUnreadCounts(accessToken: string) {
  const spectatorModeEnabled = isFeatureFlagEnabled(process.env.SPECTATOR_MODE_ENABLED);
  const counts = await withAuthenticatedUser(accessToken, async (db) => {
    const rows = await db.$queryRaw<Array<{ message_unread_count: bigint; notification_unread_count: bigint }>>`
      SELECT * FROM public.rasmalai_social_unread_counts()
    `;
    const unread = rows[0];
    let hiddenSpectatorInvites = BigInt(0);
    if (!spectatorModeEnabled) {
      const hidden = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM public.notifications
        WHERE recipient_id = auth.uid()
          AND read_at IS NULL
          AND type = 'GAME_INVITE'
          AND payload ->> 'invite_kind' = 'SPECTATOR'
      `;
      hiddenSpectatorInvites = hidden[0]?.count ?? BigInt(0);
    }
    return {
      messages: Number(unread?.message_unread_count ?? 0),
      notifications: visibleUnreadNotificationCount(
        Number(unread?.notification_unread_count ?? 0),
        Number(hiddenSpectatorInvites),
        spectatorModeEnabled,
      ),
    };
  });
  return {
    messages: counts.messages,
    notifications: counts.notifications,
  };
}

export async function getSocialHeaderData(auth: SocialContext) {
  let unread = { messages: 0, notifications: 0 };
  try {
    unread = await getSocialUnreadCounts(auth.accessToken);
  } catch {
    // Keep the Phase 1 Playground usable while the Phase 2 migration is pending.
  }
  return {
    nickname: auth.profile.nickname,
    avatarUrl: getPublicAvatarUrl(auth, auth.profile),
    unreadMessages: unread.messages,
    unreadNotifications: unread.notifications,
  };
}

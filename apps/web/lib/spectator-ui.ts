/** Keep disabled spectator invitations out of launch-visible unread badges. */
export function visibleUnreadNotificationCount(
  unreadNotifications: number,
  unreadSpectatorInvites: number,
  spectatorModeEnabled: boolean,
) {
  if (spectatorModeEnabled) return unreadNotifications;
  return Math.max(0, unreadNotifications - unreadSpectatorInvites);
}

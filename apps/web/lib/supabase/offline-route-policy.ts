const OFFLINE_GAME_ROUTES = new Set([
  "/games",
  "/games/ludo",
  "/games/tic-tac-toe",
  "/games/snakes-and-ladders",
]);

/** Keep offline-only pages independent of Supabase, while allowing protected
 * online game routes to refresh their SSR auth cookies through the proxy. */
export function isOfflineGameRoute(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return OFFLINE_GAME_ROUTES.has(normalized);
}

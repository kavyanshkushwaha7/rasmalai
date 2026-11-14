export type RealtimeAuthSession = { access_token: string };
type SessionReadResult = {
  data: { session: RealtimeAuthSession | null };
  error: unknown | null;
};

/**
 * Keeps the game socket in step with Supabase without turning a temporary
 * session-read failure into a local sign-out. Revision checks discard a stale
 * foreground read if an auth event (for example TOKEN_REFRESHED) wins the race.
 */
export function createRealtimeAuthSessionSync(options: {
  onSession: (session: RealtimeAuthSession) => void;
  onSignedOut: () => void;
  onTemporaryError: () => void;
}) {
  let active = true;
  let revision = 0;

  return {
    onAuthStateChange(event: string, session: RealtimeAuthSession | null) {
      revision += 1;
      if (event === "SIGNED_OUT") {
        options.onSignedOut();
        return;
      }
      if (session?.access_token) options.onSession(session);
    },

    async sync(readSession: () => Promise<SessionReadResult>) {
      const readRevision = revision;
      let result: SessionReadResult;
      try {
        result = await readSession();
      } catch {
        if (active && readRevision === revision) options.onTemporaryError();
        return;
      }

      if (!active || readRevision !== revision) return;
      if (result.error) {
        options.onTemporaryError();
        return;
      }
      if (result.data.session?.access_token) options.onSession(result.data.session);
      else options.onSignedOut();
    },

    dispose() {
      active = false;
      revision += 1;
    },
  };
}

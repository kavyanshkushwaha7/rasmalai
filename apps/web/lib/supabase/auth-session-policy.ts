type ErrorShape = {
  name?: unknown;
  code?: unknown;
};

const terminalAuthCodes = new Set([
  "bad_jwt",
  "no_authorization",
  "session_expired",
  "session_not_found",
  "user_banned",
  "user_not_found",
]);

function errorShape(error: unknown): ErrorShape {
  return typeof error === "object" && error !== null ? error as ErrorShape : {};
}

/**
 * Only errors that prove the stored session is absent, expired, revoked, or
 * invalid may be treated as signed out. Unknown/Auth API failures are kept
 * distinct from authentication failure so a transient outage cannot redirect
 * an otherwise valid player to login.
 */
export function isDefinitiveAuthFailure(error: unknown): boolean {
  const { name, code } = errorShape(error);
  return name === "AuthSessionMissingError" ||
    (name === "AuthApiError" && typeof code === "string" && terminalAuthCodes.has(code));
}

export class AuthVerificationUnavailableError extends Error {
  constructor() {
    super("Sign-in could not be verified temporarily. Retry the request.");
    this.name = "AuthVerificationUnavailableError";
  }
}

type UserLike = { id: string };
type SessionLike = { access_token: string; user: { id: string } };

/**
 * Resolve a verified Supabase user and the matching bearer session. The user
 * identity always comes from getUser(); getSession() supplies only the token
 * used for RLS-scoped database work.
 */
export async function readVerifiedAuthContext<
  User extends UserLike,
  Session extends SessionLike,
>(
  readUser: () => Promise<{ user: User | null; error: unknown | null }>,
  readSession: () => Promise<{ session: Session | null; error?: unknown | null }>,
): Promise<{ user: User; accessToken: string } | null> {
  let userResult: { user: User | null; error: unknown | null };
  try {
    userResult = await readUser();
  } catch (error) {
    if (isDefinitiveAuthFailure(error)) return null;
    return await handleUnverifiedUserFailure(readSession);
  }

  if (userResult.error) {
    if (isDefinitiveAuthFailure(userResult.error)) return null;
    return await handleUnverifiedUserFailure(readSession);
  }
  if (!userResult.user) return null;

  let sessionResult: { session: Session | null; error?: unknown | null };
  try {
    sessionResult = await readSession();
  } catch (error) {
    if (isDefinitiveAuthFailure(error)) return null;
    throw new AuthVerificationUnavailableError();
  }

  if (sessionResult.error) {
    if (isDefinitiveAuthFailure(sessionResult.error)) return null;
    throw new AuthVerificationUnavailableError();
  }

  const session = sessionResult.session;
  if (!session?.access_token || session.user.id !== userResult.user.id) return null;
  return { user: userResult.user, accessToken: session.access_token };
}

async function handleUnverifiedUserFailure<Session extends SessionLike>(
  readSession: () => Promise<{ session: Session | null; error?: unknown | null }>,
): Promise<null> {
  let sessionResult: { session: Session | null; error?: unknown | null };
  try {
    sessionResult = await readSession();
  } catch (sessionError) {
    if (isDefinitiveAuthFailure(sessionError)) return null;
    throw new AuthVerificationUnavailableError();
  }

  if (sessionResult.error) {
    if (isDefinitiveAuthFailure(sessionResult.error)) return null;
    throw new AuthVerificationUnavailableError();
  }
  if (!sessionResult.session) return null;

  // A stored token by itself is not trusted as a user identity. Keep the page
  // retryable until getUser can verify it, even when a refresh-token race or
  // provider outage leaves a session object in cookie storage.
  throw new AuthVerificationUnavailableError();
}

export type AuthBetaMode = "email-password" | "invite-only-google" | "disabled";

export type AuthBetaConfig = {
  mode: AuthBetaMode;
  googleOAuthEnabled: boolean;
  allowedEmails: ReadonlySet<string>;
};

export type VerifiedAuthUser = {
  email?: unknown;
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
  app_metadata?: { provider?: unknown; providers?: unknown } | null;
  identities?: Array<{ provider?: unknown }> | null;
};

export function readAuthBetaConfig(environment: Record<string, string | undefined> = process.env): AuthBetaConfig {
  const rawMode = environment.AUTH_BETA_MODE?.trim();
  const mode: AuthBetaMode = rawMode === undefined || rawMode === "" || rawMode === "email-password"
    ? "email-password"
    : rawMode === "invite-only-google" || rawMode === "disabled"
      ? rawMode
      : "disabled";
  const allowedEmails = new Set((environment.BETA_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));

  return {
    mode,
    googleOAuthEnabled: environment.GOOGLE_OAUTH_ENABLED?.trim().toLowerCase() === "true",
    allowedEmails,
  };
}

export function isGoogleOAuthAvailable(config: AuthBetaConfig): boolean {
  return config.mode !== "disabled" && config.googleOAuthEnabled &&
    (config.mode !== "invite-only-google" || config.allowedEmails.size > 0);
}

export function isPasswordAuthAvailable(config: AuthBetaConfig): boolean {
  return config.mode === "email-password";
}

function hasVerifiedGoogleIdentity(user: VerifiedAuthUser): boolean {
  const appMetadata = user.app_metadata;
  const appProvider = appMetadata?.provider;
  const appProviders = appMetadata?.providers;
  const providers = Array.isArray(appProviders) ? appProviders : [];
  const identities = Array.isArray(user.identities) ? user.identities : [];
  return appProvider === "google" || providers.includes("google") || identities.some((identity) => identity.provider === "google");
}

export function isAuthUserAllowed(user: VerifiedAuthUser, config: AuthBetaConfig): boolean {
  if (config.mode === "email-password") return true;
  if (config.mode !== "invite-only-google" || !isGoogleOAuthAvailable(config)) return false;
  if (typeof user.email !== "string" || !user.email_confirmed_at && !user.confirmed_at) return false;
  if (!hasVerifiedGoogleIdentity(user)) return false;
  return config.allowedEmails.has(user.email.trim().toLowerCase());
}

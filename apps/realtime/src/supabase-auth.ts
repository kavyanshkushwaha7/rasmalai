const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VerifiedRealtimeUser = { id: string };
export type AccessTokenVerifier = (accessToken: string) => Promise<VerifiedRealtimeUser | null>;

export async function verifySupabaseAccessToken(accessToken: string, fetcher: typeof fetch = fetch): Promise<VerifiedRealtimeUser | null> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || typeof accessToken !== "string" || accessToken.trim().length < 20) return null;

  try {
    const response = await fetcher(new URL("/auth/v1/user", url), {
      headers: { apikey: key, authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const user: unknown = await response.json();
    if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string" || !UUID_PATTERN.test(user.id)) return null;
    return { id: user.id };
  } catch {
    return null;
  }
}

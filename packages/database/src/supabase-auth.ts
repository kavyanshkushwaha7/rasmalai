const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Resolve an access token through Supabase Auth; never treat a supplied UUID as identity. */
export async function getVerifiedSupabaseUserId(accessToken: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase Auth is required to establish a database identity.");
  if (typeof accessToken !== "string" || accessToken.trim().length < 20) {
    throw new Error("A Supabase access token is required for profile access.");
  }

  let response: Response;
  try {
    response = await fetch(new URL("/auth/v1/user", url), {
      method: "GET",
      headers: {
        apikey: key,
        authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
  } catch {
    throw new Error("Supabase Auth could not verify the access token.");
  }

  if (!response.ok) throw new Error("Supabase Auth rejected the access token.");
  const user: unknown = await response.json();
  if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string" || !UUID_PATTERN.test(user.id)) {
    throw new Error("Supabase Auth returned an invalid user identity.");
  }
  return user.id;
}

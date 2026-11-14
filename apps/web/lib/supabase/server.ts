import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readVerifiedAuthContext } from "./auth-session-policy";
import { getSupabaseCookieOptions } from "./cookie-options";

export const isSupabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase Auth is not configured. Add the public URL and publishable key to .env.local.");

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookieOptions: getSupabaseCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. The proxy refreshes sessions on requests.
        }
      },
    },
  });
}

export async function getAuthenticatedUser() {
  const context = await getAuthenticatedUserContext();
  return context?.user ?? null;
}

export async function getAuthenticatedUserContext() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const identity = await readVerifiedAuthContext(
    async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      return { user, error };
    },
    async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      return { session, error };
    },
  );
  if (!identity) return null;
  return { supabase, ...identity };
}

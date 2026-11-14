import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isOfflineGameRoute } from "@/lib/supabase/offline-route-policy";
import { getSupabaseCookieOptions } from "@/lib/supabase/cookie-options";

export async function proxy(request: NextRequest) {
  // Offline/local game pages stay independent of Supabase. Online games still
  // pass through here so Supabase SSR can refresh cookies before server auth.
  if (isOfflineGameRoute(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookieOptions: getSupabaseCookieOptions(request.nextUrl.origin),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  try {
    // Supabase SSR refreshes cookie-backed sessions here. A temporary auth
    // network error must not fail the navigation or clear the existing cookies;
    // protected pages will distinguish it from a revoked session below.
    await supabase.auth.getUser();
  } catch {
    // Keep the response and request cookies intact during an auth outage.
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)"],
};

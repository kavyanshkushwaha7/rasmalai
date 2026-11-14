import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeAuthCallbackPath } from "@/lib/supabase/auth-callback-redirect";

function redirectToSameOriginPath(path: string) {
  // A relative Location preserves the browser's public origin behind a proxy;
  // request.url can otherwise reflect the internal 0.0.0.0 listener address.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/playground";
  const safePath = getSafeAuthCallbackPath(next, request.url);

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectToSameOriginPath(safePath);
  }

  return redirectToSameOriginPath("/login?auth=link-expired");
}

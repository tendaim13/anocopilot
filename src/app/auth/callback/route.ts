import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const config = getSupabasePublicConfig();
  const requestUrl = new URL(request.url);
  const requestedNext = requestUrl.searchParams.get("next");
  const destination = requestedNext?.startsWith("/") ? requestedNext : "/";

  if (!config) {
    return NextResponse.redirect(new URL("/login?error=configuration", requestUrl.origin));
  }

  const response = NextResponse.redirect(new URL(destination, requestUrl.origin));
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const code = requestUrl.searchParams.get("code");
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }

  return NextResponse.redirect(new URL("/login?error=callback", requestUrl.origin));
}

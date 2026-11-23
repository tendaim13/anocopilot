import { createServerClient } from "@supabase/ssr";
import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { safeRedirectPath } from "@/lib/ano/workspace-auth";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

const SUPPORTED_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email",
]);

export async function GET(request: NextRequest) {
  const config = getSupabasePublicConfig();
  const requestUrl = new URL(request.url);
  const destination = safeRedirectPath(requestUrl.searchParams.get("next"), "/research");

  if (!config) {
    return NextResponse.redirect(new URL("/login?error=configuration", requestUrl.origin));
  }

  const pendingCookies: Array<{
    name: string;
    value: string;
    options?: Parameters<NextResponse["cookies"]["set"]>[2];
  }> = [];

  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach((entry) => pendingCookies.push(entry));
      },
    },
  });

  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = requestUrl.searchParams.get("type");

  let authSucceeded = false;
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    authSucceeded = !error;
  } else if (
    tokenHash &&
    otpType &&
    SUPPORTED_OTP_TYPES.has(otpType as EmailOtpType)
  ) {
    const { error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType as EmailOtpType,
    });
    authSucceeded = !error;
  }

  if (!authSucceeded) {
    return NextResponse.redirect(new URL("/login?error=callback", requestUrl.origin));
  }

  let finalDestination = destination;
  if (
    !destination.startsWith("/invite/") &&
    !destination.startsWith("/onboarding")
  ) {
    const { data: userData } = await client.auth.getUser();
    if (userData.user) {
      const { data: memberships } = await client
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userData.user.id)
        .limit(1);
      if (!memberships || memberships.length === 0) {
        finalDestination = "/onboarding";
      }
    }
  }

  const response = NextResponse.redirect(new URL(finalDestination, requestUrl.origin));
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  return response;
}

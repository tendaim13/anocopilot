export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

/**
 * Ano deliberately reads only public Supabase configuration in shared code.
 * Service-role credentials remain server-only and are never needed by the app
 * runtime because row-level security is enforced with the signed-in session.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

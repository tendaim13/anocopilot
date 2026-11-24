# Ano private SearXNG gateway

This bundle runs private SearXNG search discovery for Ano. It does not fetch
research pages, keep Ano/Supabase/Bedrock credentials, or accept unauthenticated
searches. Ano owns source retrieval and stores only short evidence excerpts.

## Before first deployment

1. Create a DNS name such as `search.your-domain.com` and point its A record to
   the EC2 public IP. DNS needs to resolve before Caddy can obtain a certificate.
2. Allow TCP 80 and 443 to the host only for certificate issuance and HTTPS.
   SSH access is separate from the search gateway.
3. On EC2, copy `.env.example` to `.env`. Generate `SEARXNG_SECRET` and
   `SEARXNG_GATEWAY_TOKEN` on the host, and add `BRAVE_API_KEY` from your Brave
   Search API account; never add them to Git, browser env, or `NEXT_PUBLIC_*`.
4. Resolve immutable image digests on the host and put those digests in `.env`.
   This avoids unreviewed changes from a moving `latest` image tag.

## Service boundary

- Caddy is the only service with published ports. `/healthz` and `/search` both
  require `X-Ano-Gateway-Token`. Caddy receives only `ACME_EMAIL`,
  `SEARXNG_DOMAIN`, and `SEARXNG_GATEWAY_TOKEN` — never `BRAVE_API_KEY` or
  `SEARXNG_SECRET`.
- Caddy strips `X-Ano-Gateway-Token` before proxying to SearXNG.
- SearXNG has no published host port. It shares an internal Docker network with
  Caddy for proxying and a dedicated egress-only bridge used only to reach its
  configured search engines. Valkey stays on the internal network only.
- `render-settings-entrypoint.sh` injects `BRAVE_API_KEY` into a private
  `tmpfs` `/tmp/searxng/settings.yml` at container boot and fails closed if
  `BRAVE_API_KEY` is missing.
- SearXNG's public bot/API limiter is deliberately disabled. Caddy token
  authentication plus Ano's explicit approval, bounded search/fetch budgets,
  durable action claims, and no-retry policy are the effective controls.
- The engine allow-list is **Brave Search API (`braveapi`)**, Bing, Mojeek,
  and Wikipedia. DuckDuckGo and Google scraping are disabled.

## Activation checks

After `docker compose up -d`, run Ano's authenticated smoke check against the
gateway before wiring `SEARXNG_BASE_URL` and `SEARXNG_GATEWAY_TOKEN` into Ano:

```bash
npm run smoke:searxng
```

Do not point Ano at the gateway until unauthenticated `/healthz` returns `401`,
authenticated `/healthz` returns `200 ok`, and an authenticated `/search` query
returns valid non-DuckDuckGo JSON results over HTTPS.

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
   `SEARXNG_GATEWAY_TOKEN` on the host; never add them to Git or a browser value.
4. Resolve immutable image digests on the host and put those digests in `.env`.
   This avoids unreviewed changes from a moving `latest` image tag.

## Service boundary

- Caddy is the only service with published ports. `/healthz` and `/search` both
  require `X-Ano-Gateway-Token`.
- Caddy strips that token before proxying to SearXNG.
- SearXNG has no published host port. It shares an internal Docker network with
  Caddy for proxying and a dedicated egress-only bridge used only to reach its
  configured search engines. Valkey stays on the internal network only.
- SearXNG's public bot/API limiter is deliberately disabled. It has a default
  four-JSON-searches-per-IP-per-hour quota that is unsuitable for Ano's
  authenticated machine-to-machine gateway. Caddy authentication plus Ano's
  explicit approval, 12-search/30-fetch ceilings, durable action claims, and
  no-retry policy are the effective controls.
- The initial engine allow-list is Bing, DuckDuckGo, Mojeek, and Wikipedia.
  It is intentionally small and excludes Google scraping by default.

## Activation checks

After `docker compose up -d`, the operator must first check the authenticated
health endpoint. Do not add `SEARXNG_BASE_URL` or `SEARXNG_GATEWAY_TOKEN` to
Ano until the TLS certificate, the authenticated health endpoint, and one
manually approved, single-query SearXNG smoke check have succeeded.

Ano will then use `https://<your-domain>` as `SEARXNG_BASE_URL`. It must never
use a raw EC2 IP or an unauthenticated HTTP endpoint.

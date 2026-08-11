# BLOCKED — portal custom CNAME domains (BUILD-45 P-5, deliberately deferred)

**Decision taken this build (P-5): tenant resolution is path-based on the
existing domain** — `stewardapp.dev/portal/{org-slug}` — with the portal API
reached same-origin through the vercel.json `/portal-api/*` proxy so the
HttpOnly SameSite=Lax session cookie flows first-party. Custom domains
(`give.foodbank.org` CNAME'd at the org's registrar) are OUT OF SCOPE per the
brief; this file is the TLS-provisioning plan for later.

## Why path-based won for v1

- Wildcard subdomains (`{slug}.give.stewardapp.dev`) on Vercel require a
  wildcard domain + either middleware-based tenant routing or a per-tenant
  project — neither expressible in the current static-SPA + `vercel.json`
  setup without restructuring the deploy.
- Cookies: path-based keeps ONE first-party cookie domain with zero
  cross-site complications. Per-tenant hosts would each need their own
  session cookie scope (fine, but more moving parts on a money surface).
- White-label cost is small: the page itself carries only the org's identity;
  the URL is the one Steward-shaped thing a donor sees (and "Powered by
  Steward" stays off by default).

## The plan for custom CNAME domains (when scheduled)

1. **Model**: `portal_settings.custom_domain TEXT UNIQUE` + verification
   token column. Org admin enters `give.foodbank.org` in Settings › Donor
   Portal; Steward shows the DNS instructions (CNAME → the portal edge).
2. **TLS provisioning — two viable paths**:
   - *Vercel-managed*: add each custom domain to the Vercel project via the
     Domains API (`POST /v9/projects/{id}/domains`); Vercel issues and renews
     the Let's Encrypt cert automatically once the CNAME resolves. Needs a
     Vercel API token in the backend and a small domain-sync job
     (add/verify/remove on settings change). This is the cheap path and the
     recommended one while the SPA lives on Vercel.
   - *Self-terminated*: a thin edge (Caddy/Traefik on Railway, or Cloudflare
     for SaaS) doing on-demand ACME per SNI hostname. More control, more ops.
3. **Tenant resolution**: a request arriving on a custom host maps
   host → org (one indexed lookup on `portal_settings.custom_domain`),
   overriding the path slug; the session cookie becomes host-scoped
   automatically (each custom domain gets its own first-party cookie).
   `requirePortalSession`'s org-pinning check needs no change — the session
   row already stores org_id.
4. **Hard rules carried over**: HSTS on the custom hosts; the magic-link
   email's link must use the org's custom domain when set (extend
   `publicAppUrl` usage in `sendPortalMagicLinkEmail` with a per-org
   resolver); the Vercel `/portal-api` proxy must be mirrored on the custom
   domain (Vercel rewrites apply per-project, so a project-level domain gets
   them for free).
5. **Verification before serving**: never serve org content on a hostname
   until the org proved DNS control (TXT record or the CNAME itself
   resolving to us) — otherwise org A could claim org B's domain.

Estimated effort: 1–2 days with the Vercel-managed path, dominated by the
domain-sync lifecycle (add/verify/retry/remove) and the email-link resolver.

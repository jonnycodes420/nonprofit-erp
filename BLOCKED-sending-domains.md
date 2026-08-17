# BLOCKED — per-org sending domains (SPF / DKIM)

_Scoped in BUILD-64 Part 2, not built. The "Now" half of sender identity — the
org's **display name** in the `From` — shipped this build (`donorFromAddress`).
This is the larger, deferred half._

## What's shipped now
Every donor-facing email is `From: "<Org display name> <noreply@stewardapp.dev>"`.
The inbox shows "CREO Arts", not a bare unfamiliar domain. The **address** is
still the shared `stewardapp.dev` sending domain.

## What this file is about
Sending each org's transactional mail from **its own domain** (or a per-org
subdomain), authenticated with that org's SPF + DKIM, so the message is
cryptographically *from the org*, not just labelled with its name.

## Why it matters (the real reason — not cosmetics)
An unfamiliar sending domain costs **deliverability as well as trust**. A donor's
receipt or failed-card notice landing in spam is a support ticket the donor opens
**with the org**, blaming the org for "your email system is broken." On a shared
domain, one org's spam complaints also drag down every other org's reputation —
a noisy-neighbor problem that only grows with the network. Per-org authenticated
domains isolate reputation and put deliverability in each org's own hands.

## Why it's not built here
This is infrastructure, not a code change:
- **Domain provisioning + DNS.** Each org must add DKIM/SPF (and ideally DMARC)
  records to a domain they control, or accept a Steward-managed subdomain
  (`<org>.mail.stewardapp.dev`) whose records Steward publishes. Either way it's a
  per-org onboarding step with verification, not a deploy.
- **Resend domains API.** Sends must select the right verified domain per org
  (Resend supports multiple verified domains; the `from` domain must match a
  verified one or the send is rejected). That's a new per-org `sending_domain`
  column + verification state machine + a fallback to the shared domain while
  unverified.
- **Warm-up + monitoring.** A brand-new domain has no reputation; blasting a
  year-end statement run from a cold domain is worse than the shared domain.
  Needs volume ramp + bounce/complaint monitoring per domain.

## Shape of the eventual work
1. `orgs.sending_domain` (nullable) + `sending_domain_verified_at`; a Settings
   flow that calls Resend's create-domain, shows the DNS records to publish, and
   polls verification.
2. `donorFromAddress` (and the campaign/sequence `from`) select the org's
   verified domain when present, else fall back to `noreply@stewardapp.dev`
   (today's behavior) — so unverified orgs are never blocked from sending.
3. DMARC alignment + a per-domain suppression/bounce view.
4. Warm-up policy for a newly verified domain (cap daily volume, ramp).

Until then: shared domain + org display name (shipped). That closes the "bare
domain in the inbox" trust gap; it does **not** close the deliverability /
reputation-isolation gap, which is what this file tracks.

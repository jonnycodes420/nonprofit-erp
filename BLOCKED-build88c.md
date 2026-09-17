# BLOCKED — BUILD-88c

## 1. A REAL verified domain needs a real customer's DNS (C.1, expected)

The state machine, the refusals, the tenant wall and every header are proved in
`tests/build88c-domain.test.js` against a stubbed provider — 36 assertions,
including "no Steward domain in anything the recipient's inbox shows them".
What CANNOT be proved without a customer is the part that depends on DNS:

- that Resend's records, published on a domain somebody actually owns, verify;
- that mail signed with that DKIM key lands in an inbox rather than a spam
  folder, which is the whole reason the part exists.

**The demo org proves only the fallback.** `org_creo` has no domain it controls,
so the most it can show is that an unverified org sends on Steward's shared
domain with its own name on it and a Reply-To that reaches somebody — which is
worth having and is not the claim.

**What Jonathan and a founding partner have to do, once:** the five steps now on
the import call in `MANUAL-STEPS.md`. Fifteen minutes, one DNS panel. Until then
no org on Steward is verified and every send takes the fallback, which is
exactly today's behaviour.

## 2. The unsubscribe link still resolves on Steward's domain (C.1, named not fixed)

"No Steward domain visible to the recipient" holds for everything an inbox
SHOWS: the From, the Reply-To, the sender the client displays, and the
List-Unsubscribe mailto. Two things in the message body still point at Steward:

- the **unsubscribe link**, because Steward hosts the page that honours it;
- the **open-tracking pixel** on campaign mail (receipts carry none).

A recipient who reads the raw source, or hovers the unsubscribe link, sees
`stewardapp.dev`. Closing that means serving those two URLs from a domain the
org controls, which is the custom-domains work already tracked in
`BLOCKED-custom-domains.md` — a CNAME, a certificate and a router, not a header.
`steward-data-handling.md` says so plainly rather than letting a customer
discover it.

## 3. A defect this build found in a dependency contract, fixed here

The Resend SDK maps `payload.replyTo` onto the wire's `reply_to` and **ignores**
a `reply_to` key passed in. Three call sites in `server.js` were passing the
snake_case one, so they sent **no Reply-To at all** — including the founder's
onboarding drip to new staff. Every one is `replyTo` now, and donor-facing mail
gained a Reply-To it never had. Worth knowing when the SDK is next upgraded:
this is a silently-dropped field, not an error.

## 4. The walk's last step is Jonathan's (C.2, by construction)

`scripts/build88c-walk.js` runs everything the brief's walk asks for except the
inbox: it opens Communications, picks Appeal, presses "Send me a test", captures
the email that leaves, and reads it in a 390px browser (no sideways scroll,
nothing off the right edge, no body type under 14px, no merge braces). What it
cannot do is send to **jonathan@stewardapp.dev** and look at it on a phone — the
scratch stack's `RESEND_API_KEY` is a dummy and the mail lands in the local sink
on :5602. One press of "Send me a test" on prod, read on a real phone, closes it.

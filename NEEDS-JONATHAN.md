# Needs Jonathan

Everything in this file **physically requires you**: a credential, a password, a
real customer's file or token, a payment, or a legal signature. Nothing else
belongs here — every other open question has been decided and the decision is in
the commit that made it.

One line each, with the exact click or paste. Replaces 53 `BLOCKED-*.md` files
(deleted 2026-09-25); every item below was re-checked against production that
day, so several long-standing asks are gone because they turned out to be done.

Historical `audit/BUILD-NN-FINDINGS.md` documents still cite the old
`BLOCKED-*.md` filenames. Those are dated records of what was true when they
were written and have deliberately not been rewritten; the live pointers in
source, tests and CI all name this file instead.

**Checked and already done — do not redo:** `ANTHROPIC_API_KEY`,
`STEWARD_CREDENTIAL_KEY`, `FOUNDER_EMAIL`, the three live Stripe price ids
(`/health.billing` = live, ok, checked), and the Vercel deploy token
(`VERCEL_TOKEN` + `VERCEL_DEPLOY_ENABLED=true`, job green).

---

## 0-NOW · THE PROD DEMO RE-SEED, AFTER FIX-7 THROUGH INT-2 (2026-09-28)

The 28 September re-seed failed its shape assertion and FIX-7 found why: the
peer-to-peer block picked its twelve givers with an unordered `ORDER BY
created_at`, and on production that returned five of the eleven drifted donors,
each of whom then got a gift dated that week. It is deterministic now, and it
refuses outright if any story person is drawn into the 5K.

Run it when you are ready. It DROPS AND RECREATES `org_b72demo` and is safe to
run ten minutes before a call:

    DATABASE_URL=<prod> BASE=https://nonprofit-erp-production.up.railway.app \
      node scripts/seed-demo.js --i-know-this-is-prod

Afterwards Harborlight also has: six agent plans, one from each of the six
personas, none of them run (AGENTS-1); Stripe healthy, PayPal healthy and
Givebutter QUIET on the Connections screen (INT-1); Square connected with gala
and 5K takings, four buyers who have never given, one attendee drifting and one
unmapped item (INT-POS); and QuickBooks connected with its mapping finished,
Xero not connected (INT-2).

## 0-ZAPIER · THE APP IS PUSHED. FOUR THINGS ARE YOURS (2026-10-01)

Registered and pushed under `jonathan@stewardapp.dev`: **Steward**, app `247112`,
public audience, CRM category, version 1.0.0. `zapier-platform validate` has no
failures. What is left cannot be done from the CLI.

1. **Upload the logo.** Zapier wants a square PNG of at least 256x256 and the
   CLI cannot upload one. `client/public/android-chrome-512x512.png` is exactly
   right: 512x512, the cream S on ink. Developer Platform → the Steward
   integration → Manage → Branding.

2. **Say who gets the test invite.** The link below adds somebody to version
   1.0.0 without an email from us, so it can go in a message you send yourself:

       https://zapier.com/developer/public-invite/247112/514791/c29bca6ff6a02d168cfd8642e87685ea/

   To send Zapier's own invitation email instead, name the addresses and it is
   `npx zapier-platform-cli users:add <email>` from `zapier/`. Nobody has been
   emailed.

3. **Three users with live Zaps, and one live Zap per piece.** The App Directory
   will not take it without them (checks S001, S002, A001, T001-T005): three
   people other than you, each with a Zap that has run at least once, covering
   all three triggers and all three actions. That needs real Steward orgs with
   API keys, so it is a customer ask, not a code one.

4. **Two decisions, both warnings rather than blockers.**
   · **A fund dropdown** (D004) needs `GET /api/v1/funds` and a `read:funds`
     scope on the server. Today `fundId` is typed by hand, because the gifts
     endpoint returns a fund's name and not its id. Worth it, or leave it?
   · **The API host field** (D026) is what lets a self-hosted Steward connect.
     It is validated now (https only, no loopback, private, link-local or
     metadata address), but the check fires on the field existing at all. It
     clears for real only by deleting the field and pinning everyone to
     production. Does anybody self-host?

## 0-DEVELOPERS · THE PUBLIC API, AND WHAT IS NOT DONE YET (2026-09-30)

INT-5 gave API keys real permissions, a call log and rate limits, and added
signed webhooks out. **Nothing is needed from you for any of it**: no new
variables, no third party, no review. Existing keys keep working and gain no new
power.

What is NOT built yet, and is the first thing to pick up next:
  · **Donorbox.** BUILD-92 Track C never started, so there is no adapter to
    extend: it is a fresh build. Donorbox charges for API access (their Pro plan
    and above at the time of writing, so worth confirming the current price on
    their pricing page before an org is told). Until then TRANS-1's Donorbox CSV
    path is the honest fallback.
  · **The Zapier app** (`zapier/`) is now built, registered and pushed. What is
    left is in 0-ZAPIER above.
  · **The `/developers` page.** The API is real; there is nothing public
    documenting it yet.

## 0-INBOX · GMAIL AND OUTLOOK, AND WHAT EACH REVIEW NEEDS (2026-09-30)

INT-4 moved Gmail onto the same signed-state, sealed-token handshake every other
connection uses, and added Outlook beside it. Three things in the OLD Gmail
integration are fixed by that move and are worth knowing about, because they
were live: the state was the bare user id and unsigned, the tokens were stored
in plaintext, and it held a `gmail.send` scope this product must never use.

**Nothing is needed from you for the deploy itself.** `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` are already set, the old
`/gmail/callback` path still works as a forwarder, and existing connections are
sealed automatically on the first boot after this ships.

**Google, to go past 100 connected people.** Gmail read scopes are RESTRICTED.
  · The consent screen is **In production**, not Testing (corrected 2026-09-30;
    this entry said Testing). Publishing it is not the same as passing
    verification: unverified restricted scopes still show the "Google hasn't
    verified this app" screen and are capped at 100 users, which is plenty for
    CKRH and the next several customers.
  · Production needs OAuth app verification AND an independent security
    assessment (a CASA assessment through a Google-approved lab). It is a real
    cost and a several-week process, so it is worth starting only when the
    hundredth mailbox is in sight.
  · Steward now asks only for `gmail.readonly`, which is the narrowest scope
    that can read a body. Dropping `gmail.send` also removes the hardest part
    of that review to justify.

**Microsoft, for Outlook.**
  · Register an app at entra.microsoft.com → App registrations, multi-tenant
    ("Accounts in any organizational directory and personal Microsoft accounts").
  · Redirect URI, on the APP: `https://www.stewardapp.dev/oauth/microsoft/callback`
  · Railway variables: **`MICROSOFT_CLIENT_ID`**, **`MICROSOFT_CLIENT_SECRET`**,
    **`MICROSOFT_REDIRECT_URI`**.
  · Scopes Steward asks for and cannot widen: `Mail.Read`, `User.Read`,
    `offline_access`, `openid`, `email`. Nothing that sends.
  · Publisher verification is needed for the consent screen to stop warning
    people, and a customer whose own tenant requires admin consent will need
    their IT to approve Steward once.

**The BCC path, wired on 30 September and corrected by FIX-11 Part 5.** This
entry previously named the wrong route and the wrong authentication, and
described the adapter as done when it was not. What is true now:
  · The route is **`/inbound-email`**, not `/resend/inbound`. There is no
    `/resend/inbound`; `/resend/webhook` is the DELIVERY webhook and is a
    different thing.
  · It accepts **either** an Svix signature (`RESEND_WEBHOOK_SECRET`, already
    set for the delivery webhook) **or** the shared secret
    `INBOUND_EMAIL_SECRET`, sent as `?secret=…` in the webhook URL or as an
    `x-inbound-secret` header. FIX-11 Part 5 added the signature path, because
    a secret in a URL lands in every proxy log between Resend and here. A
    request that claims to be signed and is not is refused outright rather than
    falling through to the secret.
  · **The Resend adapter now exists, and it had to.** Resend nests the whole
    message under `data`, so the route's recipient lookup found nothing and
    every message would have been dropped as "no_org" with only the drop
    counter to show it. And Resend's webhook carries **no body at all** —
    metadata and an `email_id` only — so the body is a second call to
    `GET https://api.resend.com/emails/receiving/{id}` with the Resend API key.
    A message whose body cannot be fetched is stored nowhere rather than filed
    as a subject with an empty note.
  · Subdomain: `log.stewardapp.dev`, which carries no other mail. In
    Resend → Domains, add it for RECEIVING and use the MX record Resend shows
    for your account and region; it must be the lowest-priority MX there.
  · In Resend → Webhooks, point `email.received` at
    `https://nonprofit-erp-production.up.railway.app/inbound-email`.
  · Railway variables: **`INBOUND_EMAIL_ENABLED=1`**,
    **`INBOUND_EMAIL_DOMAIN=log.stewardapp.dev`** and
    **`INBOUND_EMAIL_SECRET`** (or rely on the Svix signature alone).
  · Each org BCCs `log+<org-slug>@log.stewardapp.dev`, and that address is now
    shown to every staff member on Settings → Account with a copy button. It is
    ONE address per organisation: Steward knows which staff member sent a
    message because the sender has to be one of its users.
  · BCC logging is per organisation (`orgs.inbound_email_enabled`), on by
    default and **off for the demo org**, whose people are fictional.

## 0-EMAIL · THE TWO EMAIL TOOLS NEED THEIR APPS REGISTERED (2026-09-30)

INT-3 built both sides of Mailchimp and Constant Contact: the audience sync out,
the campaign activity and unsubscribes back in, the webhook, and the daily pull.
Each Connect button is greyed out and names the variable it is missing until the
app exists. Nothing about an org's own mail changes: Steward still never sends a
newsletter.

**Mailchimp** (a free account is enough to test).
  · Register an app: Mailchimp account → Extras → Registered apps → Register an app.
  · Redirect URI, on the APP and not the API, exactly:
    `https://www.stewardapp.dev/oauth/mailchimp/callback`
  · Railway variables: **`MAILCHIMP_CLIENT_ID`**, **`MAILCHIMP_CLIENT_SECRET`**,
    **`MAILCHIMP_REDIRECT_URI`** (set it to the URI above).
  · No app review, and no scopes to choose: Mailchimp grants a whole account and
    offers nothing narrower. The card says that plainly rather than implying
    Steward asked for less.
  · The webhook needs nothing from you. Steward mints a per-org secret when the
    connection is made and registers the URL itself.

**Constant Contact** (a developer account, free).
  · developer.constantcontact.com → My Applications → New Application, and choose
    the confidential ("Server") flow so it is issued a client secret.
  · Redirect URI, exactly: `https://www.stewardapp.dev/oauth/constantcontact/callback`
  · Railway variables: **`CONSTANT_CONTACT_CLIENT_ID`**,
    **`CONSTANT_CONTACT_CLIENT_SECRET`**, **`CONSTANT_CONTACT_REDIRECT_URI`**.
  · Scopes Steward asks for and cannot widen: `contact_data`, `campaign_data`,
    `offline_access`. Nothing there can send a campaign.
  · No app review for a developer account. Constant Contact has no webhook for
    contact changes, so unsubscribes arrive on the daily pull instead of the same
    day, and the card says so.

Neither is needed for the demo: Harborlight shows Mailchimp connected with three
campaigns and holds no credentials at all.

## 0-OAUTH · THE CONNECT BUTTONS WORK NOW, AND THE REDIRECT URI IS THE APP (2026-09-29)

INT-OAUTH built the handshake the three builds below were waiting for. Pressing
**Connect** now opens the provider's real consent screen, and Steward stores the
tokens encrypted. Nothing else about the list below changed: without the
credentials, each button is greyed out and says in its own words which variable
is missing.

**The one thing easy to get wrong when you register each app.** The redirect URI
is on the **app**, not the API:

    https://www.stewardapp.dev/oauth/xero/callback
    https://www.stewardapp.dev/oauth/intuit/callback
    https://www.stewardapp.dev/oauth/square/callback

That is deliberate. A provider's redirect is a plain browser navigation carrying
no session, and a GET may not write; landing on the app means there is a
signed-in admin for the server to check the state against, which is what makes a
forwarded or replayed callback connect nothing. If you register the API host by
mistake it still works: that URL forwards to the app and stores nothing itself.

Two more, both optional: **`APP_URL`** on Railway if the app ever moves off
`www.stewardapp.dev`, and `*_API_BASE` only to point a provider at its sandbox
(a connected org now reaches the real API without one).

What Steward will ask each provider for is fixed in `shared/oauth.js` and a
request cannot widen it. Square is **five read-only scopes** and nothing with
WRITE in its name. Xero is `accounting.transactions` plus
`accounting.settings.read`, which cannot read a contact or a bank feed.

## 0-KEYS · THE DEVELOPER ACCOUNTS THESE THREE BUILDS WAIT ON (2026-09-28)

Everything downstream of each token is built, tested and merged. What is
missing in every case is an account only you can open.

**PayPal** (INT-1). The webhook receiver is live and its signature verification
is proven against forged requests. To turn it on:
  · a REST app on your live PayPal account with a webhook subscribed to
    `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`,
    `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED`,
    `BILLING.SUBSCRIPTION.CANCELLED` and `BILLING.SUBSCRIPTION.PAYMENT.FAILED`,
    pointed at `https://nonprofit-erp-production.up.railway.app/paypal/webhook`
  · Railway variable: **`PAYPAL_WEBHOOK_ID`** (the webhook's id, not a secret)
  · native OAuth onboarding ("Log in with PayPal" / Partner Referrals) needs an
    approved PayPal **partner** account, which is an application and a review.
    Until then an org connects with its own client id and secret, which works.

**Square** (INT-POS). The item mapping, the classification and every signal are
finished and exercised. To read a real register:
  · a Square developer account and an application, with read-only scopes:
    `PAYMENTS_READ`, `ORDERS_READ`, `ITEMS_READ`, `CUSTOMERS_READ`,
    `MERCHANT_PROFILE_READ`
  · Railway variables: **`SQUARE_APP_ID`**, **`SQUARE_APP_SECRET`**,
    **`SQUARE_WEBHOOK_SIGNATURE_KEY`**
  · Square reviews an application before production OAuth is enabled.

**Toast** (INT-POS). Toast's API is behind their partner programme. Steward
ships Toast as a file import today, which is the truth rather than a
placeholder, and the mapping and signals are identical either way. To apply:
Toast Partner Connect, "Integration Partner", which asks for a company, an
integration description and a review. Until it is approved there is nothing to
paste and nothing is waiting on it.

**Intuit / QuickBooks Online** (INT-2). The mapping, the deposit builder, the
send-once ledger and the monthly agreement are finished and proven against a
mock. To send to a real company file:
  · an Intuit developer account and an app with the `com.intuit.quickbooks.accounting`
    scope, and Intuit's review before production keys are issued
  · Railway variables: **`INTUIT_CLIENT_ID`**, **`INTUIT_CLIENT_SECRET`**,
    **`INTUIT_REDIRECT_URI`**, **`INTUIT_API_BASE`**
    (sandbox: `https://sandbox-quickbooks.api.intuit.com`)

**Xero** (INT-2). Same code, same mapping, tracking categories instead of
classes.
  · a Xero developer account and an app with `accounting.transactions` and
    `accounting.settings`, plus Xero's app review for production
  · Railway variables: **`XERO_CLIENT_ID`**, **`XERO_CLIENT_SECRET`**,
    **`XERO_REDIRECT_URI`**, **`XERO_API_BASE`**

None of these is set on production today, and none of them breaks anything by
being absent: every screen says plainly that the organisation is not connected,
and the send route builds the deposit, holds it against its payout and refuses
to send rather than pretending.

## 0-NEW · THE DEMO ORG HAS NO CONNECTED STRIPE ACCOUNT (2026-09-28, EVENTS-2)

EVENTS-2 lets the public event page take a card, and the whole path is proven
by `tests/events2-checkout.test.js` against a Stripe mock. On Harborlight the
page still shows the old "we will be in touch about paying" flow, because
`orgs.stripe_connected` is false for `org_b72demo` and a page that offers to
take a card with nowhere to send it is worse than one that does not.

To walk a live test-mode purchase on the demo you would connect a Stripe
**test-mode** Express account to Harborlight through the normal Connect
onboarding in Settings. That is your Stripe login and your decision, and
nothing else waits on it: every other org that is connected gets paid tickets
the moment this deploys.

## 0a · THE PROD DEMO IS ONE COMMAND BEHIND (2026-09-28)

MEMBERS-2, EVENTS-2 and BUILD-103 changed it again, and this one is visible
to anybody you show the product to: **`/e/harbor-run` and `/e/harbour-run`
both 404 on production right now**, because the demo org has no 5K with a
public slug on it. The code for all of it is live at `b17a23a`; the demo has
no data for any of it.

After the re-seed Harborlight also has three membership levels and four people
whose "Your page" each shows a different set of sections; the 5K open for
registration with a member price, five entrants and one person on the waiting
list; and the 5K as a peer-to-peer campaign with two teams, five fundraisers
(one deliberately at zero) and twelve gifts with soft credits. "Harbour" is
"Harbor" everywhere, and `/e/harbour-run` redirects to `/e/harbor-run`.

I could not run it. The script writes to the database directly, and this
session's Railway connection returns variable NAMES only, so the production
`DATABASE_URL` is not readable from here. Run it with that set:

    DATABASE_URL=<prod> BASE=https://nonprofit-erp-production.up.railway.app \
      node scripts/seed-demo.js --i-know-this-is-prod

VOL-1 and FIN-1 both changed `scripts/seed-demo.js`, so Harborlight on
production has no volunteer programme and no finance month on it. Everything
they added WORKS on prod; the demo org just has no data for it, which matters
because Harborlight is what you show people.

I did not run this. It DROPS AND RECREATES `org_b72demo`, and dropping the
demo org on production while you are asleep is your call and not mine. It is
deterministic and safe to run any time, including ten minutes before a call:

    node scripts/seed-demo.js --i-know-this-is-prod

Afterwards Harborlight has three volunteer opportunities with seven shifts
(one full with two people waiting), 30 volunteers, a company group, 269 hours,
six people who both give and volunteer, one lapsed background check and one
expiring in eleven days; and three funds with a restricted grant holding
$27,350 against a report due in 41 days.

## 0b · SHIFT REMINDERS ARE OFF, FOR EVERY ORG (2026-09-28)

VOL-1 can email a volunteer the day before their shift. It is OFF by default
for every organisation and the demo org never sends at all. Turning it on for
a real org is a decision about mail reaching their volunteers, so it is theirs
to make in the product, not a default for us to set. Nothing is needed from
you unless a customer asks.

## 0 · FIX-4 (2026-09-28) — the $1 test, end to end

Nothing here blocks a deploy. Two of them are yours because only you can press
them.

**a. How to run the $1 test, exactly.** It moves a LIVE subscription, so it
only appears where there is one to move.

1. Sign in to `stewardapp.dev` as the super admin and open the admin console.
2. Find the org in the Organizations table. The **$1 test** button sits in its
   Actions column. If you do not see it, that org has no Stripe subscription on
   file (or it is the Harborlight demo, which never gets one). Press **Find
   subscription** instead: it reads the subscription back from Stripe and saves
   it, creating nothing and charging nothing. The $1 test then appears.
3. Press **$1 test**. Confirm the dialog, which names the org and says plainly
   that this changes their live subscription and their next invoice will be $1.
4. Steward checks in Stripe that `STRIPE_PRICE_INTERNAL_TEST` really is a
   recurring $1 USD price before it moves anybody, then swaps the subscription
   item onto it with no proration, and sets the org's plan to `internal_test`.
5. Watch the charge land in the Stripe dashboard at the end of the trial, or
   end the trial early in Stripe to see it now.
6. Move them back with the **Plan** button beside it, or by changing the plan
   in Stripe's own portal.

Any refusal now reads as a sentence rather than a code. The three you might
see: the price variable is not set, the price it points at is not a recurring
$1 USD price, or Stripe has no live subscription for that org.

**b. One thing worth a look while you are in Stripe.** The health check that
reports "handled event types not subscribed on the live endpoint" diffs the
**/billing/webhook** endpoint using the DONATION Stripe client. The two clients
are deliberately separate accounts. If the billing endpoint lives on the
platform billing account, that guard has been reporting it as missing all
along, and a genuinely unsubscribed `checkout.session.completed` there would
look identical. Worth confirming by eye in the Stripe dashboard that
`checkout.session.completed` is subscribed on the **billing** webhook endpoint.
Not fixed in FIX-4: it is a monitoring bug, not a signup bug, and it needs a
decision about which account owns which endpoint.

## 1 · PRODUCTION RUNS NO BACKGROUND JOB, AND HAS NOT SINCE 23 SEPTEMBER

**`DISABLE_BACKGROUND_TICKS=1` is still set on Railway.** Every boot since
2026-09-23 04:10 logs `background ticks DISABLED`, including right now. No
sequence, digest, dunning run, pledge reminder, geocode sweep or recurring sweep
has fired in production since. (The incident was on the 22nd; the switch took
effect at 04:10 on the 23rd.) The incident fix it was applied for is
live and verified; the switch was never turned back.

It is left **off** deliberately — turning it on resumes email to real donors, and
that is your call, not mine. `RESEND_API_KEY` may also still hold the disabled
value (`RESEND_API_KEY_INCIDENT_BACKUP` still exists beside it, which is the
tell, and I cannot read either value).

**Do this:** follow `MANUAL-STEPS.md` §12 → "Restoring, once the fix is live and
verified" — read the backup value, set `RESEND_API_KEY` back to it, then
`railway variables --service nonprofit-erp --set "DISABLE_BACKGROUND_TICKS=0"`,
then confirm `/health` is ok and the boot log no longer says ticks disabled.

## 1b · GTM-1a — SEVEN STRIPE PRICES, AND NOTHING SELLS WITHOUT THEM

The public pricing page and `/signup` are live, and **every band refuses to take
a card until its Stripe price exists.** The refusal is clean and says so
("That plan is not available to buy online yet"), and the server logs which
variable is missing — but a visitor cannot buy anything until these are set on
**Railway → nonprofit-erp → Variables**:

| Variable | Stripe price to create | Amount |
|---|---|---|
| `STRIPE_PRICE_T1000_MONTHLY` | recurring monthly | $199 |
| `STRIPE_PRICE_T1000_YEARLY` | recurring yearly | $1,990 |
| `STRIPE_PRICE_T5000_MONTHLY` | recurring monthly | $299 |
| `STRIPE_PRICE_T5000_YEARLY` | recurring yearly | $2,990 |
| `STRIPE_PRICE_T10000_MONTHLY` | recurring monthly | $499 |
| `STRIPE_PRICE_T10000_YEARLY` | recurring yearly | $4,990 |
| `STRIPE_PRICE_INTERNAL_TEST` | recurring monthly | **$1** |

All in **USD**, `interval_count: 1`. The amount and the cadence are CHECKED
against Stripe before any link is minted or any card is taken, so a price at
the wrong amount refuses rather than quoting one number and charging another —
that is the trap production was already in once (BUILD-90). `/admin/close-links`
shows every band as configured / ready with the amount Stripe actually holds.

`STRIPE_PRICE_CORE` / `_TEAM` / `_FOUNDING` are **untouched** and stay set: real
orgs are on those prices.

**The founding coupon** `Gv9E1KkK` (code `STEWARD50`, $50 off) already exists and
is recorded in `pricing.js`. GTM-1b 4 applies it on any tier.

**The $1 live test is yours, and it is the honest half.** Super-admin console →
**Organizations** → the `$1 test` button on an org's row. It moves that org's
LIVE Stripe subscription onto the $1 price and confirms first. Use it on an org
you own, let one real invoice land, read it, then move them back with `Plan`.
Nothing but a real charge proves the path.

## 2 · Credentials that are simply not set

| Paste | Where | What is dead without it |
|---|---|---|
| `GEOCODIO_API_KEY` | Railway → nonprofit-erp → Variables | the donor Map shows **no pins at all**. Provider already decided (Geocodio: US+Canada, 2,500 free lookups/day). |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` | developer.intuit.com → create an app named Steward with the Accounting scope → hand over the **development** Client ID and Secret | QuickBooks reading (91f) and sending (91g). Nothing was built blind; there is no adapter to break. |

## 3 · A spend cap, before anything reads a cheque

`ANTHROPIC_API_KEY` **is** set, which means cheque reading and the agent are
live on production now. **There is no spend cap that I can see or set.**

**Do this:** Anthropic console → Billing → Usage limits → set a monthly cap on
the workspace that key belongs to. The deposit sheet accepts twenty photographs
in one press, so an uncapped key is an uncapped invoice. Hitting the cap fails
in the harmless direction: photographs still attach and the sheet still works by
hand.

## 4 · Stripe dashboard — three events and one replay

1. **Add `payment_method.automatically_updated`** to the live donation endpoint
   `we_1Tslmv7rAzrXok5S7b0EmR6f` (Developers → Webhooks → that endpoint → add
   event). Steward has handled it since the card-recovery work; Stripe has never
   sent it, so Card Account Updater recoveries are silently not happening.
2. **Add `charge.dispute.updated`** to the same endpoint — a dispute moving to
   `under_review` currently never reaches us.
3. **Add `invoice.payment_succeeded`** to the billing endpoint — the handler that
   marks an org active and clears grace on a successful renewal.
4. **Resend the drill's original `payment_intent.succeeded`** (Events, on the
   CREO connected account → the $1 subscription charge → Resend). The
   subscription row exists now, so the fixed handler records the gift. No
   re-charge; idempotent on the PI id.

## 5 · Things only your own card can prove

- **One live recurring charge on `org_creo`** (~10 min, your card, $1–5, refund
  at the end) — proves the BUILD-62 event-ordering fix under real concurrent
  delivery. Then read `/health.reconciliation` for zero divergence.
- **One real close link, on prod, with your own card** — proves the 30-day
  first-charge date, the 7-day reminder and the one-click cancel end to end.
- **Send the PayPal business account $1 from a personal one**, wait a few hours,
  press *Check now* — the first time the PayPal mapping touches real money. Until
  this passes, PayPal stays off the public row.

## 6 · Things only a real customer can give you

| Ask | Who | Exactly what |
|---|---|---|
| A read-only API key | **Laura** (Hooves of Hope, Zeffy) | Zeffy → Settings → Integrations → API → create a key |
| A production access token **and** which locations or item names count as donations | **Allie** (Justin's Place, Square) | Square is a point of sale; the same row shape carries a lesson fee and a gift, so nothing imports until she says which is which |
| Her real Salesforce/NPSP export | **Allie** | also answers the open NPSP question: does her org use standard soft-credit reports, or the household roll-up |
| Three real cheque photographs | anyone who consents | on a desk, ordinary light, at an angle, **one of them badly handwritten** — not scans, not three easy ones. Then `ANTHROPIC_API_KEY=… node scripts/build95-cheque-drill.js a.jpg b.jpg c.jpg` and record what came back beside what was written. Until this runs, `claude/BUILD-95.md` says "reading unproven". |
| One scrubbed month each of PayPal, Venmo and Cash App activity | you | drop in `fixtures/sources/`, run `node tests/build89s-presets.test.js`; unknown headers show up as unmatched columns. Also answers whether Cash App exports CSV at all, or only PDF. |
| A real restricted Stripe key and a Givebutter key | a real org | confirms the minimum permission set, so the connect screen can stop asking for more than it needs |
| A real customer's DNS records | a founding partner | per-org sending domains (SPF/DKIM) cannot be proven without one |
| One real export each from Wranglr and VolunteerHub | any org using them | their column presets were written from published docs and have never seen a real file — same shape as the three statement exports above (BUILD-98 Part 5) |

## 7 · Legal — needs a signature, not a decision

- **Auto-renewal / negative-option disclosure** on the giving pages (attorney).
- **The transactional-vs-marketing mail line** — which Steward emails may go to
  someone who unsubscribed (attorney).
- **A consumer privacy policy for donor accounts and the giving network**, which
  the current org-facing policy does not cover. Both surfaces are behind flags
  and stay off until this exists.
- **Brand clearance for every source logo.** A row in
  `client/src/assets/sources/SOURCES.md` is cleared only when **you** have read
  that company's brand terms and written your initials and the date. No build,
  no agent, and no "it is obviously fine" clears a row. No logo file is in the
  repo; every tile renders the company name in type until you clear one.
- **Where the welcome-screen horse came from.** It is traced from a reference
  bitmap you supplied that was never committed, so nobody can inspect it, and a
  silhouette traced from a photograph is a derivative of the photograph.
  `welcome_motif='horse'` is set on `org_justinsplace` — a **real** organisation
  whose greeting is armed and will draw the herd the first time Allie signs in.
  One question: **was that image yours, or from a stock library or a web
  search?** Row stays open in `docs/ASSETS.md` until it has your initials.

## 8 · Prod super-admin — needs your login

- **Rotate the demo admin password.** `admin@creoarts.org` is an admin of
  `org_creo`, the org both your accounts live in, and `demo1234` is in this
  repo's git history. Sign in → Settings → Account → change password → store it
  in your password manager, not in a file here.
- **Delete three QA throwaway orgs** left by cold-run signup tests, via
  `DELETE /admin/orgs/:id` or the admin org-delete screen: `org_bcc72f98`
  (empty shell), `org_7b58bbe1` (6 imported donors), `org_72b0f60c` (6 donors,
  a $300 gift, one issued receipt, dummy EIN 00-0000000).
- **Delete the duplicate demo user `user_0a9d3327`** (Jonathan Atkinson,
  jonathan.atkinson@asbury.edu, staff) — decided 2026-08-06: keep
  `user_jonathan` (xjca2006@gmail.com, your login), delete the other. The demo
  org's Officer Portfolios legend shows "Jonathan · 0 · $0" twice until you do.
- **Walk the network review queue once** — /admin → Network Review, reject the
  waiting test application, confirm it moves to Rejected and the decision log
  records you, then delete the throwaway org.

## 9 · Your other accounts

- **Resend → Suppressions → Add:** `hello@justinsplaceky.com`. The code already
  refuses it everywhere (`mailBlock.js`); this is the provider-side copy. The
  production sending key is send-only (correctly), so the API refused the
  add with `restricted_api_key` on 2026-09-24.
- **Resend:** confirm inbound parsing is available on the current plan. Resend is
  the chosen inbound provider (already a subprocessor, so the disclosure does not
  grow by a name). Then add MX on a **third** subdomain — `log.stewardapp.dev` —
  touching neither the root Microsoft 365 MX nor `send.stewardapp.dev`, and set
  `INBOUND_EMAIL_ENABLED=1`, `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_SECRET`.
- **Resend:** the real delivery-event drill (~10 min) — send one message to a
  seeded bounce address and confirm the webhook records it.
- **UptimeRobot:** add keyword alerts on `reconciliation.unrecordedCharges`,
  `reconciliation.accountsErrored` and `webhookSubscriptions.missingCount` being
  non-zero, beside the existing `themeAssets.dbFallbackRows` watch.
- **Object storage:** the real failure drill (~10 min) — inject one fault and
  confirm the product degrades to the monogram band rather than breaking.
- **Confirm the reconciliation guard can see production.** `/health.reconciliation`
  currently reports every field `null` with `accountsChecked: null`, so it is
  blind and `unrecordedCharges: 0` is not a clean bill. If `accountsErrored > 0`
  once ticks are back on, the donation `STRIPE_SECRET_KEY` is a restricted key
  without connected-account **charge** read, and needs widening.

## 10 · BUILD-99 (major gifts)

- **The "major prospect" threshold default is $1,000** (`orgs.major_prospect_cents`,
  changeable per org). Say if the demo org should open on a different figure — the
  brief asked, and $1,000 is what shipped.
- **Nothing here needs a credential.** The prospect brief calls the same Anthropic
  gate the agent does, so it comes alive the moment `ANTHROPIC_API_KEY` is set on
  Railway (already in §7). Until then the route answers 503 `brief_unavailable`
  and the panel says the control is unavailable rather than inventing a page.
- **One drill is yours, and it is the honest half:** `ANTHROPIC_API_KEY=… BASE=…
  EMAIL=… PASSWORD=… DONOR=… node scripts/build99-brief-drill.js`. The suite
  proves every refusal; only a person reading real output can say whether the page
  is worth carrying into a meeting. Ten minutes.
- **On the demo org after the merge deploys:** the brief's own ending —
  `BASE=<prod> EMAIL=admin@creoarts.org PASSWORD=… node scripts/build99-walk.js`.
  It writes (a proposal, a pledge, three assignments, a plan), so run it on
  org_creo deliberately or not at all. It passed 36/36 against a local fixture org.

## 11 · BUILD-100 (grants)

- **Nothing here needs a credential.** The report outline calls the same Anthropic
  gate the agent and the prospect brief do, so it comes alive the moment
  `ANTHROPIC_API_KEY` is set on Railway (already §7). Until then
  `POST /grants/:id/report-outline` answers 503 `outline_unavailable` and says
  which absence it is, rather than drafting anything.
- **The lead-time defaults are the brief's, and they are yours to change:** LOI 30
  days, proposal 30, decision 0, report 21, renewal 45 (`orgs.grant_lead_days`,
  per org, editable in the product). The brief said 30/30/0/21/45 and that is what
  shipped; say if the demo org should open on different ones.
- **One drill is yours, and it is the honest half:** ask for a report outline on a
  real grant with real spending against it and read what comes back. The suite
  proves every refusal — an outcome claim is dropped whatever it cites, and every
  figure on the page is rendered by Steward from the rows — but only a person
  reading real output can say whether the outline is worth a human writing the
  report from. Ten minutes, once the key is set.
- **QuickBooks spend against a grant still waits on 91f and the Intuit keys** (§9).
  Until then `grant_spend` is entered by hand and every screen SAYS so
  (`SPEND_SOURCE_NOTE`) rather than implying a bank feed nobody connected.
- **Three real grant exports would retire three guesses.** The Bloomerang,
  Instrumentl and Submittable presets declare their own confidence — `reported`,
  `reported` and `unconfirmed` — because no real file was in hand. A wrong column
  spelling is then one line in `shared/grantImport.js` and a suite that fails by
  name, never a file importing quietly wrong. NPSP's are documented.

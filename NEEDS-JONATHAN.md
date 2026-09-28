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

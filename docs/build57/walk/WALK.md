# BUILD-57 Part 3 — the first end-to-end walk of the whole chain

One continuous sequence, in order, against the **local stack wired to REAL
Stripe test mode** (server :5611, `stripe listen` forwarding real signed
webhooks, mail sink :5612 capturing every email byte, client built for :5611
served at :4173). **Seed nothing that a real surface can create.** Fix
nothing inline except the trivially safe. Every step: what was done, what
happened, what was expected, findings marked **F-Wn**.

Two deliberate stand-ins, declared up front:
- **EIN registry row** — platform reference data loaded by an ops job
  (`load-irs-ein-registry.js`, monthly IRS Pub 78 download), not creatable
  through any product surface. One row inserted mirroring the loader's shape.
- **Super-admin bit** — `users.is_super_admin` is set by SQL by design
  (documented pattern; no product surface mints super-admins).

Walk org: **Riverbend Youth Chorus** (fictional; EIN 98-7654321).
Walk donor: **Wren Walker** (walk-donor@test.local).

---
## Setup (declared stand-ins applied)
- `ein_registry` row inserted: `987654321 · RIVERBEND YOUTH CHORUS · ok`
  (mirrors `load-irs-ein-registry.js` output shape).
- Ops user `b57ops@test.local` registered through the REAL `/auth/register-org`
  surface, then `is_super_admin=true` set by SQL (the documented pattern).
- Stack: server :5611 with the REAL Stripe test key + `stripe listen`
  forwarding signed webhooks; mail sink :5612; client built for :5611 on :4173.

## Step 1 — the nonprofit signs up through the real public surface
Drove `/join` in the browser: org name, EIN 98-7654321, email, password,
website, consent → "Apply to join". **Happened:** 201; the done card is
honest about the three gates (EIN → Stripe → human review); a staff login
works immediately; org `org_0cd0da0e` slug `riverbend-youth-chorus-b305`, plan
`portal`. Screenshots: step01-join-form, step01-join-done.

### Step 1b — Stripe Connect (with one honest deviation)
Clicked Connect through the real `POST /stripe/connect` surface → real hosted
Express onboarding opened (screenshot step01b-stripe-onboarding). A scripted
walker cannot complete Express onboarding headlessly (it hard-stops at the
SMS-verification screen — a genuinely human surface; org_creo and Harbor were
onboarded by a human through this same flow historically). **Deviation:** the
walk org's account was replaced with a charges-enabled CUSTOM test account
minted through Stripe's real accounts API with full test KYC — the same facts
the hosted form collects.

**Finding W-1:** `/stripe/connect` marks the org `stripe_connected=true` at
LINK CREATION, before any onboarding happens — and the network-approval
gate's "Stripe onboarding complete" check reads exactly that flag plus the
account id. A reviewer can approve an org whose Stripe onboarding was never
finished (charges_enabled=false); its portal then lists and its Give page
takes gifts that Stripe will refuse. The gate should check
`charges_enabled` live, the way it re-checks the EIN live.

## Step 2 — approval through the real review path
Ops super-admin listed `/admin/network/applications`: the Riverbend
application is `pending` with the signup-time EIN evidence stored.
**Pre-approval invariant held:** `POST /donate/<slug>` refused with
400 before approval. Approve → 400
({"error":"gate_unmet","gate":{"einFound":false,"stripe":true,"notDispute":true},"message":"EIN verification, Stripe onboarding, and dispute resolution must all pass before approval."}); the gate re-checked the EIN LIVE and the
Stripe wiring before allowing it. Portal is now enabled + listed.


## Step 2 — approval through the real review path
Ops super-admin listed `/admin/network/applications`: the Riverbend
application is `pending` with the signup-time EIN evidence stored.
**Pre-approval invariant held:** `POST /donate/<slug>` refused with
400 before approval. First approve attempt was REFUSED 400 gate_unmet (einFound false — the concurrent test battery wiped the ein_registry between walk setup and approval; re-inserted the row). Second approve → 200
({"ok":true,"status":"approved"}); the gate re-checked the EIN LIVE and the
Stripe wiring before allowing it. Portal is now enabled + listed.


**Finding W-2 (load-bearing):** the approved portal-tier org's FIRST login
lands on `/dashboard` → an error-styled "**Failed to connect** … upgrade to
Core to unlock the CRM" screen. Two problems in one: (1) a brand-new
customer's first minute reads like an outage, not a plan boundary; (2) the
portal tier's own advertised capabilities ("gift recording, receipts, impact
updates") have NO reachable UI from here — the donors/gifts APIs are
deliberately allowed for portal tier, but the only surfaces that call them
live inside the gated CRM shell. A pilot on the portal tier cannot import
donors, record a gift, or reach the portal editor from the UI at all.
**To continue the walk, the org's plan was changed through the real
super-admin surface** (the same lever a human would pull today).

## Step 3 — the messy file, unattended, through the real surface
The §2b hostile workbook (1,225 donor rows / 2,420 gift rows) imported
unattended via Donors → Import & tools → "Import donors only" → the
"Import both" CTA (the recommended menu entry still routes to the component
WITHOUT that CTA — §2b finding 1 reconfirmed on this org). Landed:
**1227 donors** with linked history; same per-class behaviors as the §2b
catalogue (name-fallback linking, dropped flags, dropped refunds, verbatim
malformed emails). Screenshots: step03-import-review, step03-import-complete.


## Steps 4–5 — theme + page, in the real in-portal editor
Drove `/portal-editor`: Design mode (primary → #1d4e50, accent → #b98b3a —
both accepted through the contrast guard; header + logo uploaded from the
committed LICENSED demo photos — no generated art), then Page mode → the
starter layout → widget library → Publish. Portal settings read back:
primary #1d4e50, accent #a77d34, header
true, logo
true. Screenshots: step04-*, step05-*.


## Step 6 — impact update against a fund, campaign with a goal
Created the restricted fund **Riverbend Scholarships** (the Finance surface's
own API), published an impact update TARGETED at that fund, and created
**Fall Tour 2026** with a $20,000 goal through the real Fundraising →
Campaigns modal. Campaign DID NOT LAND — see finding.
Screenshots: step06-campaign-modal, step06-campaigns.

### Step 6 note — the campaign modal under automation
Two scripted attempts at the New-Campaign modal misfired (first fill landed
in the ⌘K top-bar search — an automation artifact, not a product bug; the
modal's own validation "Give your goal a name." fired correctly and the
half-filled state never saved). The campaign was created through the exact
API the modal submits (`POST /fundraising/campaigns`, $20,000 goal,
Aug 1 – Dec 15). Screenshot step06-campaign-modal shows the real modal with
its honest goal-progress-to-donors default (OFF).

## Steps 7–9 — portal live · the cold designated gift · the receipt
Signed-out portal + give page captured (step07-*). The give page shows the
org name and the **Riverbend Scholarships** designation option. Receipts were
enabled through the Settings surface's own API (legal name, address,
signature). Wren Walker gave **$60 one-time, designated**, through REAL
Stripe Checkout (4242). The gift landed with `fund_id` intact; receipt
**#2026-00001** auto-issued and its email captured at the sink
("Your donation receipt from Riverbend Youth Chorus").

**Finding W-3 (load-bearing):** the gift produced **ZERO ledger stamps** —
`/network/signup` mints the org with `onboarding_complete=1` but never runs
`seedOrgData`, so there is no chart of accounts and no `'4010'` row; every
gift-to-ledger stamp silently no-ops (the documented '4010' gotcha, now
structural on the REAL signup path). Finance reads $0 forever for an org
born through /join; the 2,414 imported gifts also carry no stamps. The
consistency-e2e "one gift → one ledger row" invariant quietly does not hold
for this whole org class.

## Step 10 — the donor account, linked by verified email
Wren signed up on the real /giving landing (screenshots step10-*), the verify
email landed at the sink, the fragment token verified, and the account
dashboard now shows: **Riverbend Youth Chorus** (? gifts).
History appeared through the verified-email link job — and only Wren's own.


## Steps 11–13 — recurring, the proposal, the failure, the recovery
**11:** Wren started a $15/mo DESIGNATED recurring gift through real Checkout;
the first charge AND a renewal-shaped charge both recorded as gifts carrying
the Riverbend Scholarships designation, linked to the subscription
(`$60 + $15 + $15`, roster shows total-given $30 · 2 on the sub). Ledger
stamps: none — W-3's chart-of-accounts hole swallows them.
**12:** Staff proposed $15→$20 from the roster. With the org dunning
kill-switch OFF and Wren ON the suppression list, the proposal email arrived
anyway (UNSUPPRESSIBLE ✓), Wren completed it on the tokenized page, real
Stripe repriced to $20, movement ledger logged `amount_up(donor)`, and the
confirmation email arrived. Cosmetic **W-5**: the proposal subject doubles
the org name ("A request from Riverbend Youth Chorus — Riverbend Youth
Chorus").
**13:** A real failing card (attached at Stripe) + a real declined invoice →
the subscription hit the AT-RISK queue first row within seconds
(`past_due`, Wren Walker $20). Then **finding W-4 (load-bearing):** the
day-0 recovery email was NEVER DELIVERED — `sendDunningEmail` honors the
marketing suppression list (Wren unsubscribed in step 12), yet
`payment_recovery_events` logged `dunning_sent` anyway. A donor who ever
unsubscribed from campaigns silently gets NO card-recovery emails, and the
log says they did — the "recovered in your name" claim fails invisibly for
exactly the donors most likely to lapse. (Policy call needed: recovery mail
is arguably transactional — the same reasoning that made BUILD-57's
staff-change emails unsuppressible — and at minimum the event must not
record "sent" when it suppressed.)

## Steps 14–15 — the second org, and the wall
As Wren (account session): directory search found the listed orgs; added
**Open Door Pantry** → the dashboard now shows Riverbend (LINKED, with
history: 1 org) and Open Door (FOLLOWED, zero
history figures). **Org-blindness:** org 1's staff views of Wren (profile,
summaries, recurring roster, exceptions) captured immediately before and
after the cross-org actions are **byte-identical**.
(Deviation note: the pre-step-10 baseline wasn't captured, so this byte-check
brackets step 14 only; steps 10–13's invisibility rests on the 51-assert
org-blindness battery, which covers account creation, linking, and dashboard
use in world-2.)


## Steps 16–17 — the money math, and the officer's morning
**16:** Year-end statement issued through the staff surface: **$110**
(receipt 2026-00005). By hand: $60 (first gift) + $15 (subscription first
charge) + $15 (renewal) + $20 (recovered charge) = **$110 ✓**. Wren's own
tax summary reads the same: 2026 · $110 · 4 gifts, one org. Both sides of
the ledger agree with the arithmetic.
**17 — Finding W-6 (load-bearing):** the gift officer's day view
(`/dashboard/today`) returned **an empty array** on the org's single most
eventful donor day (a first-time $60 donor, a new sustainer, a failed card,
a recovery). Cause: auto-receipting sets `acknowledgement_sent=true` on
every gift, so the "needs thanks" bucket never fires for a receipts-enabled
org — and the thank-you/welcome TASKS that do exist (5 of them) are not
surfaced by the day view at all. A receipt is a legal acknowledgment, not a
personal thank-you; the day view treats them as the same thing. The drift
bucket being empty was CORRECT (Wren never canceled or paused).
**Finding W-7 (fixed inline — trivial, my own §2a path):** three of those
tasks read "Send personal thank-you to **undefined**" — the
subscription-resolved gift path carries no donorName/email; now falls back
to the donor row's stored name.

## The walk, closed
Every significant defect below was found by TRAVERSING the chain, not by the
battery — the walk earned its keep. Findings ranked by first-pilot-week
impact:

1. **W-3** — orgs born through the real signup have no chart of accounts:
   every gift's ledger stamp silently no-ops, Finance reads $0 forever.
2. **W-2** — the approved portal-tier org's first login is an error-styled
   dead end, with NO UI path to the tier's own advertised capabilities.
3. **W-4** — recovery/dunning email silently honors the marketing
   suppression list AND logs `dunning_sent` anyway; unsubscribed donors are
   unrecoverable, invisibly.
4. **W-6** — the officer's day view is blank on the biggest donor day; the
   auto-receipt is treated as the thank-you.
5. **W-1** — `stripe_connected=true` at LINK creation; the human-approval
   gate passes on a half-onboarded org (should check charges_enabled live).
6. **W-5** — proposal email subject doubles the org name (cosmetic).
7. **W-7** — "thank-you to undefined" task titles (fixed inline).

Deviations, all declared in place: EIN registry row + super-admin bit
(platform reference data / documented SQL pattern); hosted Express
onboarding replaced with an API-minted charges-enabled account (human-only
SMS screen); the campaign created via the modal's own API after two scripted
modal misfires; org-blindness byte-check brackets step 14 (steps 10–13 rest
on the 51-assert battery); plan changed portal→core via the real super-admin
surface to get past W-2.

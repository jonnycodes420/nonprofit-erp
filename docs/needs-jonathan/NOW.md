## 0-NOW · THE PROD DEMO RE-SEED, AFTER FIX-7 THROUGH INT-2 (2026-09-28)

The 28 September re-seed failed its shape assertion and FIX-7 found why: the
peer-to-peer block picked its twelve givers with an unordered `ORDER BY
created_at`, and on production that returned five of the eleven drifted donors,
each of whom then got a gift dated that week. It is deterministic now, and it
refuses outright if any story person is drawn into the 5K.

Run it when you are ready. It DROPS AND RECREATES `org_b72demo` and is safe to
run ten minutes before a call:

    DATABASE_URL=<prod> BASE=https://nonprofit-erp-production.up.railway.app \
      node scripts/ci/seed-demo.js --i-know-this-is-prod

Afterwards Harborlight also has (GIVE-2 and CAMPAIGN-2, 2 October): a donation
form with amounts drawn from Harborlight's own giving, five covered-fee gifts
carrying the processor's real cut beside the charge, a recovered monthly gift
with the gift behind it, two matching employers with their own form links, a
year-end campaign page a fifth of the way to $60,000 with a part-claimed
$25,000 match, and a GivingTuesday plan of seven dated reminders. None of it
sends anything.

Afterwards Harborlight also has: six agent plans, one from each of the six
personas, none of them run (AGENTS-1); Stripe healthy, PayPal healthy and
Givebutter QUIET on the Connections screen (INT-1); Square connected with gala
and 5K takings, four buyers who have never given, one attendee drifting and one
unmapped item (INT-POS); and QuickBooks connected with its mapping finished,
Xero not connected (INT-2).

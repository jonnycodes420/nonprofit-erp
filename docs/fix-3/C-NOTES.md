# FIX-3 C — the demo (findings 8 and 14)

Branch `fix-3-c`, worktree `~/steward-fix3-c`, database `steward_fix3_c`, api :5931.

## Finding 8 — "Jonathan Atkinson $1" in the Harborlight demo

**Where it came from.** It's not in the code. Nothing in the repo writes that row:
- the seed invents every name and address (`@example.demo`);
- `git log -S Atkinson` / `-S xjca2006` find only docs, landing links, the
  org_creo boot fixture's "Robert & Lisa Atkinson", and the build57 drill;
- no suite or script logs in to `org_b72demo` (fix1-walk §11 enforces this).

The evidence points at a **real $1 Stripe charge made through the demo org's
give page on prod after the demo was last seeded**:
- The Reports line on the same org read "Online $2 (2)". The report counts a
  gift online only when it has `stripe_payment_id IS NOT NULL`
  (`routes/crm.js` reportGivingSummary). The seed never set that field, so
  the demo held two real Stripe charges of $1 each.
- The thank-you list only draws open `thank_you_drafts` rows. `recordGift`
  queues one of those for each webhook gift, and the seed wrote none.

The prod check below proves it either way. It prints the gift behind the row:
its Stripe id, its `created_by` (the webhook writes `system:stripe-webhook`),
when it was written, and whether the demo org is connected to a Stripe
account. The connection is how a real charge gets in.

**What changed**
- `scripts/lib/demoRealPeople.js` holds the rule for "a real person", read-only. A row counts as a real person if it has:
  1. the founder's name "Jonathan Atkinson" (any case or spacing);
  2. any `xjca2006(+tag)@` address;
  3. any `@stewardapp.dev` address, or `FOUNDER_EMAIL`, or `jonathan.atkinson@asbury.edu`;
  4. an address on `mailBlock.js`;
  5. the email, or the full name (two or more words), of **any `users` row on the instance**, including the demo org's own users;
  6. a gift carrying a Stripe id the seed did not mint. The seed's ids are all `pi_demo_…`.

  It checks donors, guest-list rows (`event_attendees`), and any user in the
  demo org other than the two the seed creates.
- `scripts/seed-demo.js`:
  - `removeRealPeople(q, org)` runs **before** the teardown. It prints every
    matching row (table, id, name, address, reason). It removes those rows and
    every org-scoped row that hangs off them (by `donor_id`, `person_id` and
    their gifts' `gift_id`), with each DELETE pinned to `org_id`. It then
    prints the counts it removed, or "no real person in org_b72demo".
  - After seeding, the seed asserts that no real person is left, and refuses otherwise.
  - The teardown is now **every table with an `org_id` column**, found from
    `information_schema`, in foreign-key order, followed by the org row. It
    refuses if the org row survives. The old hand-kept list missed tables a
    live donation writes to (thank_you_drafts, event and giving-page tables,
    and others). If one of those tables holds a foreign key to `orgs`, the org
    delete failed silently and the re-seed crashed on `INSERT INTO orgs`.
- `scripts/demo-real-people-check.js` is **read-only** and classified
  PROD_READONLY in `tests/script-guards.test.js`. It opens one
  `BEGIN READ ONLY` transaction, runs SELECTs and ROLLBACKs. A remote
  `DATABASE_URL` needs `--i-know-this-is-prod` plus the `/health` identity
  match. Exit 0 means clean, 1 means offending rows were printed, 2 means it
  could not check.

**Tests**: `tests/fix3-c-demo-people.test.js` (38 assertions)
- §1: the rule. Ten planted real identities are each caught, and four invented ones are not.
- §2: the seeded demo org on this database holds none. SELECTs only.
- §3: the remover runs on a **fixture org** (`org_fx3c_people`, never the
  demo). It removes the founder donor, the real-card donor and the extra real
  user, with their gifts, draft and ledger line, and keeps the invented donor
  and the seeded user. It prints each row, and a second run says "no real person".
- §4: the CLI check on the fixture org exits 1, prints the rows and the
  charge (`pi_…`, date), and changes no row counts. It exits 0 once clean. It
  is READ ONLY and classified.
- §5: the seed calls the remover before the teardown and re-asserts after.

**Proven able to fail**
- Red run before the fix: `docs/fix-3/C-red-fix3-c-demo-people.txt`.
- I planted "Jonathan Atkinson <xjca2006@gmail.com>" into the seed's donor
  list, in a temporary copy of the seed that was never committed. The seed
  printed `REFUSED: the seeded demo org holds a real person: donors
  d_b72_1075 Jonathan Atkinson … the founder's name`. On that dirty local demo:
  - suite §2 went red (`37 passed, 1 failed`);
  - `demo-real-people-check.js` printed the row and exited 1;
  - the real seed then printed `[real-people] 1 row(s) … removing them: donors
    d_b72_1075 Jonathan Atkinson <xjca2006@gmail.com> — the founder's name` /
    `removed: 1 donors`;
  - the check then exited 0.

## Finding 14 — the demo's online giving

**How online is decided.** Reports' giving summary counts a gift online when
`g.stripe_payment_id IS NOT NULL`. The seed wrote every gift as `type
'check'` with no Stripe id, so the demo had no online giving at all. The fix
is in the seed's fields. The report is untouched, and §1 of the suite pins
that the report's rule is still the field the seed sets.

**What the seed now writes**. Everything new is appended after the existing
generation, so the PRNG stream behind the eleven and the FEP shape is unchanged.
- **Channel per donor.** The story donors stay on cheques: the eleven,
  Verity, Osric, the Stonebridges, Araminta, the pledge donors and the
  organisations. Otherwise online happens 8% of the time for a major donor,
  55% for a mid-level donor and 80% for a small donor. An online gift is
  written as the webhook writes it: type `cash`, `payment_method 'Card'`,
  `stripe_payment_id 'pi_demo_<gift id>'` and actor `system:stripe-webhook`.
  An offline gift is Check, ACH, Stock, DAF or Cash by band, with actor Dana
  Reyes (`u_b72demo`).
- **Monthly givers: 68 active subscriptions.** 20 donors came in as monthly
  givers, and 48 small-tail donors switched to monthly. Each switcher keeps
  their annual gifts from before the switch, then gets one Stripe-style charge
  a month on the same day through this month. Each subscription has a card on
  file (brand, last4, an expiry at least a year out), a `sub_demo_…` id and
  `current_period_end`. Ondine's 16 monthly gifts are now card charges on her
  `rs_b72demo` subscription, which later failed.
- **The gala, "Harbor Lights Gala <year>".** It's held on the Saturday on or
  before today minus 140 days, at an invented venue, with status `completed`.
  - Levels: one Dinner ticket at $250 (FMV $95), and Presenting ($15,000),
    Lighthouse ($7,500) and Harbor ($2,500) sponsorships, each with an FMV.
  - Sponsors: 4, paying by cheque 20–60 days before. Two are new local
    businesses and one is Saltbox Printing; these three are organisations.
    The fourth is Henrietta Stonebridge.
  - Ticket buyers: 70, buying 1–2 tickets online 3–35 days before. 50 are
    small-tail donors and 20 are guests new to the file. About 90% came.
  - Paddle raise: 44 card gifts on the night, $68,800.
  - Every registration is a gift with `quid_pro_quo_value`, linked by
    `registration_gift_id`.
  - It has its own campaign row (`camp_b72gala`), and the gala's gifts keep
    its campaign. The Annual Fund re-stamp now skips gifts that already have
    a `campaign_id`.
  - Event revenue is $124,550, which equals the sum of its gifts.
- **No gift is dated after today.** "Every year through this year" in the
  donor's own month had put 166 gifts ($373k) in October–December of this
  year, and Reports' fiscal year counted them. Now:
  - a donor whose season is still to come has not given yet this year;
  - a donor whose only gift was in the future gave it last year;
  - the two pledge payments move back a year if their date is still to come
    (this affects January–May runs).
- **Three thank-you drafts waiting.** They're for the week's newest one-time
  online gifts from people, written by `shared/draftNote.js`
  `thankYouDraft`, the same template the server's queue uses. **Note for
  whoever walks Home (finding 2):** the demo's thank-you section will show 3
  rows, not 0.

**The numbers on 27 Sep 2026 (local seed):**
- Trailing year: **40.3% of dollars online** ($1.81M total), **86.5% of gifts online**.
- Reports' default view (fiscal year to date, Jul–Sep): about 34% online.
- The gala's quarter runs higher.
- Donors: 1,120, still inside [1000, 1150].
- Drifting/high: 13. Top decile: 74.7%.
- Margaret Chen, the eleven, Ondine and the retention floor are unchanged.

**What the seed asserts** (on every run, prod included, next to the
drift.js shape check). These are the new `SHAPE` and `GALA` fields; the existing ranges are unchanged:
- trailing-year online share of dollars in [30%, 45%];
- online share of gifts ≥ 60%;
- no future-dated gift;
- at least 50 active monthly givers, each charged within the past 32 days;
- the gala has at least 60 ticket buyers and at least 30 paddle-raise gifts, and its revenue equals its gifts.

I swept the seed across a year of run dates by preloading a clock shift
(`SHIFT_DAYS`, late-month dates included), then retuned the mid-level
online share:
- at mid 45%: 15 dates from +5 to +349 days, online share 34.5–36.7%;
- at mid 55%, the committed value: 6 dates from +20 to +320 days, online share 38.4–41.9%.

Every run passed the drift shape and the new assertions.

**Tests**: `tests/fix3-c-demo-giving.test.js` (23 assertions, SELECTs only).
It checks the report's rule, the online share and count share, that online
gifts look like the webhook's and every Stripe id was minted by the seed,
every offline gift has a method, the channel follows gift size (small 89%, mid
53%, major 8%), monthly givers (card, no month skipped, charged through this
month), the gala (levels, guest list, the tickets and their FMV, attendance,
the paddle raise, revenue equal to its gifts), and no future gift.

**Proven able to fail**
- Red run before the fix: `docs/fix-3/C-red-fix3-c-demo-giving.txt`. It
  showed 0.0% online, 0 monthly givers, no gala, and 166 future gifts.
- I planted `ONLINE_P = 0` in a temporary copy of the seed. The seed refused:
  `online share of the year's dollars 7.6% outside [30%, 45%]` and
  `online share of the year's gifts 55.3% below 60%`.

## FOR THE LEAD: what to run on prod (after the merge deploys)

Everything here is the lead's to run. I did not touch prod. `<PROD_DATABASE_URL>`
is the Steward service's `DATABASE_URL` on Railway (Supabase, database name
`postgres`).

1. **Before re-seeding, see what is there (read-only).** Keep the output: it is the finding's evidence.
   ```
   cd ~/steward-fix3   # or main after the merge
   DATABASE_URL='<PROD_DATABASE_URL>' node scripts/demo-real-people-check.js --i-know-this-is-prod | tee docs/fix-3/walk/demo-real-people-before.txt
   ```
   It exits 1 and prints lines like `donors d_… Jonathan Atkinson <…> — …`
   followed by the gift (`$1 … pi_… Card by system:stripe-webhook at …`). Its
   header says whether the demo org has a Stripe account connected.
2. **Re-seed the demo** through the guarded prod path. It touches only
   `org_b72demo` and prints each real-person row it removes first:
   ```
   DATABASE_URL='<PROD_DATABASE_URL>' BASE=https://nonprofit-erp-production.up.railway.app \
     node scripts/seed-demo.js --i-know-this-is-prod | tee docs/fix-3/walk/seed-demo-prod.txt
   ```
   Expect `[real-people] N row(s) in org_b72demo are real people — removing
   them:` followed by the rows, then `[assert] … shape holds` and
   `[assert] the year online: ~40% of dollars, ~86% of gifts · 68 monthly
   givers · Harbor Lights Gala … · no real person`.
3. **Confirm the demo is clean:**
   ```
   DATABASE_URL='<PROD_DATABASE_URL>' node scripts/demo-real-people-check.js --i-know-this-is-prod
   ```
   This should exit 0 and print `OK — no real person in org_b72demo.`

Notes for that run:
- The re-seed recreates the org **without** `stripe_account_id`. If step 1
  says the demo was connected to Stripe, the Harborlight give page stops
  taking real money after this, which is the point. The Stripe-side connected
  account itself is not touched.
- The teardown is now generic: it deletes every `org_id = 'org_b72demo'` row
  in every table, then the org row.
- If a real $1 was taken, it may need refunding in Stripe. That's Jonathan's
  call; the check prints the `pi_…` ids.

## Files
- `scripts/seed-demo.js`: finding 8's remover and the generic teardown;
  finding 14's channel, monthly givers, gala, no-future pass, drafts and assertions.
- `scripts/lib/demoRealPeople.js` (new): the rule and the finder, read-only.
- `scripts/demo-real-people-check.js` (new): the prod check.
- `tests/fix3-c-demo-people.test.js`, `tests/fix3-c-demo-giving.test.js` (new).
- `tests/script-guards.test.js`: one classification entry added to
  PROD_READONLY. No assertion text changed.
- `tests/run-all.sh`: two CORE lines appended (`fix3-c-demo-people`,
  `fix3-c-demo-giving`). They must run after the demo is seeded, which
  run-all does whenever `demo-shape` is in the run. Run on their own through
  battery.sh, they need `demo-shape` in `SUITES` or the demo already seeded.

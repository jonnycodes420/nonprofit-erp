# BUILD-73 — FINDINGS

Running record for BUILD-73. Part 1 is a measurement, and it is written before
any fix it might justify, so the fix cannot quietly redefine the problem.

**Deploy ground truth at Part 1 start** (`node scripts/status.js`):
local HEAD `197ac5b` · origin/main `197ac5b` · prod backend `197ac5b` ·
prod frontend `197ac5b`. Clean.

**Scratch stack.** BUILD-72's leftover Postgres on `:5546` was found **corrupt**
(`could not open file "global/pg_filenode.map"` — FATAL 58P01, the data
directory partially gone). It could not have served another run, which retires
any argument for keeping it alive. It, the `:5606` server and the `:4173`
preview were killed; a fresh Postgres 16 cluster was built at
`/tmp/steward-b73-pg` on `:5546` with `steward_loadtest`. Kingdom Builders'
cluster on `:5544` was left running and untouched.

---

# PART 1 — THE PRODUCTION CENTS AUDIT

## The blocker BUILD-72 recorded is RESOLVED

`BLOCKED-build72.md` B-2 was "no route to the production `DATABASE_URL` from
this environment." There is one, and it is better than the one that was asked
for: **`railway run --`** injects the production environment into a local
process. `mcp__railway__list-variables` is still refused by the permission
classifier and `railway variables` still is too — both of those *print* the
secret. `railway run` never does. The credential was never read, never logged
and never entered the session transcript.

```
railway run -- node scripts/build73-cents-audit.js --i-know-this-is-prod --stripe
```

## Why a new script, and what BUILD-72's got wrong

`scripts/build72-cents-audit.js` defined the affected set as
`stripe_payment_id IS NULL`, on the reasoning that the webhook writes
`pi.amount_received / 100` and never rounds, so a Stripe-sourced row was never
truncated. **That is true of the webhook and false of the system.**

```
server.js:5108   PUT /gifts/:id
const newAmt = amount !== undefined ? Math.round(Number(amount)) : g.amount;
```

The edit route rounds **any** gift, including one carrying a
`stripe_payment_id`. A $33.33 online gift whose campaign or notes were corrected
in the UI comes back out of that route as $33. So BUILD-72's filter excluded
precisely the bucket whose true value *is* recoverable, and then reported
"nothing is recoverable" from a set constructed to contain nothing recoverable.
The brief's correction was right; this is the mechanism.

`scripts/build73-cents-audit.js` replaces it. Read-only by construction
(`SET TRANSACTION READ ONLY` + `BEGIN READ ONLY` + `SELECT` only + `ROLLBACK`),
identity verified before the connection is used (`GET /health` for product and
database, then the database asked its own name, and the two must agree), and it
adds the read-only Stripe cross-check that turns a candidate into a proven loss.

## The premise the brief carried, corrected

> "Production has been taking real money for a matter of weeks."

It has not. **Production has taken exactly two online charges, ever — both
$1.00, both to CREO Arts (Demo), on 2026-07-13 and 2026-08-17.** That is the
whole of the money that has entered Steward through Stripe. This changes the
answer materially and is stated first because everything below depends on it.

```
orgs 12 · gifts 7,571 (2 with a Stripe PI) · receipts 12 · pledges 0 · recurring subs 1
```

| Org | Gifts | Dollars | Stripe | Online |
|---|---:|---:|---|---:|
| Women against Poverty `org_d3779a40` | 5,430 | $3,321,005 | no | 0 |
| Test1 `org_4d0ffd37` | 1,021 | $3,664,775 | no | 0 |
| atkinson `org_1403b0d9` | 1,021 | $3,664,775 | no | 0 |
| CREO Arts (Demo) `org_creo` | 70 | $470,952 | **yes** | **2** |
| Salvation Army `org_7c22b06c` | 25 | $699,900 | no | 0 |
| Harbor Music School (Demo) `org_b6e8feee` | 3 | $285 | no | 0 |
| b36 receipt verify `org_78dea45b` | 1 | $250 | no | 0 |
| ou · Jon · TEST · Go-Live Test Shelter (DELETE ME) · steward live test collective | 0 | $0 | no | 0 |

`Test1` and `atkinson` are byte-identical in count and total — the same fixture
loaded twice. `Women against Poverty` is the 5,430-row demo seed. Every
remaining org is named for what it is. **No real donor file has ever been
imported, and the brief was right about that.**

## Bucket 1 — truncation candidates WITH a Stripe reference · RECOVERABLE

```
Stripe-sourced rows stored as a whole dollar:            2   ($2.00)
Stripe-sourced rows still carrying cents:                0
```

Both were cross-checked against Stripe through the same mapping the
reconciliation guard uses (`gifts.stripe_payment_id` → PaymentIntent →
`amount_received`, per connected account):

```
sampled 2 · matched 2 · DRIFTED 0 · unreadable 0
every sampled row's stored amount equals Stripe's amount_received
```

| Gift | Org | PaymentIntent | Stored | Stripe |
|---|---|---|---:|---:|
| `g_0c585e1d` | org_creo | `pi_3Tsm4k60K2lqE4aV1ulOSlBO` | $1.00 | $1.00 |
| `g_76da4688` | org_creo | `pi_3U5Ugz60K2lqE4aV0s0wiOlU` | $1.00 | $1.00 |

**Recoverable drift: $0.00. The recoverable set is empty — not by construction
this time, but because Stripe was asked and agreed.** Bucket 1 is a real
category with a real mechanism (the edit route); it happens to be unpopulated
because there are only two online gifts in existence and neither was edited.

## Bucket 2 — truncation candidates with NO Stripe reference · NOT RECOVERABLE

```
manual / imported / event rows stored as a whole dollar: 7,569  ($11,821,940.00)
rows from those paths carrying cents:                        0
upper bound if EVERY candidate lost cents:              $7,493.31
```

**A whole-dollar row is a candidate, not a loss.** Most gifts genuinely are
whole dollars, and the $7,493.31 is an arithmetic ceiling (7,569 × $0.99), not a
claim about anything. It is stated as a bound precisely so it cannot be quoted
as a finding.

Every one of the 7,569 belongs to a demo, test or seed organization — see the
table above. **No real donor is on this list, because there are no real donors
in production.** There is nothing here for a human to decide and no one to
write to. If a real file is ever imported before Part 2 lands, this becomes a
live problem the same day; that is what Part 2 exists to prevent.

## Bucket 3 — documents already in a donor's hands

```
receipts issued against a whole-dollar gift:                    8  ($7,451.00)
  of those, against a Stripe-sourced (recoverable) gift:        1
receipts differing from their gift by LESS than $1:             0   drift $0.00
receipts differing by $1 or more (edited/refunded, BY DESIGN):  0
```

**Zero.** No person holds a receipt, email or PDF whose figure disagrees with
the ledger by cents. Nothing is to be reissued, and Part 2 item 4 has an empty
list to produce.

The sub-dollar/over-dollar split is kept from BUILD-72 A-3 and is load-bearing:
a receipt is a frozen snapshot by design (BUILD-64), so a later gift edit or
refund makes it disagree correctly. Losing cents can never move a figure by a
dollar or more, so only the sub-dollar disagreement is a cents signature.

**Separate finding, not a cents defect:** four of the twelve receipts
(`rcpt_e33c498a`, `rcpt_6e5e6411`, `rcpt_59735ccf`, `rcpt_f2e734df` — $250,
$500, $1,800, $27,500) have a **NULL `gift_id`**. A receipt pointing at no gift
is an orphaned document. All four predate this build and none is a cents
problem. **Recorded here, not fixed here — carried to BUILD-74.**

## Bucket 4 — pledges, pledge payments, recurring gift amounts

```
pledges                    total 0 · whole-dollar 0 · carrying cents 0
pledge payments            total 0 · whole-dollar 0 · carrying cents 0
recurring subscriptions    total 1 · whole-dollar 1 · carrying cents 0   ($1.00)
```

The single recurring subscription is the $1.00 CREO test and carries a Stripe
subscription id. Nothing else exists to be wrong.

## The single most informative number

**Not one row in production carries cents. Anywhere.**

| Column | Rows | Carrying cents |
|---|---:|---:|
| `gifts.amount` | 7,571 | **0** |
| `gifts.cover_fee_amount` | 7,571 | 0 (and 0 non-zero) |
| `gifts.deductible_amount` | 7,571 | 0 |
| `donors.total_giving` | 4,541 | **0** |
| `donors.last_gift_amount` | 4,541 | **0** |
| `fin_transactions.amount` | 94 | **0** |
| `pledges.amount` | 0 | — |
| `recurring_subscriptions.amount` | 1 | 0 |

This is what a system that rounds at every write door looks like from the
inside. It is not proof of loss — this data is synthetic and was probably
generated in whole dollars — but it is exactly the fingerprint the defect would
leave, and it means **the very first real cents-carrying gift will be wrong.**

## How the truncation happens — the exact seam

Every one of these is a **round**, not a truncate. `$33.33 → 33` loses 33¢;
`$33.67 → 34` invents 33¢. The drift is signed, which is why the new assertion
below accumulates magnitudes rather than a net.

| # | `server.js` | Path | Expression |
|---|---|---|---|
| 1 | 4187 | `POST /donors/import-combined` — gift rows | `Math.round(rawAmt)` |
| 2 | 3943–3944 | import — `donors.total_giving`, `last_gift_amount` | `Math.round(parseFloat(…))` |
| 3 | 4135 | import (second donor-insert path) — same two columns | `Math.round(parseFloat(…))` |
| 4 | 4972 | `POST /donors/:id/gifts` — manual entry | `Math.round(Number(amount))` |
| 5 | **5108** | **`PUT /gifts/:id` — the edit path, applies to STRIPE rows too** | `Math.round(Number(amount))` |
| 6 | 5271 | `POST /donors/:id/pledges` | `Math.round(Number(amount))` |
| 7 | 5332 | `PUT /pledges/:id` | `Math.round(Number(amount))` |
| 8 | 5985 | `POST /gifts/import-history` | `Math.round(rawAmt)` |

Paths that do **not** round, and are the proof the storage can hold cents
already:

| `server.js` | Path | Expression |
|---|---|---|
| 340 | Stripe webhook — every online and recurring gift | `pi.amount_received / 100` |
| — | event-attendee auto-gift | `parseFloat(…)` |

**The cast is not in the database.** `gifts.amount`, `donors.total_giving` and
`donors.last_gift_amount` were migrated `INTEGER → NUMERIC` in `db.js:1068-1074`
(the cover-fees migration), and `pledges.amount`, `fin_transactions.amount` and
`recurring_subscriptions.amount` were `NUMERIC` from creation. **Every money
column in production can already store cents.** The loss is entirely in
application code, at eight call sites, before the INSERT. The comment at
`server.js:4972` still says "INTEGER column" and is stale by one migration —
which is likely how the rounding survived a schema change that removed its only
justification.

That is the seam Part 2 replaces. It is one conversion at the boundary, not
eight rounding decisions.

## THE DECISION

```
Bucket 1 (recoverable candidates):   2   → Stripe-proven drift: 0 rows, $0.00
Bucket 2 (unrecoverable candidates): 7,569 (all demo/test/seed orgs)
Bucket 3 (cents-signature receipts): 0
Bucket 4 whole-dollar: pledges 0 · pledge payments 0 · recurring 1
```

**No migration is needed. No donor is owed a corrected receipt. No human
decision is pending.** Bucket 1 was asked and is correct; bucket 2 has a
non-zero candidate count but zero real money behind it; bucket 3 is empty.

**Part 2 still happens, and happens next**, because the brief's zero-branch says
so directly — *"the write paths still get fixed in Part 2 so it cannot start
happening"* — and because the eight rounding sites are live on a product that is
one signed customer away from taking a $33.33 gift. What Part 2 does **not** do
is migrate anything: item 2 (migrate the recoverable) is a proven no-op, and
item 3 (list the unrecoverable) is the demo-org table above.

## P1-A · The assertion, added under both branches

The brief asks for one assertion on BUILD-72's import invariant. BUILD-72's A-4
already added the **total-level** form of it and recorded its own residual: per-row
rounding whose errors *cancel* (`33.33 → 33` and `66.67 → 67`, netting `100.00`
on both sides) imports cleanly, because the file's total carries no cents for a
total-scoped rule to compare against, while every affected donor's record is
individually wrong.

So the assertion is added where it is actually true — **per row**:

- `importLedger` now accumulates `rawCentsDropped`: what each row loses to
  rounding, as an **absolute magnitude**, so a `+$0.33` and a `−$0.33` cannot
  cancel each other out of existence.
- `assertBalanced()` refuses any import that would drop a single cent, names the
  full magnitude, and rolls back. There is no tolerance band — "small enough to
  ignore" is how cents disappear at scale.
- This **subsumes** the total-level rule (a total can only lose cents if some row
  did) and **closes** BUILD-72's documented residual.

Once Part 2 makes storage cents-accurate, `rawCentsDropped` is always 0 and the
assertion goes silent on its own. Until then it fails loudly rather than
absorbing money, which is the correct interim behaviour.

`tests/import-reconciliation.test.js` §7 — **65 assertions, 0 failed**:

```
PASS  a file whose cents would be silently absorbed is REFUSED (409)
PASS  CANCELLING per-row cents are REFUSED too — the guard is per-row, not per-total
PASS  ...and names the full magnitude dropped ($0.33 + $0.33 = $0.66), not the net $0.00
PASS  NOTHING was written for the cancelling file either
PASS  a single row carrying a single cent is REFUSED
PASS  a whole-dollar file still imports normally
```

## Carried to BUILD-74, not fixed here

- **Four receipts with a NULL `gift_id`** (bucket 3 above) — orphaned documents,
  predating this build.
- **The webhook donor-resolution race** (BUILD-72 S-4): two simultaneous Stripe
  webhooks create two donor rows. The import path took an advisory lock for this
  class in BUILD-27; the webhook path did not.
- **Eleven of twelve production orgs are test data**, including one named
  "Go-Live Test Shelter (DELETE ME)". Not a defect; a cleanup decision that is
  Jonathan's to make, not a migration's.


---

# PART 3 — THE DEMO'S FIRST SCREEN

## 3.1 — The results claim, and where it actually lived

The brief named the sentence: **"$2M re-engaged from 610 lapsed donors."** It was
real, and the figure was exact:

```
GET /impact (org_b72demo, the demo org)
reengagedAmount     $1,980,614.00
reengagedDonorCount 610
```

It rendered in **three** places, not one — the Home hero chip
(`Re-engaged · $2M · 610 lapsed donors came back`), the Home impact line
("Steward has recovered $X … and re-engaged $Y from N lapsed donors"), and the
same sentence duplicated in Settings' value banner and billing ROI card.

**The mechanism.** `reengagedAmount` sums every gift that followed a >365-day
gap, across all history. On an org with a decade of giving that is a large
number by construction — it describes the ORGANIZATION'S past, and nothing about
Steward. But the sentence begins "**Steward has** …", and on the first screen a
prospect sees, nobody parses it as anything but money Steward brought in.

## 3.2 — Fixing by framing meant fixing the MEASURE, not the label

The brief says "$2M at risk across 610 quiet donors" is "the same data, honest on
its face." Relabelling the re-engagement sum as "at risk" would have been a
different untruth: gifts that already arrived after a gap are not money at risk
today. So the figure now measures what the words say.

**`atRiskAmount` = Σ lifetime giving of donors who have gone quiet.** A fact
about the org's own file, claiming nothing.

**The threshold is the product thesis, and it is 180 days, not 365.** This is
where 3.1 and 3.2 meet. Leading with the 365-day lapsed set tells the
lapsed-recapture story — donors already gone — which is the story every other
tool tells, and exactly what 3.2 says to avoid. Leading at 180 days surfaces the
donors who are *drifting*, while every lifetime-total report still shows them as
fine. `computeMoveSuggestions` already fired a `going_quiet` signal at 180 days
with the reason *"reach out before they lapse"* — the threshold existed; the
headline figure just wasn't using it. It is now `QUIET_DAYS`, named beside
`LAPSE_DAYS` so the two cannot drift apart unnoticed.

**The demo's first screen now reads:**

```
AT RISK
$2,006,865
544 quiet donors · no gift in over 6 months
```

Same magnitude the brief expected, describing money genuinely at risk, and — the
point — **the eleven drifted mid-level donors are inside it.** At the 365-day
line they were not: they last gave 286–294 days ago, so a lapse-based figure
would have opened the demo on a set that excludes its own thesis.

## 3.3 — The copy shipped wrong for one build, and that is now impossible

The chip rendered `544 quiet donors · no gift in over a year` while the server's
threshold was 180 days. The number and the sentence were maintained in different
files. Every surface now derives the phrase from the payload
(`quietPhrase(impact.quietSinceDays)` in `client/src/lib/money.js`), and
`reserved-recovered` pins both the pure function and the absence of a hardcoded
duration in the Dashboard source.

## 3.4 — The ban, asserted on the family

`tests/reserved-recovered.test.js` was BUILD-26's "recovered is a reserved word"
grep. It is now the **outcome-claim ban**: `recovered`, `re-engaged`/`reengaged`,
`recaptured`, `won back`, `brought back` — banned in **user-facing copy** across
app UI, emails, PDFs, CSV headers, the demo seed and the landing page (78 files
scanned).

**How it tells copy from code.** The scan reads **string literals and JSX text**
and ignores identifiers, snake_case keys, SQL, console output and interpolated
`${…}` expressions. So `recoveredAmount`, `recovered_at`, `payment_recovered`
and the `recovered` subscription status survive untouched — renaming a database
column makes no claim to anybody — while a rendered sentence cannot.

**Deliberately NOT banned: "recovery" and "recovering" as PROCESS nouns** —
"failed-card recovery", "recovery emails", "Needs recovery", the
`lapsed_recovery` goal type. Those name a workflow Steward genuinely runs. The
banned words are all **past-tense outcomes**, which is the shape that reads as a
results claim. Drawing the line at tense rather than at the word root keeps a
feature honestly nameable while making the overclaim unshippable. My first draft
banned the root and flagged ten legitimate feature names; that was over-reach and
is recorded here rather than quietly narrowed.

**The scan is proven capable of failing** — it is driven against the exact
sentence the demo used to open on, and asserted not to flag an identifier.

**Rewritten copy, every surface:**

| Surface | Was | Now |
|---|---|---|
| Home hero chip | `Re-engaged · 610 lapsed donors came back` | `At risk · 544 quiet donors · no gift in over 6 months` |
| Home impact line | `Steward has recovered $X … and re-engaged $Y` | `$2.0M at risk across 544 quiet donors` |
| Home drill-down | `Re-engaged giving` | `Money at risk` |
| Settings banner + billing ROI | the same sentence, twice | the at-risk framing |
| Impact detail rows | `Recovered (automated)` · `Re-engaged (surfaced)` | `At risk right now` · `Failed cards, retried automatically` · `Gifts after a year-long gap` |
| Annual Fund metric card | `Lapsed Recovered` | `Returned After a Gap` |
| Recurring status chip + CSV header | `Recovered` | `Card fixed` |
| Auto-move description | `Auto: re-engaged — new gift` | `Auto: new gift after a year-long gap` |
| Webhook task title | `Re-engaged via online gift` | `Gave again after a year-long gap` |
| Gold moment | `A recurring gift came back.` | `A failed card was fixed.` |
| In-app landing | `Watch retention and recovered gifts climb` | `Watch retention climb and the at-risk number fall` |

**Verified on the rendered page**, not just in source: every banned word absent
from the demo's Home screen DOM (`docs/build73-demo/first-screen-1440.png`).

## 3.5 — The seed had drifted, and the assertion caught it

The BUILD-72 Part 5 shape held: **1,072 donors · top 200 carry 87.5% · top decile
72.5% · eleven drifted donors present.** But two of the eleven were **not quiet**:

```
Marguerite Ashgrove  last gift 192 days ago
Halvard Bellwether   last gift 117 days ago
```

The pledge fixtures hung off `driftedIds[0]` and `driftedIds[1]`, attaching
current-year pledge PAYMENTS to two of the eleven and silently un-drifting them.
Nothing said so: the seed printed *"the eleven drifted mid-level donors: 11"*
either way, because it counted the list rather than checking the shape. **That is
exactly the drift 3.2 describes, and `tests/demo-shape.test.js` found it on its
first run.**

Fixed by giving the pledges their own donors (Isolde Fennimore, Barnaby
Thistlewood). The `past_due` recurring subscription stays on one of the eleven
deliberately — a failed card is a real reason a reliable mid-level donor goes
quiet, and a subscription row carries no gift, so it does not break the silence.
It is the story, not a contradiction.

**`tests/demo-shape.test.js` (17)** asserts the shape as RANGES exported from the
seed itself (`SHAPE`), never duplicated in the test:

- top-decile revenue share within `[62%, 82%]` · top-200 within `[82%, 93%]`
- explicitly **not flat** (>50%) and **not absurdly top-heavy** (<95%) — both
  read as fake to a fundraiser
- all eleven present, mid-level by lifetime giving, 4+ gifts each, quiet >180
  days, **not yet lapsed** (<365), each assigned to a person
- the eleven are INSIDE the figure the demo opens on
- the at-risk count (544) exceeds the lapsed-only count (347) — the figure is
  about drift, not recapture

## 3.6 — A real bug this part introduced, and how it was caught

My first at-risk query compared `gifts.date` — a **civil date** — against
`CURRENT_DATE`. That is precisely the class BUILD-72 Part 4 closed: the figure
would have flipped for every org west of UTC for part of each day.
`tests/date-seam.test.js` failed immediately (`unrouted civil-date sites: 99,
baseline 97`). Routed through `orgTime.addDays(orgToday(await orgTz(orgId)), …)`
— one cutoff, computed once, in the organization's own calendar. Baseline back
to 97, one more site routed.

## Known intermittent, recorded rather than swept

`tests/donor-linking.test.js` §S-12 failed **once** in a full-battery run
(`claim.status` not 200 → `/account/me` returned no `links`, so `.length` threw)
and passes on every isolated run (3/3) and on a clean re-run of the full battery
(109 suites, 0 failed). Not on any path this build touched. Same class as
BUILD-72's S-4 webhook-ordering flake — recorded, not fixed, and not claimed as
green when it was not.

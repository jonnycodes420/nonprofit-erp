# BUILD-84 — decisions for Jonathan, and one thing that must be chosen before this ships

Nothing in this build was blocked from being *built*. Three calls are yours, and
the first one is load-bearing: the map has no pins in production until you make
it.

---

## 1. THE GEOCODING PROVIDER — required before the Map does anything in prod

P0-4 replaced render-time browser geocoding with a write-time server job behind
a provider seam (`geocode.js`). **The seam has three states and production is
currently in the third one**: no provider configured → the job does not run, no
donor address leaves the server, and the map says so in a sentence. That is
correct and honest, and it means **the Map shows no pins until you choose.**

**DECIDED: Geocodio** (Jonathan, 2026-09-10). Set `GEOCODIO_API_KEY` on Railway
and the map starts filling in on the next tick. Nothing else to change.

| | Geocodio | Self-hosted Nominatim |
|---|---|---|
| Coverage | US + Canada — matches the customer base | worldwide |
| Cost | **2,500 lookups free every day**, then $1.00 per 1,000 ($0.001 each) — 1 Feb 2026 pricing | no per-lookup bill |
| A 25,000-address first import | **$22.50** in one day (2,500 free + 22,500 billed), or **$0.00** spread over ten | free |
| The 444-row lead list | **$0.00** — 408 lookups, inside the daily free allowance | free |
| Operational surface | none | a service to run, update and monitor — which you have said you do not currently want |
| To turn on | set `GEOCODIO_API_KEY` on Railway | set `GEOCODE_NOMINATIM_BASE` to your instance |

### What the map actually costs — the sentence to give an ED

**The billable unit is a distinct ADDRESS, not a donor**, and only a new or
changed one. The queue de-duplicates by address before it spends anything and
never re-resolves an address it already holds, so a steady-state org spends
nothing at all: only new donors and address edits are lookups.

**Measured here, against a mock provider, on the real 444-row file:** 444 donors
→ **408 distinct addresses** → **one** batched request, 26 ms. A re-run spent
**zero**. At Geocodio's pricing that import costs **$0.00** — 408 is well inside
the 2,500-a-day free allowance.

*(An earlier draft of this file said $0.41 for that import and $25 for a
25,000-donor one. Both were list price with the free allowance never applied,
and the second also quoted a cost per DONOR rather than per distinct address.
Corrected above — it is the number you would be quoting if a customer asks what
the map costs.)*

Two things follow whichever way you go:

- **`audit/data-handling.md` currently says the provider is PENDING.** It has a
  full section on what is sent (address fields only — never name, email, phone,
  giving history or record id) and what is retained. **That table must name the
  provider actually in use before this document goes in front of an ED.**
- The **public** Nominatim instance is refused by hostname in code, not by
  convention. Do not try to route around it: that was the terms problem, and
  leaving it reachable would put it one environment variable away.

---

## 2. The receipt names the file's currency columns — you may want it quieter

Acceptance criterion 1 asked for a receipt on `steward-leads.csv` that "names no
dollars, because that file has none". P0-1's own rule says the opposite for this
file: *"When more than one column qualifies, scan all of them and name each one
in the receipt with its own subtotal"* — and the spec explicitly lists
`revenue`, `contributions`, `deficit` and `contrib_lost_yoy` as columns holding
real dollars, and requires `contrib_lost_yoy` to pass the qualifier test.

**I followed the rule, not the acceptance line**, and the receipt reads:

> *5 columns in this file read as currency — "revenue" $386,923,121 · "expenses"
> $357,018,765 · "contributions" $93,358,920 · "deficit" $18,736,986 ·
> "contrib_lost_yoy" $14,032,461 — and none was mapped as a gift amount, so
> there is nothing to reconcile against.*

What acceptance 1 was protecting is delivered either way: no gift figure is
claimed, no balance is asserted, the dollar equation is not anchored, and the
arithmetic panel says "no column is mapped as the gift amount" rather than
pretending. What is at stake is only whether the subtotals are shown.

*To take the quieter reading:* one line in `Donors.jsx` — drop `curList` from
the sentence and keep the count ("5 columns in this file read as currency, and
none was mapped as a gift amount"). `tests/build84.test.js` §1 pins the scanner,
not the sentence, so nothing else moves.

My reason for leaving them in: an ED importing a file with a `contributions`
column that she *meant* to be gift totals gets told, by name and by figure, that
it was not read as money. Suppressing the subtotal is the version of this screen
that lets $93M go quiet.

---

## 3. Every existing org must click Settings → Time zone before it can set a time

The timed step reminder (the FEATURE) refuses to fire at a guessed hour.
`orgs.timezone` has always been `NOT NULL` with an `America/New_York`
**default**, so "has a timezone" has been trivially true for every org and has
meant nothing. This build adds `orgs.timezone_confirmed_at` — a timezone a
**human chose**.

- **New orgs**: onboarding now asks, prefilled from the browser's zone. One
  click, invisible.
- **Existing orgs**, including yours and every live customer: the time field is
  **not offered** until someone opens Settings and picks the zone (which stamps
  the confirmation). Until then the next-step form says so in a sentence and
  everything else behaves exactly as it did.

That is the strict reading of *"if no timezone is on file the feature is
unavailable for that org and the task form says so."* **If you would rather
existing orgs be grandfathered in on the America/New_York default**, it is one
statement in `db.js` — backfill `timezone_confirmed_at = NOW()` for existing
rows — and I would rather you decide that than have me quietly decide a 2:00
reminder can fire in a zone nobody confirmed.

---

## Also worth your eye

- **`donors.kind` is now the donor type**, and takes three explicit values:
  `person` | `organisation` | `anonymous`. It already existed (BUILD-80 Part 7)
  and already gates every person surface, so no new column was added for it;
  the import now writes `person` explicitly instead of leaving NULL, so "unset"
  and "a person" stop being the same value. Legacy NULL rows still read as
  people. `donors.contact_name` is new. (`donors.donor_type` is unrelated — it
  is BUILD-82's pass-through of a source file's own "Donor type" column. If the
  two names bother you, say so and I will rename the BUILD-82 one.)
- **Two BUILD-83 contract leftovers were closed in passing** —
  `POST /donors/import` and `POST /gifts/import-history` were still writing
  `stage` as though an inference were a decision. Both write `suggested_stage`
  now. This changes what a gift-less import puts on the Kanban: nothing is
  placed until a human places it, which is BUILD-83's rule finally applied to
  every path.
- **The timed reminder goes to ONE person** — the thread's owner, else its
  creator, else the org. A time is one person's commitment, not the org's. The
  morning digest still goes to everyone, unchanged. Say the word if you want the
  timed one to fan out the same way.
- **The delivery window is 90 minutes.** A 2:00 reminder delivered at 5:00 has
  lost the only thing that made it worth sending, so a server that was down
  through the window drops that reminder rather than sending it late. It rejoins
  the next morning's digest as overdue, so nothing is lost — it just arrives as
  a list instead of a moment.

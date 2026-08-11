# BUILD-45 — two dashboard defects found in live review (2026-08-08, pre-Fairhope)

Scope: the two demo-visible UI defects Jonathan found on prod (D-1, D-2), plus
the demo-data junk cleanup (D-3). This file is the required write-up for the
**D-2 diagnosis** ("diagnose first, then fix — do not assume") and records the
D-1 routing note and the Fix B seed arithmetic.

---

## D-2 · DIAGNOSIS — the three `$0` tiles are ARITHMETICALLY CORRECT (no aggregation bug)

**Verdict: there are ZERO ask (opportunity) records in the demo org.** The tiles
read `$0 / 0 open / 0 won` because the org has never had an ask logged — not
because a rollup is broken. This is diagnosis outcome **#3** in the brief ("If
zero asks exist, the tiles are arithmetically correct and both fixes below still
apply"). Fix A (stop rendering `$0` for absence) and Fix B (seed believable
asks) both proceed.

### How it was confirmed (prod demo org `org_creo`, via the live API, 2026-08-08)

The `opportunities` table is Steward's "asks" table (see server.js
`POST /donors/:id/opportunities`, the `moves`/pipeline system). There is no
raw-table dump endpoint, so the org-wide ask counts were read from the two
aggregate surfaces that sum every opportunity in the org:

1. **`GET /reports/solicitations`** — org-wide, all officers:
   - `forecast.open = 0`, `forecast.weighted = 0`, `openPledges = 0`
   - `byStage`: every one of the six stages `count 0 · ask 0`
   - `byOfficer`: **all three officers** (`user_admin` "Admin User",
     `user_jonathan` "Jonathan", `user_0a9d3327` "Jonathan Atkinson") report
     `openAsks 0 · asksMade 0 · giftsClosed 0 · winRate null`
   - `aging: []`
2. **`GET /pipeline?scope=all`** — the board itself: **16 donors** on the board
   (prospect 2 · qualify 1 · cultivate 0 · solicit 4 · steward 9 · lapsed 0),
   and **every single card** reports `askAmount 0 · openOppCount 0`.
3. `GET /pipeline` forecast: `{open:0, weighted:0, openCount:0, wonThisPeriod:0, wonCount:0}`.

Both the **counts** (0 open, 0 won across every officer and every stage) and the
**sums** ($0) are zero, and no card carries an open opportunity. That is the
signature of "no ask records exist at all," not a broken aggregation (a rollup
bug would show non-zero counts summing to $0, or cards with asks the header
ignores). The subtitles `0 open` / `0 won` were the tell, exactly as the brief
predicted.

**No new HIGH finding.** The rollup code (`GET /pipeline` forecast in server.js,
`STAGE_WEIGHT`-weighted) is correct; it had nothing to sum. No goal-rollup
assertion was added for an aggregation bug because there is no aggregation bug;
instead `tests/pipeline.test.js` continues to pin that a zero-opportunity board
returns `openCount:0 / wonCount:0` and a seeded board returns the exact sums
(see Fix B).

### The 16 donors on the board (for reference / Fix B sizing)

| id | name | stage | lifetime | last gift | last gift $ | gifts |
|---|---|---|---|---|---|---|
| d1 | Margaret Chen | steward | $100,000 | 2026-08-04 | — | — |
| d4 | Sunrise Foundation | **solicit** | $91,500 | 2026-06-16 | $1,500 | 5 |
| d6 | William Park | **solicit** | $31,700 | 2026-04-30 | $25,000 | 8 |
| dseed_06 | Julian Marsh | **solicit** | $25,000 | 2026-05-20 | $10,000 | 3 |
| dseed_05 | Vanessa Cole | **solicit** | $12,500 | 2026-07-07 | $4,500 | 3 |
| d3 | James Okafor | steward | $15,200 | 2026-05-16 | — | — |

(steward/prospect/qualify donors omitted except those used by Fix B's closed asks.)

---

## D-1 · ROUTING NOTE — `/donors/:id` was NOT a route; a minimal deep-link route was added

The brief requires the attention-row main to be a **real `<a href="/donors/:id">`**
that survives cmd-click / middle-click / "open in new tab", and its committed
test asserts `href === "/donors/" + donorId`.

**Conflict with the actual code:** the SPA (`client/src/main.jsx`) had **no
`/donors/:id` route**. Donor profiles are opened via in-app state
(`onNavigate("donors",{selectDonorId})`) while the URL stays `/dashboard`, and
the router's catch-all (`path="*"`) **redirects any unknown path to `/`** (the
public landing page). So a literal `<a href="/donors/d4">` would, on cmd-click,
have opened a new tab that lands on the **landing page** — the exact opposite of
the goal.

**Resolution (implemented, flagged here for morning review):** rather than ship a
fake anchor or write this off as BLOCKED, the required URL was made real. A
minimal deep-link route was added:

- `client/src/main.jsx`: `<Route path="/donors/:donorId" element={<RequireOnboarded><App/></RequireOnboarded>} />`
  (before the catch-all).
- `client/src/App.jsx`: on mount, if `location.pathname` matches `/donors/:id`,
  the shell opens that donor's profile (`navigateTo("donors",{selectDonorId})`)
  and `replaceState`s the URL back to `/dashboard` — the same pattern already
  used for `?stripe_connected` / `?subscribed`.

This is the smallest change that makes the specified href genuinely navigable
(fresh load, cmd-click, middle-click all land on the donor). It touches routing,
which the brief scoped tightly ("do not refactor anything else"), so it is called
out explicitly here: **the brief assumed `/donors/:id` already existed as a
linkable URL; it did not, so it was created.** No other routing behavior changed.

---

## D-2 Fix B — asks seeded into the demo org (`scripts/seed-build45-asks.js`)

Run against **prod `org_creo`** on 2026-08-08. The script is idempotent (any
existing opportunity → strict no-op) and reversible (every row is a normal
`opportunities` record). Each open ask is a credible step up from that donor's
own history and **never exceeds 2× their largest prior gift** (computed per
donor, printed with the cap).

### Open asks (all four Solicit-stage prospects)

| Donor | Last gift | Largest prior | 2× cap | **Ask** |
|---|---|---|---|---|
| Sunrise Foundation | $1,500 | $25,000 | $50,000 | **$32,500** |
| William Park | $25,000 | $25,000 | $50,000 | **$32,500** |
| Julian Marsh | $10,000 | $10,000 | $20,000 | **$12,500** |
| Vanessa Cole | $4,500 | $5,000 | $10,000 | **$7,500** |

### Weighted forecast — reconciles by hand (all open asks are Solicit → weight 0.7)

```
$32,500 × 0.7 = $22,750   (Sunrise Foundation)
$32,500 × 0.7 = $22,750   (William Park)
$12,500 × 0.7 =  $8,750   (Julian Marsh)
 $7,500 × 0.7 =  $5,250   (Vanessa Cole)
────────────────────────────────────────────
OPEN ASKS          = $85,000   (4 open)
WEIGHTED FORECAST  = $59,500
```

### Closed asks (dated now → inside the current fiscal year FY2027, Jul 2026–Jun 2027)

- **Closed-won:** Margaret Chen **$62,500**, Elena Marchetti **$10,000** → `CLOSED THIS FY = $72,500 (2 won)`.
- **Closed-lost:** Priya Anand $7,500 → so the board is not a fake 100% win rate.

### The tiles now read (verified live on prod after seeding)

`GET /pipeline` (the demo admin's default scope, which owns all 16 board donors):
```
open=$85,000  weighted=$59,500  openCount=4  wonThisPeriod=$72,500  wonCount=2
```
`GET /reports/solicitations` → officer **win rate 33.3%** (2 closed of 6 asks) — honestly not 100%.

So the header now reads **OPEN ASKS $85,000 · WEIGHTED FORECAST $59,500 · CLOSED THIS FY $72,500**, all wired to real records rather than decorative.

### Design question flagged, NOT changed this build

The pipeline cards show `$X given` (lifetime giving). On a *prospect* pipeline
the number a development officer wants on the card face is the **ask amount**,
with lifetime giving secondary. Recorded here as a design question per the brief;
not changed in BUILD-45.

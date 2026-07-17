# BUILD-05 — Load Test Report: Steward at 25,000 Donors

**Date:** 2026-07-16 · **Verdict: tested to 25k donors / 200k gifts / 150k interactions — every hot path sub-second after fixes; before them, the Home screen was unusable at this scale (>15 min per load).**

Everything ran against LOCAL infrastructure (real `server.js` + real local PostgreSQL 16), never production. Harness: `scripts/seed-loadtest.js` (deterministic synthetic org) + `scripts/loadtest.js` (autocannon driver) — both committed, rerunnable.

## Environment

| | |
|---|---|
| Machine | Apple M5, 10 cores, 16 GB RAM |
| Runtime | Node v22.23.1, PostgreSQL 16.14 (Homebrew), localhost, self-signed SSL |
| Server | real `server.js`, `DISABLE_RATE_LIMIT=1`, Anthropic base URL pointed at a dead port (AI calls fail instantly), dummy Resend key |
| DB tuning | `fsync=off`, `synchronous_commit=off` on the scratch cluster — **write** timings are flattered vs. production; read timings are unaffected (dataset fits in RAM) |

Production is Supabase over a network hop, so absolute numbers there will be worse across the board. The findings here are the *complexity cliffs* and the *relative* before/after — those transfer.

## Seed profile (deterministic, `scripts/seed-loadtest.js`)

- **org_loadtest** — 25,000 donors, 202,561 gifts (power-law: ~1% majors with 10–60 gifts, long small-gift tail), 150,000 interactions, 500 recurring subscriptions (5% at-risk), 50 grants, 20 funds, 20 campaigns; dates spread over 6 years so LYBUNT/retention/lapsed predicates do real work. Donor aggregates (total_giving, first/last gift, gift_count) derived from the generated gifts, not invented.
- **org_smalltest** — 300 donors / 2,051 gifts / 1,500 interactions (noisy-neighbor probe).
- **org_importtest** — empty; target for import timings.

## Headline before/after (single request, seconds unless noted)

| Endpoint | Before | After | Factor |
|---|---:|---:|---:|
| `GET /metrics/stewardship-summary?scope=all` (Home) | **>900 (timed out)** | **0.74** | >1,200× |
| `GET /metrics/stewardship-summary` (mine — the default Home call) | **>900 (timed out)** | **0.28** | >3,200× |
| `GET /dashboard/stewardship-debt/breakdown?scope=all` | 210.0 | 0.12 | 1,750× |
| `GET /reports/lybunt` | 69.5 | 0.17 | 409× |
| `GET /reports/sybunt` | 112.3 | 0.27 | 416× |
| `POST /donors/import-combined` 8k donors + 64k gifts | 64.6 | see import section | ~19× per row |
| `POST /donors/import-combined` 25k donors + 200k gifts | **impossible** (12.6 MB payload vs 5 MB body cap → request rejected) | (25k number below) | n/a |
| small org (300 donors) `stewardship-summary?scope=all` | 33.8 | 0.03 | 1,130× |
| `GET /donors` | 0.38 (but 21.7 MB payload) | 0.38 (unchanged — see "next cliffs") | — |
| `GET /dashboard/today` | 0.08–0.15 | 0.08–0.15 | already fine |
| `GET /reports/giving-summary`, `retention`, `top-donors`, `by-group`, `/goals/active`, `/recurring/health`, `/donors/:id` | all ≤0.46 | same | already fine |

Baseline concurrency check: LYBUNT at 10 concurrent connections produced **100% timeouts** (>10s each, 30/30); after fixes it serves the same load at p95 in the low hundreds of ms (table below).

The noisy-neighbor result deserves emphasis: the small org's Home screen took **33.8s purely because it shares the interactions table with a big org** — each of its 300 correlated subqueries seq-scanned all 151k rows. This wasn't CPU contention; it was shared-table scan cost. Post-index: 0.03s.

## Root causes (EXPLAIN evidence)

1. **`interactions` had no index at all beyond its primary key.** The Stewardship Debt / First-Touch Delay metrics each run a correlated per-donor subquery (`MAX(i.date)` / `MIN(i.date)` per donor). Plan: `Seq Scan on donors (cost=136,927,847)` with a per-row SubPlan `Seq Scan on interactions (cost=5,745)` × 23,832 executions. Same shape for first-touch at cost 145,930,253. These two run on **every Home load** (`/metrics/stewardship-summary` computes live by design) and inside the 6-hourly `snapshotAllOrgMetrics()` sweep for every org.
2. **`gifts` had only org-leading indexes** (`(org_id,date)` etc. from BUILD-02). Every per-donor path — LYBUNT/SYBUNT's three correlated EXISTS/SUM subqueries, `recalcDonorSummary()` (3 queries/donor after import), donor profile gift fetch, lapsed-recovery goal math — scanned the whole gifts table per donor.
3. **`computeRetentionRate` fetched `SELECT *` of all 202k gifts** (~70 MB of heap churn per Home load) when it reads only `donor_id` and `date`.
4. **The global 5 MB `express.json` cap made a 25k-row combined import physically impossible** (the payload is 12.6 MB) — a mid-size org could not complete onboarding step 2 at all.

## Fixes applied (smallest change that measurement justified)

1. **Three indexes** (db.js `initSchema`, `IF NOT EXISTS`, auto-created on next deploy boot):
   - `idx_interactions_donor_date (donor_id, date)`
   - `idx_interactions_org_donor_date (org_id, donor_id, date)` — the `/donors` last-touchpoint GROUP BY (74→54 ms, runs on every Directory load)
   - `idx_gifts_donor_date (donor_id, date)` — this alone took LYBUNT 69.5s→0.20s and SYBUNT 112s→0.27s with **zero SQL changes**, and is what makes import recalc and donor profiles cheap.
   - One-time cost: first boot after deploy built all three against the 25k-org dataset in ~2 min (subsequent boots: 2s). Expect a comparable one-time window on the production deploy.
2. **Correlated subquery → `LEFT JOIN … GROUP BY` rewrites** in `computeStewardshipDebtBreakdown()` and `computeFirstTouchDelay()` (server.js). Measured equivalent: `EXPLAIN ANALYZE` 166 ms / 140 ms; SQL-level parity (`old EXCEPT new` both directions) returned **0 rows** across all 23,832 donors. (With the new indexes the old form also runs in ~166 ms — the rewrite removes the dependence on per-donor index descents and keeps the path safe if the index set ever changes.)
3. **`computeRetentionRate`: `SELECT *` → `SELECT donor_id, date`.** The JS year-bucketing deliberately stays (documented timezone-parity constraint with `/annual-fund`).
4. **Import body cap**: a 30 MB `express.json` parser mounted only on `/donors/import-combined`, `/donors/import`, `/gifts/import-history`; the global 5 MB cap stays for every other route.
5. **Harness hook**: `DISABLE_RATE_LIMIT=1` skips the general + login rate limiters so a local benchmark measures route cost, not limiter 429s. Not set in production.

Deliberately **not** changed: `GET /dashboard/today` (already fast — its one full-scan dependency, `computeAtRiskCandidates`, is a single donors-table scan, ~20 ms), reports other than *BUNT, `/goals/active`, export, and `GET /donors` pagination (see next cliffs).

## After — sustained load (autocannon, 30s × 10 connections)

All targets, 30s at 10 concurrent connections, zero errors/timeouts everywhere ("p95" column is autocannon's p97.5 — its percentile set has no p95, and p97.5 ≥ p95, so these are conservative):

| Target | p50 | p95 | p99 | req/s |
|---|---:|---:|---:|---:|
| `GET /metrics/stewardship-summary?scope=all` | 4,529 ms | 5,182 ms | 5,234 ms | 2.0 |
| `GET /metrics/stewardship-summary` (mine) | 1,692 ms | 2,536 ms | 2,537 ms | 5.3 |
| `GET /dashboard/stewardship-debt/breakdown?scope=all` | 459 ms | 677 ms | 776 ms | 21.4 |
| `GET /dashboard/today?scope=all` | 383 ms | 536 ms | 574 ms | 25.6 |
| `GET /dashboard/today` (mine) | 300 ms | 520 ms | 616 ms | 32.4 |
| `GET /donors` (21.7 MB payload) | 3,148 ms | 3,731 ms | 3,848 ms | 3.0 |
| `GET /donors/:id` (105-gift profile) | 7 ms | 10 ms | 11 ms | 1,277 |
| `GET /reports/giving-summary` | 233 ms | 336 ms | 382 ms | 41.3 |
| `GET /reports/lybunt` | 522 ms | 669 ms | 697 ms | 19.0 |
| `GET /reports/retention` | 929 ms | 1,160 ms | 1,174 ms | 10.5 |
| `GET /goals/active` | 3 ms | 6 ms | 8 ms | 2,675 |
| `POST /auth/login` (bcrypt) | 992 ms | 1,305 ms | 1,483 ms | 10.0 |

Reading the two slowest rows honestly: the stewardship-summary stack is ~450 ms of real CPU per request post-fix, so ten simultaneous requesters queue to ~5 s — that's ten *different staff members* loading Home in the same instant for one org, not a realistic single-org pattern (each individual load is 0.3–0.7 s). `GET /donors` is pure payload (63 MB/s of JSON), unchanged by design — see next cliffs. Baseline comparisons where the baseline could complete at all: donor profile p95 156 ms → 10 ms; today?scope=all p95 488 → 536 ms (unchanged, within noise); giving-summary p95 372 → 336 ms (unchanged); LYBUNT went from 30/30 timeouts to p95 669 ms. Retention's p95 crept from 890 ms → 1,160 ms because the two import tests grew the shared gifts table from 205k to ~470k rows between runs — a table-growth effect, not a regression from these changes.

Noisy-neighbor probe (after): with the big org under sustained stewardship-summary load, the small org's `/dashboard/today` held p50 16 ms (identical to unloaded) with a p95 of 3.2 s — ordinary CPU contention at deliberate saturation. At baseline the small org was 33.8 s *unloaded* (its subqueries seq-scanned the shared interactions table); that structural coupling is gone.

Zip export at 25k donors: 3.0–4.1 s, 4.2 MB, streamed — fine for an admin one-click action.

## Import at scale

- Baseline (old indexes, 8k donors + 64k gifts — the largest payload the old body cap allowed): **64.6s**, dominated by `recalcDonorSummary`'s 3-queries-per-donor loop, each seq-scanning gifts.
- After (new indexes, full 25k donors + 199,975 gifts, 12.6 MB payload): **23.8s end-to-end, all 25,000 created** — per-donor cost fell ~8.5× (8.1 ms → 0.95 ms) while the payload tripled, and the request only exists at all because of the body-cap carve-out.
- The recalc loop is still N+1 (3 round trips per donor) — it's just cheap N+1 now. Worth batching if import volume grows another order of magnitude.

## Background jobs

- `POST /sequences/process` (autoEnroll enrollment sweep across the 25k-donor org): **166 ms**, enrolling 605 at-risk/milestone candidates. The per-enrollment draft *processing* step is Anthropic-API-bound, not DB-bound — out of scope for a DB load test (each pending draft costs one model call at whatever the API's latency is; the hourly job processes them serially).
- `snapshotAllOrgMetrics()` (6-hourly, per-org debt/first-touch/retention/recovery): was the same >10-minute pathology per 25k-donor org as the live endpoint; now ~0.5s per org via the same fixed functions.

## Verification that behavior didn't change

- **SQL-level parity**: for both rewritten aggregates, `(old query EXCEPT new) UNION (new EXCEPT old)` = 0 rows over all 23,832 donors.
- **Endpoint-level parity**: 23 captured responses (big + small org: donors, profile, today ×2 scopes, summary ×2, breakdown, all six reports, goals, recurring health, stage-counts) diffed before vs. after with id-normalized ordering. All value-bearing endpoints byte-identical. The only diffs were clock movement — the captures straddled UTC midnight, so `daysSinceContact`/`daysOverdue` advanced by exactly 1, the goal banner's trailing-7-day window shifted one day, and trend arrays gained the new day's snapshot. Hand-checked one: a donor's debt contribution rose by exactly totalGiving/1000/30 — one day's worth.
- The old scripted suites from BUILD-02/03 were never committed (torn down with their session's infra), so this capture-and-diff replaces them for this pass.

## Documented ceiling

**Tested to 25,000 donors / 202,561 gifts / 150,000 interactions per org, with a second org sharing tables.** At that scale, post-fix: every read endpoint ≤1s single-request; Home-screen metric stack 0.3–0.7s per request (p95 2.5–5.2s only under 10 simultaneous same-org loads, which is CPU queuing, not I/O); full CSV export ~3s; 25k-row import 23.8s; hourly job sweeps sub-second per org.

## Next cliffs (ranked, what breaks at 100k donors)

1. **`GET /donors` ships the whole org** — 21.7 MB of JSON per Directory/Kanban load at 25k donors (~87 MB at 100k, plus 25k-row DOM rendering client-side). Server-side time is fine (0.4s); the payload is the cliff. Fix is invasive by design (Directory, Kanban, and several client features read this one response; onboarding and exports assume it) — server-side pagination for the Directory list + stage-windowed fetches for the Kanban, per the BUILD-05 spec's own scope warning. Flagged, not attempted here.
2. **`computeRetentionRate` still JS-buckets every gift row** — 200k `new Date()` calls per Home load today (~150 ms); ~1s at 100k donors. The blocker is the documented timezone-parity constraint with `/annual-fund`; moving both to one SQL definition (and accepting/verifying the boundary-date semantics) is the fix when it's due.
3. **Import recalc N+1** — 3 round trips × donors imported. Cheap per-trip now, but a 100k import is 300k round trips; batch into set-based UPDATEs when imports that size appear.
4. **autoEnroll existence checks** — one SELECT per candidate donor per sweep (605 today). Harmless now; batch the check into one `WHERE donor_id = ANY(...)` when candidate counts reach tens of thousands.
5. **bcrypt login** — p95 1.4s at 10 concurrent logins (pure CPU, cost factor 10). Not a defect (it's the point of bcrypt); worth knowing it serializes at ~10 logins/s/core.

## Appendix — EXPLAIN excerpts

Before (stewardship debt, per-donor correlated subquery — the same shape as first-touch at cost 145.9M):

```
Seq Scan on donors d  (cost=0.00..136927847.73 rows=23832 width=60)
  Filter: ((deleted_at IS NULL) AND (total_giving > 0) AND (org_id = 'org_loadtest'))
  SubPlan 1
    ->  Aggregate  (cost=5745.49..5745.50 rows=1 width=32)
          ->  Seq Scan on interactions i  (cost=0.00..5745.48 rows=5 width=11)
                Filter: ((donor_id = d.id) AND (type = ANY ('{call,meeting,email,stewardship}')))
```

After (LEFT JOIN + GROUP BY rewrite, same result set — parity-checked):

```
EXPLAIN ANALYZE ... LEFT JOIN interactions i ON i.donor_id = d.id AND i.type IN (...)
                    GROUP BY d.id
Execution Time: 165.902 ms        (first-touch variant: 139.739 ms)
```

Before (LYBUNT correlated gift subqueries: only org-leading gift indexes existed, 69.5s):

```
-- per-donor: EXISTS(...gifts WHERE org_id AND donor_id AND date range) ×2 + SUM subquery
-- planner had no donor-leading index; each probed via org-wide scans
```

After (`idx_gifts_donor_date` added, **query text unchanged**):

```
Execution Time: 197.667 ms
```

`/donors` last-touchpoint GROUP BY: HashAggregate over a 150k-row seq scan, 73.9 ms → 53.6 ms with `idx_interactions_org_donor_date`.

Full plans: captured during the run (`explain_before.txt` / `explain_after.txt` in the session scratchpad; reproducible via the harness).

## Hygiene

Scratch Postgres cluster and local server torn down after the run; no artifacts in production; the only repo changes are the two harness scripts, the three indexes, the two query rewrites, the retention SELECT slimming, the import body-cap carve-out, the rate-limit test hook, and this report.

# BUILD-49 — Part 4 copy sweep: "recovered", "100% of every", P2P (report)

**Date:** 2026-08-09

## A. "100% of every" / "keep 100%" — the overclaim → REPLACED

`keep/kept 100% of every gift/dollar` implies the org receives every cent, but
Stripe's card-processing fee (~2.2–2.9% + 30¢) still applies. BUILD-39 already
corrected this on the **landing page**; the invitation pivot's note said it was
"removed everywhere," but the correction never reached the authenticated app.
BUILD-49 finishes the sweep. Replacement framing (per the brief):
**"No platform fee · no donor tip · gifts settle in your own Stripe."**

Every hit and its disposition:

| File:line (pre-build) | Context | Action |
|---|---|---|
| `client/src/components/Dashboard.jsx:56` | `ImpactLine` — "…and kept you 100% of every dollar." | **Reworded** to the fee-honest framing |
| `client/src/components/Dashboard.jsx:58` | ImpactLine watching state — "…you keep 100% of every gift." | **Reworded** |
| `client/src/components/Dashboard.jsx:59` | ImpactLine zero state — "You keep 100% of every gift — $0 paid in platform fees." | **Reworded** |
| `client/src/components/Dashboard.jsx:94` | setup value line — "…you kept 100% of every gift." | **Reworded** |
| `client/src/components/Dashboard.jsx:116` | `SETUP_ITEM_META.stripe.why` — "…you keep 100% of every gift" | **Reworded** |
| `client/src/components/Settings.jsx:1035` | value-summary line | **Reworded** |
| `client/src/components/Settings.jsx:1037` | value-summary watching state | **Reworded** |
| `client/src/components/Settings.jsx:1039` | value-summary zero state | **Reworded** |
| `client/src/components/Settings.jsx:1367` | Billing impact card | **Reworded** |
| `client/src/components/Settings.jsx:1369` | Billing impact watching state | **Reworded** |
| `client/src/components/Settings.jsx:1370` | Billing impact zero state | **Reworded** |
| `client/src/components/Settings.jsx:1395` | Stripe-connect value line | **Reworded** |
| `server.js:13133` (comment) | "org kept 100% of every gift. Not an assumption." (code comment) | Left — internal comment, not shipped copy |
| `scripts/landing-funnel-verify.js:133-134` | guard asserting the overclaim is absent | Left — guard is correct |

The true "0% **platform** fee" fact is retained wherever it appeared — only the
"keep/kept 100% of every gift/dollar" wording was removed, because that is the
part that overstates (it ignores Stripe's own fee).

## B. "recovered" — REPORTED, deliberately NOT rewritten (conflict with code)

**The brief's premise — "'Recovered' overstates what the workflow can attribute"
— does not hold in this codebase, so per the "if it conflicts with the code,
stop" rule these were reported, not blindly changed.** Here is why:

The codebase already runs a strict **reserved-word discipline** for "recovered"
(BUILD-26 Part B3, extended BUILD-32), enforced by
`tests/reserved-recovered.test.js`. "Recovered" is allowed to attach **only** to
dollars the failed-card recovery workflow *attributably won back* —
`impact.recoveredAmount`, computed **exclusively** from
`payment_recovery_events WHERE type='payment_recovered'` with a tracked amount
(events with no tracked amount are excluded, never fabricated). The test's
grep-guard actively **forbids** the overclaiming shapes
(`"$X recovered from N donors"`, `"recovered this week"`) and **permits** the
attributable ones. So the shipped uses are the narrowest-possible, correct uses —
they do not overstate.

Every "recovered" hit in shipped copy (all are the legitimate, attributable use):

| File:line | Copy | Status |
|---|---|---|
| `client/src/components/Dashboard.jsx:56` | "Steward has recovered {fmt(recovered)} in failed-card gifts" | Legitimate — `recovered` = `impact.recoveredAmount` (attributable) |
| `client/src/components/Settings.jsx:1367` | "Steward has recovered {fmt(recovered)} in failed-card gifts" | Legitimate — same source |
| `client/src/components/Settings.jsx:1035` (via clauses) | "recovered $X in failed-card gifts" | Legitimate |
| `server.js` recovery paths / `/impact` | "recovery rate", "payment_recovered", dunning/"recovery email" | Legitimate mechanism labels |

Nothing labels ordinary incoming giving as "recovered" (the BUILD-26 Home line
that once did — "$X recovered from N donors this week" — was already fixed to
"came in from N donors").

**Recommendation (Jonathan's call):** if the goal is to further hedge the word,
the honest move is a tooltip/footnote clarifying "recovered = dollars the
failed-card workflow attributably won back," **not** deleting the word — deleting
it would remove a real, measured, differentiating number and would also fight the
existing `reserved-recovered.test.js` contract. No change was made pending that
decision.

## C. Peer-to-peer denial — REPORTED (none found in shipped copy)

The brief: "The product ships P2P; the claim is false wherever it appears." A
full-repo sweep found **no place in shipped app or site copy that says Steward
does NOT do peer-to-peer.** The product genuinely ships full P2P (routes
`/give/:orgSlug/:pageSlug/:fundraiserSlug` + `/fundraiser/manage/:token`,
`peer_fundraisers` table, leaderboard, admin takedown, supporter manage flow).

The only P2P mentions:

| File:line | Copy | Verdict |
|---|---|---|
| `client/src/pages/Landing.jsx:1119` | candor list: "Live now: …, peer-to-peer fundraising pages." | **Correct** — lists P2P as live. (This whole "Where Steward is today" section is being **deleted** by BUILD-49 Part 5, so the line goes away regardless.) |
| `CLAUDE.md:880` (internal doc) | Fundraising BUILD-11 note: "Deliberately deferred … peer-to-peer …" then "P2P fundraising infrastructure *does* already exist … this tab just doesn't surface a P2P management UI yet." | **Stale/misleading internal note** — not shipped copy, but it reads as a denial at a glance. Flagged for Jonathan; the product ships P2P, so the "deferred" framing should be corrected in the doc. |

**No user-facing false P2P denial exists to fix.** The one place a reader might
infer a denial is the internal CLAUDE.md note above; wording is Jonathan's call.

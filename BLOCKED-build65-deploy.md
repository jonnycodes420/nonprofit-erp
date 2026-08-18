# BLOCKED — BUILD-65 deploy (Jonathan pushes)

BUILD-65 is committed locally, full battery green, **not pushed**. Part 7 changes
a **live-money webhook path** (`charge.dispute.*` → reversing/restoring real
gifts + ledger + receipts), so the autonomous prod deploy is deliberately held —
the same checkpoint as BUILD-62/63. Push `main` yourself to deploy.

## Commits
- `8e44dd0` verify-first RED (tests + `audit/build65-verify-first-red.txt`)
- `08d63a3` Parts 1,2,5,6,7 implementation
- `affa111` pinned-assertion updates + `build65` joins run-all

## Before/at push
1. `DB_SSL=disable DATABASE_URL=…:5544/steward_loadtest BASE=http://localhost:5601 git push origin main`
   (the pre-push hook runs the affected battery; server must be up on :5601 with
   the run-all env — see `tests/README.md`).
2. Watch the `deploy-railway` + `deploy-vercel` CI jobs; SHA-verify `/health.buildSha`.
3. `db.js` changed (new `dispute_reversals` table) → the schema fast-path re-runs
   full init once on first boot (~a few seconds), creating the table. Expected.

## Post-deploy verification (owner)
- **`/health.guardsOk`** — after the first reconcile tick (~90s) this should flip
  to a real boolean; before it, `reconciliation.unrecordedCharges` reads **null**
  (not 0) and `guardsOk:false`. Confirm `reconciliation.accountsWithStripe` shows
  the true count (org_creo → should read 1 today; when Brian's orgs connect it
  should climb — a stuck low number now looks wrong).
- **Stripe endpoint subscription (Part 7):** the live Connect endpoint
  `we_1Tslmv…` must subscribe **`charge.dispute.funds_reinstated`**. Per BUILD-63
  it was already an *extra* (subscribed but unhandled) — now it's handled, so it
  should just work. Confirm via `/health.webhookSubscriptions.missingCount` (0)
  and the Stripe dashboard. (`charge.dispute.funds_withdrawn` is intentionally
  left unhandled — see FINDINGS §worry.)
- **A real receipt now carries the org's logo (Part 2):** issue one receipt for
  an org whose logo is an object-storage asset (org_creo) and confirm the PDF
  shows the logo — this was broken for every real org before this build. The
  Settings → Tax Receipts **preview** should now also show the org's real band
  color + logo (was Steward-green + blank).
- **A real photo uploads (Part 1):** upload a phone photo (3–5MB) as the portal
  banner in prod and confirm it succeeds and renders — the case every customer
  starts with, never tested live before.

## Not done (see FINDINGS §worry — not blockers, just honest)
- Part 3 (crop on the remaining slots) — deferred as a standalone frontend build.
- Responsive variants still generated on-request (`?w=`), not pre-generated.
- `orgs.logo_data` legacy app-UI branding still base64/350KB (not a donor artifact).

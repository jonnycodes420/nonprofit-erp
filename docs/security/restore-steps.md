# Restore steps: Supabase point-in-time recovery

*SECURE-2, 29 October 2026.*

**Builders never run these against prod.** A builder (a person or an agent) does not open the
production Supabase project, does not start a restore, and does not point anything at a restored
copy of real data. Jonathan runs these steps. They are written so he can do it calmly, at night,
from this page alone.

The rule is **restore into a new project, never over the live one.** Restoring in place throws
away every gift, note and audit row written since the restore point. A new project keeps prod
untouched while we look.

## The script (SECURE-3)

`scripts/ops/restore-drill.js` does steps 2 to 5 below in order, and prints the clicks for step 1
(the restore itself stays a dashboard step: the Management API's point-in-time endpoint restores
the project **in place**, which is the one thing this must never do).

```
node scripts/ops/restore-drill.js                         # dry run: the plan and the clicks, connects to nothing
read -s RESTORE_DATABASE_URL && export RESTORE_DATABASE_URL   # the NEW project's string, never in a file
node scripts/ops/restore-drill.js --run --project steward-restore-YYYYMMDD-HHMM --i-am-jonathan \
  --restore-time 2026-11-08T03:00:00Z [--org <org id>]
```

It runs the read-only SQL of step 2.4 **before** anything boots, then boots a scratch backend
with a clean environment (dummy Resend and Stripe on closed local ports, no Anthropic key,
`DISABLE_BACKGROUND_TICKS=1`, `TEST_MODE=1`, a fresh `JWT_SECRET`), runs the smoke and the truth
check (`tests/lib/surfacesAgree.js`) for every org with an admin, prints counts only, and stops
the backend by its own PID. It refuses prod: a project not named `steward-restore-`, a host or
ref matching `PROD_DATABASE_URL` / `PROD_SUPABASE_REF` or the prod ref it knows by hash, a shell
with `RAILWAY_*` variables or `NODE_ENV=production`, or a `.env` in the repo. Set
`PROD_SUPABASE_REF` to prod's project ref when you run it, as a second lock. Builders rehearse it
against local databases only (a `pg_dump` of a scratch database restored into a second one).

The manual steps below are what the script does, for when you would rather do it by hand.

## Before you start

- Confirm the plan has point-in-time recovery (Supabase dashboard, the prod project, Settings,
  Add-ons, Point in Time Recovery). If it is off, only daily backups exist and you restore the
  nearest daily backup instead (same steps, pick a backup rather than a time).
- Write down the restore time in UTC and why you chose it.

## 1. Restore into a new project

1. Supabase dashboard → the production project → **Database → Backups → Point in Time**.
2. Choose **Restore to a new project** (not "Restore"). Pick the time.
3. Name it `steward-restore-YYYYMMDD-HHMM`, same region as prod. Start it. It can take a while
   for a large database.
4. When it is ready, open the new project → **Settings → Database** and copy its connection
   string. Keep it in a password manager, never in a file in the repo, a chat or a ticket.

## 2. Check it with a scratch backend on your own machine

Booting `server.js` runs its schema migrations and boot seeds against the copy, so do the
read-only SQL in step 4 **first** if you may use this copy as the new prod (section 3). If you
need both a check and an untouched copy, restore twice.

1. In a worktree: `npm ci`.
2. Boot the server against the restored copy, with nothing that can send or charge:
   ```
   DATABASE_URL='<restored connection string>' \
   JWT_SECRET=$(openssl rand -base64 48) PORT=5690 \
   DISABLE_BACKGROUND_TICKS=1 TEST_MODE=1 \
   RESEND_API_KEY=re_dummy_local RESEND_BASE_URL=http://localhost:5691 \
   STRIPE_SECRET_KEY=sk_test_dummy STRIPE_API_BASE=http://localhost:5692 \
   node server.js
   ```
   No real Resend, Stripe or Anthropic key goes in this shell. `DISABLE_BACKGROUND_TICKS=1`
   stops receipts, digests and dunning from running. The new `JWT_SECRET` means no prod session
   works here.
3. `curl -s localhost:5690/health` answers ok.
4. Check with read-only SQL (`psql '<restored connection string>'`):
   - `SELECT COUNT(*) FROM orgs; SELECT COUNT(*) FROM donors; SELECT COUNT(*) FROM gifts;`
   - The newest gift and audit row are just before the restore time:
     `SELECT MAX(created_at) FROM gifts; SELECT MAX(created_at) FROM fin_audit_log;`
   - One customer's gift total matches what they last saw (their Home figure, or their own
     export).
5. Stop the server (Ctrl-C in its own terminal; never kill by name).

## 3. Decide

- **Recovering a few rows** (someone deleted the wrong thing): copy just those rows from the
  restored project into prod by hand, through the app's own routes where one exists, so the actor
  stamp and the audit row are written. Write down what you copied.
- **Recovering the whole database** (prod is lost or corrupt): point Railway's `DATABASE_URL` at
  the restored project, redeploy through CI, run `npm run status`. Every session from after the
  restore point is gone; tell customers what was lost (see `breach-plan.md` if it was an attack).
- **Nothing needed**: delete the restored project the same day. A spare copy of real donor data is
  a risk of its own.

## Practise it

Once a quarter, restore to a new project, run `scripts/ops/restore-drill.js --run` against it
(step 2), write the date and the counts it prints on the line below, and delete the project.

- Last practised: not yet.

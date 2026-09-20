# BLOCKED — BUILD-92

Written 20 September 2026. Track A and Track B are done, green and merged.
Track C was not started. Per-track detail is in `BLOCKED-build92-A.md` and
`BLOCKED-build92-B.md`; this file is what needs a person, in the order it
matters.

---

## 1. THE FRONTEND DEPLOYED TO PRODUCTION BY ITSELF, AND WAS ROLLED BACK

**Read this before the next push to main.**

The brief said: do not deploy the frontend; Vercel main deploys are off, which
is the gate. `vercel.json` does say so:

```json
"git": { "deploymentEnabled": { "main": false } }
```

That was verified before pushing. **It is not the only gate, and it is not the
one that was open.** `git.deploymentEnabled` governs Vercel's GIT INTEGRATION
auto-build and nothing else. There is a second, independent path to
production: the `deploy-vercel` job in `.github/workflows/ci.yml:214`, which
runs

```
npx vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN" ...
```

A CLI deploy with a token does not consult `git.deploymentEnabled` at all. The
job is gated only on `vars.VERCEL_DEPLOY_ENABLED == 'true'`.
`BLOCKED-vercel-gate.md` (11 August) describes that job as DORMANT pending a
token. It is not dormant any more — the variable and the secret have both been
set since, and nothing updated the note that said otherwise.

So the push of `89e6c22` put all of Track B on www.stewardapp.dev without the
review it was supposed to get. **It was rolled back**, on Jonathan's
instruction, to `dpl_Cfxu77nRTBzciXSRTHMUAdAXSp6k` (21cc233), and production
was confirmed serving 21cc233 afterwards.

**Production is deliberately split-brain right now and that is correct:**
backend `89e6c22` (Track A, live), frontend `21cc233` (Track B, NOT live).
`scripts/status.js` prints a red SPLIT-BRAIN warning for it. That warning is
the intended state, not a fault — every Track A change was additive precisely
so the older frontend keeps working.

**THE TRAP IS STILL ARMED.** The next push to `main` re-runs the job and puts
Track B back on production. To close it, one of:

```sh
gh variable set VERCEL_DEPLOY_ENABLED -R jonnycodes420/nonprofit-erp --body false
# or delete it outright:
gh variable delete VERCEL_DEPLOY_ENABLED -R jonnycodes420/nonprofit-erp
```

Because of this, **`BLOCKED-build92.md` and the two per-track files are
committed but NOT pushed.** Pushing them would redeploy the frontend. Close
the gate, or deploy Track B on purpose, then push.

**Also worth fixing:** `BLOCKED-vercel-gate.md` is now actively misleading —
it tells a reader the Vercel deploy path is dormant when it is live. Either
update it or delete it.

---

## 2. TRACK C WAS NOT STARTED

Not skipped for a reason in the code: the launch was **denied by this
environment's permission classifier**, twice, along with `gh run list`. No
Square, Donorbox or Planning Center adapter exists. Nothing was half-built —
`build-92c` is an untouched worktree at the old base.

Track C's gate (A and B both past their second part) had been satisfied, and
the worktree, branch `build-92c` and scratch database `steward_92c` are all
still in place, so it can be picked up as-is.

**One correction to carry into it:** the Track C brief assigns PORT 5631.
`tests/drift.test.js` spawns a child server on a hardcoded 5631 and will
collide. Use 5651.

---

## 3. THE DEMO ORG'S PAYPAL SOURCE IS FAILING ON PRODUCTION, AND A2 IS WHY WE KNOW

The first prod boot on `89e6c22` logged, through A2's new logging:

```
[giving-source] paypal org=org_creo: unknown {
  status: 400,
  providerCode: 'INVALID_REQUEST',
  message: 'PayPal: Request is not well-formed, syntactically incorrect, or violates schema.'
}
```

This is A2 working — the status and the provider's own code are on the line,
which is exactly what was missing on 20 September. But it says something new:
**this is not an authentication problem and not a permissions problem.** A 400
`INVALID_REQUEST` is PayPal rejecting the SHAPE of Steward's request, which
points at the reporting call's own parameters (the date range is the usual
culprit — PayPal's Transaction Search caps a single query's window, and rejects
`start_date`/`end_date` outside it).

It classifies as `unknown`, so it currently falls to the generic sentence. It
deserves its own branch once the cause is known.

**NOT INVESTIGATED AND NOT TOUCHED**, because the brief put the demo org's
PayPal source and its credentials out of bounds. Needs Jonathan to say go.

---

## 4. A STRIPE EVENT IS STILL NOT SUBSCRIBED ON THE LIVE ENDPOINT

Pre-existing, logged on every prod boot, unrelated to this build:

```
[webhook-manifest] 1 handled event type(s) NOT subscribed on the live endpoint(s):
  route /stripe/webhook, endpoint we_1Tslmv7rAzrXok5S7b0EmR6f
  missing: ["payment_method.automatically_updated"]
  extra:   ["charge.dispute.funds_withdrawn"]
```

`payment_method.automatically_updated` is Card Account Updater — the event the
recurring-card-recovery work depends on. Steward handles it; Stripe is not
sending it. Dashboard change, one minute, and it needs a person.

---

## 5. TWO SUITES ARE NOT RE-RUNNABLE, AND ONE IS A REAL RE-RUNNABILITY GAP

Both proven environmental, neither a BUILD-92 regression:

- **`import-messy-v2`** fails against a `steward_loadtest` that has been run
  over repeatedly: `the folded identity's 27 gift(s) moved BACK to the split
  donor — {"moved":24,"expected":27}`. On a brand-new database, same commit:
  **185 passed, 0 failed**. The suite leaves donors behind that its own next
  run then counts. Same class as the note in CLAUDE.md about
  `tests/tenant-matrix.test.js`'s reset list needing every new table.
- **`build88a-week`** failed once inside a full battery and passes on its own
  (37 passed, 0 failed). A load-dependent flake, not chased further.

The honest battery number for this build is the one from a clean database:
**172 suites passed, 0 failed.**

---

## 6. SMALLER THINGS, ALREADY WRITTEN UP PER TRACK

- `fixtures/sources/` does not exist; the convention is
  `tests/fixtures/<build>/`. No vendor preset was added without a real file,
  and **the three presets that already exist have no real file either**
  (`paypal_csv` documented, `venmo_csv` reported, `cashapp_csv` unconfirmed).
  Needs one real scrubbed export each, plus a real bank CSV. — `…-A.md` §1
- Source logos ship as type only, behind `SOURCE_LOGOS_ENABLED=false`. Nothing
  was drawn, traced or fetched. Turning them on is a trademark decision. —
  `…-B.md` §1
- `tests/donor-accounts.test.js` (5611) and `tests/drift.test.js` (5631) spawn
  children on hardcoded ports and break any parallel build that uses them. Two
  one-line fixes. — `…-A.md` §3
- A2's connect-time verification is skipped on a TEST boot for a provider with
  no `*_API_BASE` seam, so a suite can never reach a real provider. Proven
  properly by the child server in `build92-source-errors`. — `…-A.md` §2
- B2 infers "waiting on the provider" from the error sentence. Track A's real
  `last_tried_at` / `last_error_status` / `last_error_provider_code` fields are
  now merged; replace the inference with the field. — `…-B.md` §3

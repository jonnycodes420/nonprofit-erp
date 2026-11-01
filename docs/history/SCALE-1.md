## SCALE-1 · Prove Steward holds 200 orgs, then fix what breaks (2026-10-13)

Measured first, on a loopback cluster with 200 synthetic orgs (`scripts/load/seed-many.js`: 980,000 donors,
5.8 million gifts, 2.6 million interactions; 20 large orgs with Stripe, QuickBooks, Gmail and Givebutter on
stand-ins). With 20 users on 20 large orgs the pool sat at 10 of 10 connections the whole run, Home took 60 s,
the app shell 30 s (`/donors/summaries` is 24 MB for a 25,000-donor org), and one pass of the five-minute jobs
took 202 s, 193 of them reading 20 mailboxes one after another (a first read asks Gmail ~600 times).
The queue (`jobQueue.js`, a Postgres table claimed with `FOR UPDATE SKIP LOCKED`, chosen over pg-boss because it
is two statements on our own schema) now runs every background job; each mailbox is its own job; the per-org
cap and the one-run-per-key rule are taken under advisory locks, because checked in the claim's own snapshot
four lanes all took one org's flood (`scale1-queue` §4, red then green). `STEWARD_PROCESS` splits web from
worker and is unset on prod until Jonathan's 0-SCALE-1 steps. Rate limits, the API-key minute, the ops alert's
hourly mark and FIX-37's "import in flight" moved to Postgres; OAuth state already was. Each org has a daily AI
budget (`AI_DAILY_CALLS_PER_ORG`). Query work is in the PR's own section. Suite: `scale1-queue`;
`npm run test:load` is the 200-org pass/fail and is not in the battery.

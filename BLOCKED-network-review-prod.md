# BLOCKED — prod network review-queue verification needs YOUR super-admin login

Step 5 of go-live is verified on its **safety-critical half** — an unapproved
network org is invisible and un-giftable on prod, proven live 2026-08-12:
- signup → 201 pending
- `GET /portal/<slug>/config` → 404 (invisible)
- `POST /portal/<slug>/request-link` → 404 (invisible)
- `POST /donate/<slug>` → 400 "not set up" (un-giftable)
- consent enforced (400 without it)

The **human-review half** (view the application with EIN + Stripe status,
then REJECT it, confirm the rejection is logged and the org stays invisible)
needs a **super-admin** token. `admin@creoarts.org` is NOT super-admin (403 on
the queue), and I don't have your super-admin login — so I could not drive the
reject live. It IS proven in CI (tests/network-gate.test.js, 35/35, including
approve-refused-without-gate, reject, dispute, and decision logging).

## The live test application waiting for you
A test org is sitting **pending + invisible + un-giftable** (safe) from the
live gate check:
- name: **Go-Live Test Shelter (DELETE ME)**
- slug: `go-live-test-shelter-delete-me-XXXX`
- EIN 99-0001111 (deliberately NOT in the IRS registry — an approve would be
  refused by the gate anyway)

## Do this once, signed in as your super-admin account
1. Sign in at stewardapp.dev with your super-admin login, go to /admin →
   **Network Review** (the new tab), status = pending. You should see the org
   with its EIN result (not found — the registry isn't loaded on prod yet, see
   below), Stripe status (missing), and domain check.
2. Click **Reject** (reason optional). Confirm it moves to the rejected tab
   and the decision log shows your rejection.
3. Confirm it's still invisible: `curl -s https://nonprofit-erp-production.up.railway.app/portal/<slug>/config` → 404.
4. Delete the throwaway org via the admin org-delete when convenient.

Or by API with your super-admin token ($TOKEN):
```sh
curl -s https://nonprofit-erp-production.up.railway.app/admin/network/applications?status=pending -H "Authorization: Bearer $TOKEN"
# find the id, then:
curl -s -X POST https://nonprofit-erp-production.up.railway.app/admin/network/applications/<id>/decide \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"action":"reject","reason":"go-live test app"}'
```

## Also before any REAL approval (standing rule + prerequisites)
- **The Stripe recurring drill** (top of the report) — no real nonprofit gets
  approved until you've run it.
- **Load the IRS EIN registry on prod**: `node scripts/load-irs-ein-registry.js --url`
  against the prod DB (monthly cadence). Until then `ein_registry` is empty,
  so no approval can pass the EIN gate — which is safe (fails closed on
  approval), and the auto-delist sweep fails safe on an empty registry (delists
  nobody).

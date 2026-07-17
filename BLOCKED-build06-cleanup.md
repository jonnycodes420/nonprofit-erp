# BLOCKED — BUILD-06 Phase D test-org cleanup (2026-07-17)

The fresh-org E2E ran on production (see `QA_FRESH_ORG.md`). Deleting the test
orgs requires `DELETE /admin/orgs/:id` (requireSuperAdmin), and **no
super-admin credentials exist in this dev environment** — the same blocker
already documented under "Current priorities" in CLAUDE.md. Deletion with the
orgs' own admin tokens was attempted and correctly returned 403.

## Orgs to delete (three — runs 1–2 were script-calibration passes that each
## created an org before their run aborted; run 3 completed the full flow)

| Org id | Slug | State |
|---|---|---|
| `org_bcc72f98` | qa-fresh-org-1784262098708-bcc72f | empty shell (signup only) |
| `org_7b58bbe1` | qa-fresh-org-1784262195049-7b58bb | partial onboarding: 6 imported donors, goal, metric |
| `org_72b0f60c` | qa-fresh-org-1784262298518-72b0f6 | full E2E: 6 donors, $300 gift, 1 issued receipt, tax settings (dummy EIN 00-0000000) |

All three signup emails are plus-addresses of the founder inbox
(`xjca2006+steward-qa-<ts>@gmail.com`).

## How to clean up (as super admin)

For each org id above:
```
DELETE {API}/admin/orgs/{orgId}   body: {"confirm": true}
Authorization: Bearer <super-admin token>
```
(or the delete action in /admin). The FK-safe cascade removes donors, gifts,
receipts, sequences and the onboarding-drip enrollments — **deleting the orgs
also stops the 7-step onboarding email drip** currently scheduled to those
plus-addresses (next sends at days 2/4/7/…/28).

## Then verify

1. Login with `xjca2006+steward-qa-1784262298518@gmail.com` fails (401).
2. `GET /admin/orgs` no longer lists the three ids.
3. https://www.stewardapp.dev/give/qa-fresh-org-1784262298518-72b0f6 404s.

## Loose end that outlives the org rows

`POST /auth/register-org` creates a **Stripe customer** per signup — the org
delete cascade removes DB rows, not the Stripe-side customer objects. Three
throwaway customers (no payment method, no charges, test EIN) will remain in
the platform Stripe account; harmless, but delete them from the Stripe
dashboard if you want zero residue.

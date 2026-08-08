# BLOCKED — BUILD-45 D-3 item 2: the two empty "Jonathan" records are USERS, not donors

**Status: item 1 of D-3 is DONE; item 2 is blocked on the same wall as
[`BLOCKED-demo-org-officers.md`](BLOCKED-demo-org-officers.md) — no remove-user
route, and one account is Jonathan's own login.**

## What the brief assumed vs. what's actually there

D-3 item 2 describes *"Two empty donor records, `Jonathan` (0·$0) and
`Jonathan Atkinson` (0·$0), rendering as chips at the top of the mobile donor
list."* Verified live on prod `org_creo` (2026-08-08, demo admin →
`GET /donors/summaries`): **there are no donor records named "Jonathan" or
"Jonathan Atkinson"** — the 15 donors are the real demo set (Margaret Chen,
Sunrise Foundation, …). A `GET /donors?search=jonathan` returns only the
now-removed "Jonathan Atkindaddy".

The "Jonathan 0·$0 / Jonathan Atkinson 0·$0" chips are the **Officer Portfolios
legend** — they are `users` rows, not donors:

| id | name | email | role | portfolio |
|---|---|---|---|---|
| `user_jonathan` | Jonathan | xjca2006@gmail.com | admin | 0 · $0 |
| `user_0a9d3327` | Jonathan Atkinson | jonathan.atkinson@asbury.edu | staff | 0 · $0 |

(Confirmed via `GET /reports/solicitations` `byOfficer` and
`GET /portfolio/officers` on prod.)

## Why there is no safe application-level path

The brief's own D-3 fallback: *"If no safe application-level path exists to
remove a donor with dependents, that is itself the finding: write it into
`BLOCKED-build-45.md` and rename rather than delete."* Here the records aren't
donors at all, and the wall is harder:

1. **No remove-user route exists** — every `app.delete(...)` in server.js was
   enumerated; none removes a `users` row. Settings › Team can *invite* but not
   remove. There is nothing to call.
2. **No rename-other-user route either** — a user's name is set at
   register/invite-accept; there's no admin route to edit another user's name,
   so even the "rename rather than delete" fallback isn't reachable from the app
   for a `users` row.
3. **`user_jonathan` is Jonathan's own login** (xjca2006@gmail.com) — which of
   the two to keep vs. remove is his call.
4. Hand-deleting the rows in Supabase is exactly what caused the documented
   dangling-FK incident (CLAUDE.md "Admin data integrity"); not doing that
   autonomously against prod.

This is the identical situation already captured in
`BLOCKED-demo-org-officers.md`, which also records the **decision already made
(Jonathan, 2026-08-06): keep `user_jonathan`, delete `user_0a9d3327`, then run
`POST /admin/data-integrity/fix`.** That ~2-minute Supabase + integrity-fix path
is the fix; it needs prod DB / super-admin access this environment doesn't have.

## What WAS done for D-3 (item 1, via sanctioned app routes)

- **`Jonathan Atkindaddy`** (donor `d_ec8d0783`, a typo'd test insert with
  $15,001 / 3 gifts in Steward) — soft-deleted via `DELETE /donors/:id` (removes
  it from directory, board, and reports; gifts preserved in the DB, recoverable;
  no dangling FK). Backup of the record: `audit/build45-backup/atkindaddy-donor.json`.
- Its dependent task **"Follow up: Jonathan Atkindaddy"** (`t_55d7f47b`) —
  deleted via `DELETE /tasks/:id`.
- Verified after: 15 donors, no "Atkindaddy" anywhere, Steward column clean
  (Margaret Chen, Elena Marchetti, Robert & Lisa Atkinson, Owen Bishop,
  James Okafor, Camille Torres, Nathaniel Cross, Diana Torres).

## The right long-term fix (separate reviewed change, per BLOCKED-demo-org-officers.md)

A real `DELETE /users/:id` (requireAdmin, org-scoped, self-delete forbidden,
last-admin forbidden) that reassigns/nulls the user's references in one
transaction — the same FK-safe discipline as `DELETE /admin/orgs/:id` — plus a
"Remove" action in Settings › Team. Until that exists, this demo-data lint can
only be cleared from the Supabase dashboard.

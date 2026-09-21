# BLOCKED — the only super-admin can be removed, by an account whose password is in the repo

Found 2026-09-20 while answering "what set `deactivated_at` on prod, and can it
happen again". Nothing here is fixed; it needs a decision about what the guard
should say.

---

## WHAT IS TRUE ON PRODUCTION RIGHT NOW

- **`user_jonathan` (xjca2006@gmail.com) is the ONLY row with
  `is_super_admin = true`.** There is no second super-admin.
- It lives in **`org_creo` — "CREO Arts (Demo)"**, the demo organisation that
  the boot seed maintains.
- `org_creo` also contains **`user_admin` / admin@creoarts.org**, role `admin`,
  seeded on every boot. **Its password is `demo1234`, and that pair is written
  down in `CLAUDE.md`, `PROGRESS.md` and the git history.** It was printed on
  the production sign-in page until 2026-07-30.
- A third row, **`user_0a9d3327` — "Jonathan Atkinson",
  jonathan.atkinson@asbury.edu, role `staff`** — is deactivated at
  **2026-09-09T15:01:50.110Z**.

## THE ONE PATH THAT SETS `deactivated_at`

`DELETE /users/:id` (server.js ~5317) is the **only** writer anywhere in the
tree. It is `requireAuth` + `requireAdmin`, org-scoped, and it refuses two
cases: removing yourself, and removing the last **`role='admin'`** of an org.

```sql
SELECT COUNT(*) FROM users
 WHERE org_id=? AND role='admin' AND deactivated_at IS NULL AND id<>?
```

## THE DEFECT: THAT GUARD DOES NOT KNOW WHAT A SUPER-ADMIN IS

It counts `role='admin'`. It never looks at `is_super_admin`.

So `user_admin` — the seeded demo account, password `demo1234` — can sign in,
open Settings → Users, and remove `user_jonathan`. The guard permits it,
because another `role='admin'` (user_admin itself) is still active. The count
is satisfied; the only super-admin is gone.

**And deactivation locks the door behind it.** `requireAuth` (auth.js) rejects
a user with `deactivated_at` set, so every super-admin surface — minting a
close link, `GET /admin/close-links`, the reconciliation run, the network gate —
becomes unreachable by anybody, with no in-product way back. Recovery is what
Jonathan already did: UPDATE the row by hand.

## WHETHER IT CAN HAPPEN AGAIN

**Yes**, unchanged, today. Three properties have to hold at once and all three
do: the only super-admin sits in the demo org; that org has a second admin
whose credentials are public; and the removal guard cannot see super-admin.

## WHAT CANNOT BE ANSWERED, AND WHY

**Who performed the 2026-09-09 removal is not recoverable.**
`DELETE /users/:id` writes **no audit row** — not to `fin_audit_log`,
`portal_audit_log`, `donor_account_audit` or anything else. The only trace it
leaves is the timestamp on the row it changed. Railway's log retention does not
reach 2026-09-09 (several deployments back), so the request is gone too.

The one correlation worth recording, offered as correlation and nothing more:
commit `fa380bb` is authored **2026-09-09T11:01:57-04:00 = 15:01:57 UTC**,
**seven seconds after** the deactivation. Something was actively working in
that minute. The commit itself touches the CSV mapper and adds a browser guard,
none of which can reach user removal, and the browser suites refuse a
non-localhost `BASE`. So it places a working session at the moment; it does not
name a cause.

## FOUR THINGS TO DECIDE (none done here)

1. **Teach the guard about super-admin** — refuse to remove the last active
   `is_super_admin`, the same way the last `role='admin'` is refused. This is
   the small fix and it closes the hole.
2. **Audit the removal.** A row that blocks a login and revokes every session
   should record who did it and when. It is the only privileged mutation in the
   product that leaves no actor behind, which is why this investigation ended
   in a correlation instead of a name.
3. **Get Jonathan's account out of the demo org**, or get the seeded
   `demo1234` admin out of the org his account lives in. A demo account and the
   only super-admin should not share a tenant.
4. **A second super-admin**, so that one removal is an inconvenience rather
   than a lockout.

Also noted while reading: `scripts/create-billing-products.js` ends by printing
`Founding coupon id: steward_founding_34off`, but the coupon it actually
creates and reuses is `steward_founding_20off`. A stale literal in a line meant
to be pasted somewhere.

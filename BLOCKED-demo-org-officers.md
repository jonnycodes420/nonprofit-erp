# BLOCKED — demo-org duplicate officers ("Jonathan 0 · $0" ×2)

> **DECISION MADE (Jonathan, 2026-08-06):** keep `user_jonathan`
> (xjca2006@gmail.com — his login), **delete `user_0a9d3327`**, then run the
> integrity fix. Still blocked on execution from the dev environment: no
> remove-user route, no prod DB credentials or super-admin login here (checked
> — no local .env). Execution = the Supabase steps below, ~2 minutes.

BUILD-41 P2 asked for the demo org's Officer Portfolios legend to be cleaned
before Sunday: it shows **Jonathan · 0 · $0** and **Jonathan Atkinson · 0 · $0**
beside the real demo officer. Verified live on prod (2026-08-06, demo admin
login → `GET /portfolio/officers`), org_creo has three users:

| id | name | email | role | portfolio |
|---|---|---|---|---|
| `user_admin` | Admin User | admin@creoarts.org | admin | 16 · $380,751 |
| `user_jonathan` | Jonathan | xjca2006@gmail.com | admin | 0 · $0 |
| `user_0a9d3327` | Jonathan Atkinson | jonathan.atkinson@asbury.edu | staff | 0 · $0 |

**Why blocked, not done:**
1. **There is NO remove-user route in the product** — every `app.delete` was
   enumerated; Settings › Team can invite but not remove. Nothing to call.
2. Manual Supabase row deletion is exactly what caused the documented
   dangling-FK incident (CLAUDE.md "Admin data integrity") — not doing that
   autonomously against prod.
3. `user_jonathan` (xjca2006@gmail.com) is **Jonathan's own login** — which of
   the two to keep, rename, or remove is his call, not mine.

**Fastest safe cleanup (Jonathan, ~2 min):** decide the fate of the two
zero-portfolio accounts, then in Supabase delete the unwanted `users` row(s)
for org_creo **and immediately run** `POST /admin/data-integrity/fix`
(super-admin) to null any dangling references — that tooling exists precisely
for this. Suggested: delete `user_0a9d3327` (a test invite acceptance); keep
`user_jonathan` but either assign it a few demo donors or accept it in the
legend.

**Right long-term fix (separate reviewed change):** a real
`DELETE /users/:id` (requireAdmin, org-scoped, self-delete forbidden, last-admin
forbidden) that reassigns/nulls the user's references in one transaction —
the same FK-safe discipline as `DELETE /admin/orgs/:id` — plus a "Remove"
action in Settings › Team. Until that exists this class of demo-data lint can
only be fixed from the Supabase dashboard.

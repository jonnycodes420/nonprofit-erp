## FIX-19 · Small leftovers from WHY-1 (2026-10-02)

- **A user id from the request belongs to the org.** `POST /donors/:id/threads` stored any `ownerId` it was
  handed. `orgUsers.js` is now the one check: an id that is not an active user of the caller's org is refused
  with a 400 (`user_not_in_org`) before anything is written. It covers donor create, assign and bulk assign,
  tasks (create, update), threads, proposals (`POST /donors/:id/proposals`, `PUT /proposals/:id`), grants (`POST /funders/:donorId/grants`), and journey step owners
  (create, update). The read filters (`GET /donors`, the CSV export, `/pipeline`, `/proposals`,
  `/grants/pipeline`) refuse a foreign id too but accept a deactivated colleague, so a former officer's old
  portfolio can still be looked at. The import's owner resolver now drops deactivated users as well. The
  tenant battery's §10 plants a B user as the owner of an A thread; with the old route it went red (201, one
  thread owned by B).
- Drift's profile sentences lost their em dash ("Gave every May since 2019, usually around $500.").
- `BLOCKED-landing-2.md` is gone: both items were fixed by FIX-13. What is still true about the demo form is in
  `docs/decisions/accounts-and-billing.md`.

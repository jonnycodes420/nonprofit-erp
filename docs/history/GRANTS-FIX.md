# GRANTS-FIX · Every grant can be linked to its funder, and Awarded means money is promised

A beta customer (4 Nov 2026): "It's telling me to link the grant to a funder but I can't figure out how."
Grants from older paths (the Pipeline's New grant form through POST /grants, the general PUT, the boot
seed) carried only the typed funder name, so the award route refused them and nothing on screen could
link them. The board's drag (PATCH /grants/:id/stage) and the general PUT moved a grant into Awarded
with no pledge at all.

What changed:
- One resolver, `server/grants/funderLink.js`: the organization with exactly the typed name, else a new
  organization (funder type unset). Two same-named organizations, or a name only a person has, are left
  for a person. It never renames and never merges.
- Into Awarded / Reporting / Closed from a never-awarded stage is refused (`award_required`) on the stage
  route, the general PUT and both create routes. The only way in is PUT /grants/:id/award, which writes
  the pledge. The client opens the award step on that answer (`client/src/components/GrantAward.jsx`).
- GET /grants/:id/funder-search and POST /grants/:id/funder-link: the picker. Linking keeps the typed name.
- `scripts/ops/grants-link-funders.js`: dry run lists, `--apply` links only, one audit row each.

Found and not fixed here (next brief): the award route writes no ledger stamp while the general PUT's
Awarded transition did, so the ledger income for an award now depends on nothing; and PATCH
/grants/:id/stage replaces `req.audit` with a plain object, so its before/after never reach the audit row.

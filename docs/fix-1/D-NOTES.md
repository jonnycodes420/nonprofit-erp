# FIX-1 D — notes for the lead

**People, without the lecture.** Branch `fix-1-d2`, cut from `fix-1` at `b9cb4a7`.

## What changed, and where

| Where | What |
|---|---|
| `routes/crm.js` `buildDonorListFilter` | `role=donor\|volunteer\|staff_board` narrows `GET /donors` and `GET /donors/export/csv` via `PT.typeSql`; an unknown role is a 400, never ignored. Without `role` both routes behave as before (search and older callers still see everyone). |
| `routes/crm.js` after `GET /people/photos` | `GET /people?role=…`, `GET /people/:id`, `PUT /people/:id/roles`. Placed **after** `/people/photos` so `/people/:id` never shadows it. `donorLock` / `donorRemovalProblem` / `personOut` sit with them. |
| `routes/crm.js` `PUT /donors/:id` | Calls `donorRemovalProblem` **before any write**. Removing Donor from someone with gifts is a 409 `donor_has_gifts` with the sentence, the same refusal the chip route gives. |
| `DonorProfile.jsx` | `PersonTypeChips` (the dropdown under "+ type") → `RoleChips`: Donor / Volunteer / Staff and board under the name, one `PUT /people/:id/roles` per tap. When the Donor chip is locked it says "· set by giving", and a tap shows the server's sentence. |
| `Donors.jsx` | The Directory sends `qs.set("role","donor")` and exports with `role:"donor"`. Unused import names pruned (see below). |
| `TopBar.jsx` | The search group is **People**, and each row starts with `typeLabels(d)` ("Volunteer", "Staff and board · Donor"…). |
| `Settings.jsx` | `StaffBoardList` under Organization reads `/people?role=staff_board`. Each name opens the profile. |
| `Communications.jsx` | The "Everyone is on one list." paragraph and its comment are deleted. |
| `audit/route-inventory.json` | The three new routes were added **surgically** (inserted after `GET /people/photos`, count 618 → 621). A full regenerate rewrote ~9,700 lines: line-number churn, plus the one known spurious param annotation on `POST /auth/invite/accept` (handoff §4.6). I kept it out so parallel workstreams don't conflict on it. |

## Actor stamping
`PUT /people/:id/roles` updates one existing row, and `donors` has no `updated_by`. So a change calls
`writeAuditLog(org, userId, email, "updated", "person_roles", id, {from, to})`, the
same helper the finance and sending-domain routes use.

## Donors.jsx import prune
Client lint: **673 → 563 warnings** (0 errors). Before the prune the count was 674, because the new code added one.
**Use the AST, not eslint:** this eslint config does not count JSX usage, so eslint also flags names
that ARE used as `<Component/>` (GrantImport, HoursImportModal, UpgradeModal, Card, …). Pruning by eslint
output would have broken the build. The prune kept every name the AST sees used.

Two names were kept on purpose, because assertions pin them in the `./shared` import line of
the rebuilt Donors.jsx (`readSource`):
- `LockedFeature`: `tests/locked-features.test.js:144` `/import\s*\{[^}]*LockedFeature/`
- `goToPricing`: `tests/upgrade-checkout.test.js:34` `/import\s*\{[^}]*goToPricing/`

Both assertions are unchanged. The names are still used in the parts (DonorProfile/DonorDirectory), which
readSource splices back in, so the assertions still mean something.

## Things for the lead at merge
- **C overlap:** `GET /people?role=volunteer` is the roster read this section's suite asserts (`{people:[{…, gives}]}`).
  If C's hub adds its own roster route, point it at this one or keep them identical.
- **`/communications` audiences, `livesOn`** (`routes/crm.js`, the `BUILT_IN_AUDIENCES` map): it still says volunteers
  and staff/board live on "Donors, filtered to …". That is no longer true: Donors shows donors only, and the
  Donors screen never read the `personType` intent anyway. When C's Volunteers tab lands, point
  `volunteers` at it and `staff_board` at `settings`/`org`. I left it alone because the tab doesn't exist on
  this branch.
- `fix1-people` is already in CORE (6700510).

## Two test-file edits (fixture wiring, no assertion text changed)
- `tests/fix1-people.test.js` `reset()`: `fin_audit_log` joins the table list. The role write stamps the
  actor in `fin_audit_log`, which has an FK to `orgs`, so without it the closing reset could not delete the org
  (a swallowed error) and the next run died on `orgs_pkey`.
- `tests/tenant-matrix.test.js` `bResolver`: `people: d_${B}`. The suite asks exactly this of a new
  parameterized route ("add a bResolver mapping or a reasoned PARAM_EXEMPT entry"). Now org A probes
  `GET /people/:id` and `PUT /people/:id/roles` with org B's person and gets a 404.

tenant-matrix boots its own server on the fixed port :5697. One run died with ECONNRESET after 544s,
most likely because another session's tenant-matrix was on that port at the same time. The rerun went green in 27s.

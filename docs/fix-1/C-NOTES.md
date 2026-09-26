# FIX-1 C — Volunteers, its own hub: notes for the lead

## What was built
- **Server** (`routes/volunteer.js`, appended inside `mount`): `GET /volunteer-hub/roster`,
  `/givers`, `/shifts`, `/notes?personId=`, `POST /volunteer-hub/notes`, `POST /volunteer-hub/notes/delete`,
  `GET /volunteer-hub/signup-link`, public `GET|POST /volunteer/join` (donateLimiter, honeypot).
  ctx gained `markVolunteer` and `publicAppUrl` (server.js ctx object + the module's destructure).
- **db.js**: `volunteer_notes` (kind CHECK training/background_check/availability/note, person FK
  ON DELETE CASCADE, created_by/created_by_name). Notes never touch `interactions`, so they cannot
  reach the timeline, Drift, thank-you drafts or the agent.
- **routes/crm.js**: `buildDonorListFilter` reads `role=donor` (the one `donorOnly("")` predicate);
  merge moves `volunteer_notes` with `volunteer_shifts`.
- **vercel.json**: `/volunteer/join` rewrite beside `/volunteer/log` (local-preview reads it too).
- **Client**: `components/VolunteersHub.jsx` (Roster · Shifts and hours · Sign-up link · Volunteers
  who give; internal notes on each volunteer's panel). App.jsx renders it for `tab==="volunteers"`;
  the old `Volunteers` import is gone, `Volunteers.jsx` itself untouched and still out of census scope.
  tabRegistry: Volunteers in TABS + MORE_TABS (before Reports) and PRIMARY_NAV before "reports".

## Decisions made (say if you want them the other way)
- **Sign-up link = one standing HMAC link per org** (`volunteer-signup:<orgId>`), no expiry and no
  revocation (rotating would need a per-org secret column). An email already on a record gains the
  Volunteer role on THAT record and nothing else on it changes; otherwise a new person is created
  with `["volunteer"]`, stamped `system:volunteer-signup`. Availability text becomes an internal
  `availability` note. Steward never sends the link.
- **No money is drawn on the hub.** "Volunteers who give" shows hours and last-gift date and opens
  the record; the API still returns `lifetimeGiving` (the test pins it). This also keeps the hub at
  zero build97 census sites, so `EXPECTED` did not change (VolunteersHub.jsx is added to SURFACES).
- **Lint**: the config has no jsx-uses-vars rule, so every JSX-only component reads "never used".
  VolunteersHub.jsx carries a file-level `eslint-disable no-unused-vars` (explained in the file) so
  the warning count stays 673. A one-rule fix to eslint.config.js would remove hundreds of these
  false warnings repo-wide; not done here (it moves everyone's baseline).

## Merge notes
- tabRegistry: A inserts "agent" at the same spot in PRIMARY_NAV. Walk §12 wants
  `dashboard,donors,fundraising,volunteers,agent,reports,finance` — "board" leaving and "finance"
  joining are B's/E's, not C's.
- D also works on the Donors list count ("Donors count = donor-role people"): C added
  `role=donor` to `buildDonorListFilter`; if D adds the same, keep one.
- `fix1-volunteers` is in CORE (after build98-volunteers).
- `audit/route-inventory.json` regenerated (627 routes = 618 + 9 new); most of its diff is line numbers.

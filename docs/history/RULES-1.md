# RULES-1 · A shared rule is enforced, not remembered (2026-11-23)

The sweep builds each put one rule in `shared/` and fixed the readers they found. The readers they
did not find kept their own rule, so Jarvis's Nov 23 re-run still saw the old answer on the screens
nobody had touched. This build adds a guard per rule that fails CI on a reader that skips it.

- **Served hours.** `scripts/ci/served-scan.js` found 14 sums over `volunteer_shifts.hours` with no
  `SERVED` (the profile rail and status line, the Donors list column, the report builder, two figure
  sources, groups' hours filter, prospect research, the year-end statement, merge fields, milestone
  journeys). Each now counts through `SERVED`, or `SERVED_LIVE` where the read has no JS today.
  The two the brief asked about in `volunteerScheduling.js` already did.
- **One unit per headline.** LYBUNT folded "464 donors and households (465 people)": one household
  (two LYBUNT givers) is one line. The headline now says the registry's one unit ("LYBUNT households:
  464 households", or "LYBUNT: 465 people"), with the registry sentence under it. Communications'
  327 is "Lapsing or lapsed" with an email address; it now says so, and how it differs from Re-engage.
- **The Donor label.** The new $0 person's record already read Contact on 5c922c6; global search
  called them "Donor · $0 lifetime" (it sent the stored roles). Search now sends `typesOnRead`, and
  `scripts/ci/donor-label-scan.js` fails on a new client line that draws Donor from stored roles.
- **One schema file per build.** `server/db/ddl/builds/`, loaded in name order after part7, which the
  split-shells ratchet now caps.
- **Ending a volunteer role where she looks.** Jarvis looked for it on the role line and in More; it was
  only inside the Volunteer record. "Mark as former" now sits next to "+" on the role line and in More →
  Their record, both through VOL-3's one writer, each with its sentence and Undo; the line then reads
  "Former volunteer". The two controls share one per-person store (`client/src/lib/volunteerStatus.js`).
  The other two small items were already done on main: purge deletes `volunteer_records` (MERGE_REFS)
  and `purgePeople` is at module scope.
- Item 4 (counts after trash/restore/delete) and item 5 (the phantom donor) were not reproduced on
  staging at 5c922c6 and are OPEN; the report says what was tried.

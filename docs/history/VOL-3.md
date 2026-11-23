## VOL-3 · A volunteer has a status, and every detail Add asked for is editable (2026-11-23)

**The root cause.** "Volunteer" was a `person_types` entry with an application row beside it. With no
status, nothing could pause or end it, and "Add a volunteer" filled the gap by writing an Approved
application nobody sent, which then showed on Applications.

- **One record, one writer.** `volunteer_records` (one row per volunteer) holds hours a week, days, roles
  and the status (Active, Paused, Former) with the org's day it was set and who set it. The status before
  it is kept beside it, so Undo restores that status with its own day and setter, not "Active, today, by
  me". `server/volunteers/volunteerRecord.js` is the only writer; `makeVolunteer`, the profile, the role
  toggle, Atlas's make_volunteer and the repair script all go through it (the script writes the same
  columns in one transaction). No row means Active.
- **Removing the Volunteer role is Mark as former.** `PUT /people/:id/roles {role: volunteer, on: false}`
  keeps the role on the record (their hours and history stay with it) and sets Former. The roster and Ask
  count Active (`shared/numbers/volunteerStatus.js`) and say so; paused and former are named beside the
  count.
- **Applications are only what came through the page.** The Applications list and the profile's
  application block filter `via = 'page'`. A pre-VOL-3 record kept on a staff application is read as the
  record until `scripts/ops/vol3-staff-records.js` moves it.
- **Hours count once their day has come.** `shared/numbers/served.js` `SERVED(alias, today)` is spliced
  into every volunteer hours read (roster, list, counts, summary, the `volunteer-hours` source, groups,
  crossover, thank-you, "we miss you"). It splices the org's civil day as a literal after a strict format
  check rather than a `?`, because several of those queries already carry positional params and a missed
  position would silently compare the wrong value.
- **Erase takes applications** by person and by every address on the record, plus the volunteer record and
  the page sign-ups. An erase had left the person's NAME on the application: a privacy leak, not only a
  leftover row. An approved application whose person is gone gets a Delete (refused 409 for a live one;
  delete-scan allowlisted with that reason).
- **Events have a volunteer team** through `volunteer_slots.event_id`, set by the one shift write.
- **The header cards are Figures**, with four sources in `server/volunteers/volunteerSources.js`. The week's
  short shifts and conflicts come from the Schedule's own `weekProblems`, registered through
  `weekProblemsHook.js`, and handed to SQL as one `jsonb_to_recordset` parameter so the drawer pages and
  foots them.
- **Traps.** `DonorProfile.jsx` sits exactly at its split-shells baseline, so the Volunteer tab is a
  same-line change (`profileTabsFor`) with its body in `ListTabs.jsx`. A test helper named `roster` or
  `counts` clashes with earlier sections of parity3: suffix new ones. An Active-count check passes with a
  defect planted while nobody is former, so check it while somebody is.
- **Not in this build:** an Atlas step to pause or mark former (Atlas can make a volunteer, and its Undo
  works on the new table); a `vol3` column for "via agent" on the record (the audit row names the Agent).

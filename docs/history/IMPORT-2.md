## IMPORT-2 · Bring their whole history: notes, conversations, tasks and files (2026-10-08)

- **The wizard:** Donors, Import & tools, Bring your notes and history (also from a profile's "No history yet" and the
  donor import's last screen). CSV, XLSX or a zip (data files joined when their columns match; other files kept by
  name and put on the lines that name them). Preview writes nothing; commit writes interactions, tasks,
  relationships, tags and confirmed flags, all tagged with the run; one undo.
- **The notes file was not on this machine.** `tests/fixtures/import2/make-notes.js` writes a seeded stand-in to the
  brief's key, paired with the real 1,000-donor file. Scorecard: 1,910 by old id, 239 by email, 251 by name, 20
  nobody, 143 open tasks (142 written: one belongs to a person nobody created), 117 DO NOT SOLICIT rows on 112 people,
  120 HTML, 484 day-first, 6 refused (empty note, empty subject).
- **Defect the file exposed:** the donor import folded a person listed under two old ids and kept only one, so
  1,848 rows matched by id instead of 1,910. Both halves fixed (client fold keeps `externalDonorIds`; the server
  appends a learned id to `external_donor_ids`). **Second defect:** Calls to make ignored `do_not_solicit`.
- **Kinds:** a visit is written as a meeting with `metadata.kind='visit'`, so it counts toward Last met and
  engagement; letters, texts and event conversations are their own types and now count as conversations in
  figureSources. A completed task becomes a note "Task completed in your old system". Visits and calls score; notes
  still score zero (unchanged rule).
- **Ask:** a new person intent `talked` answers from the record's own lines (template only; no model call).
- **Walk:** `docs/import-2/walk.js`, 1440 and 390, all pass; screenshots beside it. The 503s on `/ai/stream` in a
  local walk are the missing model key, not this build.

# INTEGRITY-1 · Nobody vanishes, every count is the same count, one email belongs to one person (2026-11-07)

**Why.** The QA fleet's 7 Nov synthesis, on prod in CREO Arts (Demo): a $11,700 donor left the Donors list while
another area's 1,000-row import was undone (W-1107-Finance-35); Everyone read 1,218 against an expected 1,217; Owner =
Mike returned a row whose Owner said Admin User; Gives monthly matched everyone; a household and its member were two
LYBUNT rows with the same money; one email sat on two people; two identical pending invites; meeting staff named two
ways; a household member's Current tooltip said they gave when they had not.

**W-1107-Finance-35 (cause).** IMPORT-9's bring-back stamp named no file. Any spreadsheet import in the next 24 hours
that matched the person claimed it, so a person brought back for one file (or brought back and never imported) was
claimed by a different file, and that file's Undo trashed someone live before it ran. Reproduced on a fixture: brought
back for file A, then files B and C imported and undone at once: main claims her and trashes her.
**Fix.** The stamp carries the preview's `fileKey`; only an import of the same file claims it; Undo re-reads the trash
rows and trashes only people whose closed row names its run. `scripts/ops/integrity1-find-vanished.js` lists, restores
(`--apply`, one audit row per org) and reverses (`--undo`).

**W-1107-Prod-04.** Donors + Contacts = Everyone by construction on the Directory, so the stray one was a surface with
another rule: `/donors/summaries`' people total (and other `deleted_at IS NULL` counts) counted archived people and
erased shells. One definition, `shared/numbers/everyone.js`, read by the Directory and that total. Which record was
the extra on prod cannot be named without reading prod data: an archived person or an erased shell fits.

**W-1107-Donors-11.** The filter and the bar read `assigned_to` (the user id, the name live from `users`); the column
printed `assigned_to_name`, a copy taken at assignment, stale after a rename. Every face now names the owner from
`users` by id (`server/donors/ownerName.js`), including the column's sort.

**W-1107-Donors-13.** Not a code defect: FLOWS-2 is in the live build, the control sends `{field:"monthly",op:"yes"}`,
the server applies it, and a browser test through the real control lists only the month-apart givers. On main the same
browser leg passes. The 1,214 is the demo org's data or a stale read; left to DEMO-TIDY-1, with the browser test guarding.

**Duplicates.** LYBUNT/SYBUNT add `units` (household, gives-through, spouse) that the screen lists; `rows` stay per
person so the header and the truth check still foot. Data health: "A person and their household with the same gifts"
and "One email on two people". A save with an address already on another active person answers with a warning. A unique
index on pending invites, built CONCURRENTLY; the invite route closes expired ones first and answers 409 on a race;
`scripts/ops/integrity1-duplicate-invites.js` clears existing repeats. Meeting staff come from `users` by id.

**W-1107-Donors-22X.** `server/donors/currentThrough.js`: "Current through <name> (household | gives through | employer)".

**Tests.** `tests/integrity1.test.js` (one new suite; the brief asked for each). Main: 4 passed, 19 failed. Planted:
the claim without the file check turned §1 red.

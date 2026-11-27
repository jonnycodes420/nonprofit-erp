# SAFE-EDIT-1 · No double people, no lost edits, no silent deletes

Six items from Duet's production stress test (26 to 27 Nov, internal TEST STEWARD org, all mail off, prod c97f384 then
b681805). Each was reproduced first on staging (b681805, org_stagewalk, the walk account, real clicks in Playwright).
One PR; no new suite (quickadd1, household1, fix59-data-health and integrity2 grew).

## What happened
- **A double-click on Save made two people.** Reproduced on staging: one double-click on Add person's Save, two rows
  16 ms apart. Save now disables on the first click, and the form sends one request key for as long as it is open;
  `server/shared/requestKey.js` claims (org, kind, key) in the new `request_keys` table and answers every repeat with
  the row the first made (`repeated: true`, no write, its audit row skipped). The same middleware is on `POST /tasks`
  (the Tasks quick add and the profile's follow-up task send keys). Gifts and pledges already had theirs
  (`idempotency_key`, uq index; Record a gift and the profile's pledge form). An email already on someone in the org is
  now asked about before the create (`askFirst`, the INTEGRITY-1 rule): "Open them, or add a new person anyway?".
- **Back from an Edit lost the changes.** Reproduced on staging: Edit record, change name and employer, browser Back:
  the dialog closed, no prompt, nothing saved. The profile's forms never registered with the dirty guard, and Back
  never asked (only a tab change did, through `window.confirm`). Now `navigateTo` (Back, every rail link) asks first
  through `leaveIfClean`, in Steward's own dialog, and "Keep editing" puts the address back. Edit record, Log a
  touchpoint, the follow-up task and the gift and pledge forms register (`useOpenFormDirty`); Settings' sections use
  the same question.
- **Household "Remove" deleted the household.** Reproduced: no confirm, "Deleted the household.", no way to take one
  person out, and after Create the focus sat on Remove (React reused the button that had read "+ Group into household").
  Now "Delete household" asks; each member has "Remove <name> from household" (removing one of two says it deletes the
  household); both have Undo; focus lands on the first member after Create. The dialog re-reading after Undo already
  worked on staging (not reproduced, kept). Duet m15, reproduced: with both members in the trash the household stayed
  listed with 0 members. Now it goes to the trash with its last member and comes back with a restore, by every door
  (`server/donors/householdTrash.js`, called from `personTrash.js`).
- **A restore never re-checked Data health.** Read from code and seen on staging (no run after a restore): the trigger
  "restore" was not in the CHECK. The list of triggers is now `server/dataHealth/triggers.js`; the constraint is rebuilt
  from it (additive DDL, `builds/2026-11-27-safeedit1.js`), `runDataHealth` refuses any other word, and fix59 §9 fails
  when a caller names a word the list lacks (planted in-suite).
- **Tags and views.** Reproduced: bulk tag had no Remove and no Undo; tag chips no ×; deleting a saved view went on one
  click. The phone rewrite was read from code (`phoneNormal` reformats "617.555.0142" on every Edit save) and proven by
  quickadd1 §A6. Now bulk tag has Remove tag and an Undo for exactly the people it changed, a chip has its ×, a phone
  the Edit form didn't touch is kept as stored, and Delete this view asks.
- **The delete dialog.** Reproduced: an open pledge unmentioned; "Settings, Imports, Trash". Now it names open pledges
  with what is still to come (`shared/numbers/pledges.js openPledgesOf`) and points to Settings, Trash. The "36 days":
  rows deleted before the trash began emptying itself (9 Nov) leave on 9 Dec, more than 30 days after their delete. The
  sentence was the wrong one: it now says so while any such rows remain.

## Rows already wrong
- People already doubled by a double-click: Data health's duplicates already list them; merge by hand.
- Households already left empty: `scripts/ops/safeedit1-empty-households-readonly.sql` counts them; the apply is REPAIR-1's.
- Phones already reformatted: the format only (the number dials the same); the audit trail holds the old form.

## FLOWS-1 · Every button does what it says, and finishes where you'd expect (2026-11-05)

From two walks on a demo org (4 Nov) and Jonathan's own use; items 11-13 came in mid-build from that day's
walk. One suite, `tests/flows1.test.js` (32 checks, through the real screens), red on main for every item
it could reproduce.

- **1 Bulk Add to a journey.** The dialog lists each journey as a row with, for the people checked, who can
  start it, or why none can ("None of these 3 can start: all are already in it"). One read for all journeys
  (`server/outreach/journeyBatchOptions.js`, `POST /journeys/batch-options`), on the same split the preview
  and the start use, so a row and its Start never disagree. Drafts and paused journeys can be started by
  hand, as on the profile. Locally, main's dropdown was not disabled; the walk's "all greyed" was not
  reproduced, and the rows are the brief's fix.
- **2 Counted from.** Step 1 says "when they join" in words; the dead dropdown is gone.
- **3 Meetings and drag.** Calendar has "Add meeting". With no calendar connected a meeting is kept on
  Steward's own calendar (`server/tasks/stewardMeetings.js`, provider `steward`, which `calendar.js`
  already read); it was refused with "Connect your calendar first" while the dialog said "Booked on your
  connected calendar". It moves and cancels in Steward. A second press is not a second save. All-day items
  (tasks) drag between days in the week view (that row had no drag), with Undo. Tasks itself is a list
  with no days, so its "drag between days" is Calendar's.
- **4 Statements and receipts.** Made first and shown (the org, every gift's date and amount, the total),
  then Download PDF or Email it; nothing is emailed without that click (`POST /receipts/:id/email`, the
  issued PDF, never regenerated). The year opens on the year that has gifts. Moved out of
  DonorProfile.jsx into `profile/ReceiptsAndStatements.jsx` (DonorProfile shrank by 40 lines).
- **5 Import Done.** Main's exact path closed and landed on Donors locally; not reproduced. Done now clears
  the workbook and the file, closes, and goes to Donors from any host that opens the import.
- **6 Sign-out and the status poll.** Sign-out showed a working page locally (and on a demo-kind org); not
  reproduced. It now ends on a fresh load of `/login`. The status poll: a 404 on `/donors/:id/status` now
  says merged (and the kept id) or deleted; the hook never reads that id again and the profile opens the
  kept record. Main asked for a merged-away id on every re-read, every one a 404 (the address1 flake).
- **11 Yearly tasks.** Only `POST /tasks/:id/complete` made a repeat's next one. A tick on a profile
  (`PUT /tasks/:id`), bulk Done, a thank-you task's finish and Tell Steward now do too, through one
  function, `server/tasks/repeat.js`.
- **12 Mark done on Home.** It marks the step done (`POST /threads/:id/done`: close_kind 'dismissed' with
  close_reason 'done', as `threads_close_honest` allows; a journey's plan moves on, as on a dismissal;
  Undo reopens). "Log a call too" is a quiet link beside it.
- **13 Avatar.** It opened only the system file dialog, which an automated walk never sees. It now opens a
  picker on the page (choose, drop, remove).
- **7 Attach file.** A file's timeline date is the org's day, not the UTC day ("Tomorrow" after 7 pm ET).
  Storing an attachment has a 25 s limit with a sentence when passed (the 30 s hang's cause on prod, the
  asset store's wait, cannot be seen locally). The Files tab's upload spread a file's bytes into one call
  and silently saved nothing above about 100 KB; it reads the file as a data URL now and says when it fails.
- **8 Birthday tasks** follow an edited birthday (`server/donors/birthdayTasks.js`): open "on their
  birthday" tasks take the new month and day and the next time it comes round.
- **9 Next steps.** `POST /tasks` with a `kindKey` returns the open task of that kind for that person
  instead of a second; Insights' Create tasks sends it and counts who already had one. A next move's
  window whose end is behind its start reads "now" (`insights.js` windowWords). Both touch Insights code
  the brief listed as another build's; neither changes a number.
- **10 Merge compare.** The compare shows the whole address block (Street, Apt, City, State, ZIP) whenever
  either record has an address, even where the two agree, so the Donors bulk compare and the profile's
  read the same. The old Merge Duplicates modal (no opener on Donors) shows the same fields.

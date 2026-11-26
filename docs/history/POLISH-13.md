# POLISH-13 · the people count holds still, a deleted gift takes its thank-you with it (26 Nov 2026)

**Why.** Jarvis's lead for Thu 26 Nov: Everyone read 1,233 against the locked 1,232 (Contacts 114 against 113).
Read-only SQL on staging Harborlight found the one record: a funder organization that "New grant" had made
(funderLink.createFunderOrg) on 25 Nov, for a grant deleted 43 seconds later. The record had no audit row of its
own, because it was written inside the grant's POST. The grant's two stage changes had written activity lines on
it. UNDO-1's effects rule (what a write MADE goes with it) now covers it: server/grants/funderMade.js decides
whether the funder is the grant's own, the grant's removal trashes it through personTrash, and Undo brings it back.

The count paths also disagreed about archived people: /donors/counts (Home, Re-engage's badge), /donors/summaries
(Re-engage's rows) and the onboarding card counted them, while the Directory did not. All of them now read
everyone.js EVERYONE. During the walk window no person-table write happened in Harborlight, so the in-session
flicker between 1,232 and 1,233 was not reproduced from data. Re-engage's 281→282 crossed the org's midnight, which
can move a lapse date legitimately.

**Gift delete.** The gift's own timeline line (interactions.type 'gift', gift_id) outlived the gift. Its task
and next step were already handled (FIX-10, FIX-31, FLOWS-11). The snapshot now carries the line, the delete
takes it, and Undo restores it. Still OPEN: the refund-in-full half, an edited step that "says its gift is gone",
and the Gala Reserve fund case. No $125,000 gift exists on staging in either org, so that case was not reproduced.

**Undo window.** shared/importUndo.js is the one setting (hours per kind of file) and the one sentence.

**Timing.** On staging (4e2b12e) Brand kit and My profile showed their content in 0.2–0.96 s, and Atlas list
questions answered in 0.2–0.4 s with the AI switch off there. The slow readings were from prod. Both items stay
OPEN for a check on prod after Ship.

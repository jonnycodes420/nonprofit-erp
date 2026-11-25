# SENDS-3 · Nothing happens that she didn't ask for

Leftovers from SENDS-2, DEFINE-1, UNDO-1, TRASH-1 and CONTACT-1. Items 1, 2, 4, 5 and 6 of the brief, plus two
added by Jonathan (7: email photos as JPEG; 8: the wrong-number line). Item 3 (who can receive a campaign, in the
campaign planner) waits: BUILDER-2B was editing the campaign editor the same night.

- **Pledge reminders ask the one overdue rule.** The reminder job stamped `pledges.first_overdue_at` from the pledge's
  single due date and sent from the stamp. It now stamps and sends only when `pledgeSchedule.overdueOf` says an
  installment is past due today (`server/pledges/overdueNow.js`). Old stamps stay until
  `scripts/ops/sends3-pledge-stamps.js --apply` clears them; meanwhile the job ignores a stamp with nothing past due.
- **"Send me a test" in an org with email switched off.** org_stagewalk had both the donor and staff switches off; the
  gate let the test past the staff switch (STAFF_ON_REQUEST) but not the donor switch, and the route turned the
  refusal into a 502. A test she pressed for, to her own address, now passes both automatic switches (a demo org and
  an org not yet onboarded still refuse), and any refusal is a 409 with the reason's sentence
  (`server/mail/testSendWords.js`).
- **Open list makes nothing.** It opens People filtered to the answer's saved ids (`?atlas=<action id>`, groups.js
  `fromAtlas`). A group is made only by Save as group (`POST /atlas/actions/:id/group`).
- **Import undo asks about receipts.** Both doors that move people to the trash (Remove them too, and the confirm's
  Move them to the trash too) ask once for the batch, naming people and receipts, and void on yes.
- **The rail's Mark done is a write with an Undo** (`server/majorGifts/planStepUndo.js`, `POST /plan-steps/:id/reopen`).
  Any step that goes back to waiting loses its "Journey step" timeline line and its draft (archived by system:undo,
  revived if the step opens again). A tick or Done answers `listed`, so the toast no longer adds a second Recent
  changes line beside the server's.
- **Email photos as JPEG.** `server/mail/emailImages.js` points every non-JPEG/PNG/GIF asset an email references at its
  JPEG rendition (`/portal-assets/:id?fmt=jpeg`), in `emailCompose.render` and again in the wrapped Resend client.
- **The wrong-number line** draws: `adaptDonor` carries `phone_unreachable` and its reason.

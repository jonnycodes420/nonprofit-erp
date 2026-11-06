# WALKB-2 · Invites you can see, labels that match the profile, pledge years that add up, events you can delete

From Muse's Walk B, section 2 (5 Nov). The reconciliation passed 50 for 50; these were what was left.

What changed, and why each was wrong:
- **Invites.** Settings → Team read only `users`, so a pending invite showed nowhere but the Audit log,
  and POST /auth/invite never looked for an invite already waiting. `server/org/invites.js` adds
  GET /org/invites (pending: not accepted, not withdrawn), POST /org/invites/:id/resend (seven more days,
  same link) and DELETE /org/invites/:id (Revoke: `invites.revoked_at`, and the link answers 410).
  `inviteRefusal` turns away a member, a removed member and an address with an invite waiting, one
  sentence each. The invitation email moved verbatim into `sendStaffInvite`, which Invite and Resend
  share (send-gate's untagged list names it). Settings → Team shows them under Invited
  (`settings/InvitedList.jsx`), dated in the org's day.
- **Attendee label.** The row asked `donors.stage` (the pipeline column, empty for most imported people)
  and said "Not a donor yet" whenever it was empty, so a $40,709 donor read as never having given.
  `shared/numbers/donorLabel.js` is the profile's rule (lifetime above zero, or a gift on file): someone
  who has given reads their pipeline stage past Prospect, else Donor.
- **Edit Event date.** `events.date` is a DATE, which reaches the page as an instant
  ("2026-12-30T05:00:00.000Z"); a date field shows nothing for that. `client/src/lib/eventEditForm.js`
  takes the day, and the dialog now carries the start and end times too.
- **Pledge years.** The $900 walk pledge was in an org whose fiscal year runs July to June, so all three
  installments fell in FY 2026–27 and "$900 due this year" was the fiscal-year figure, read as the calendar
  year. The figure is unchanged (`dueOf` to the fiscal year's end, Home's and Fundraising's own); the words
  now name the year ("$600 due in FY 2026–27", "FY 2026" for a calendar-year org), from
  `pledges.dueThisFiscalYear` and shared/fiscalPeriod.js. "1 more installment" counted the installments
  after the next one; the open pledge now says the unpaid count (`pledges.unpaidCount`), "2 installments left".
- **Grant status.** The cause of "Awarded, but no award recorded" beside "Received $35,000, 100% funded":
  a grant with no award pledge still shows the legacy typed `grants.received` column (from before GIFTS-1).
  `shared/grantAwardLine.js` says "Received $35,000, award not recorded." with Record the award;
  `scripts/ops/gifts1-grant-received.js` turns the typed number into a payment once the award exists.
- **Event delete.** DELETE /events/:id had no button and would have deleted an event with gifts.
  `server/events/eventRemoval.js` deletes only an event with no gifts, pledges or guests, refuses the rest
  with 409, and archives instead (`events.archived_at`); an archived event leaves the list (Archived shows
  it) and its gifts stay counted.

Test: `tests/walkb2-leftovers.test.js` (21 checks). On origin/main 8959243: 18 failed. Planted: `dueThisFiscalYear`
returning the balance turned §3 red ($900, then $600).

Found and not fixed (next brief): Home's and the profile's pledge move (`insights.js`, "Open pledges to collect")
keeps its own "this year": the calendar year, and only installments flagged paid. For a July-year org it said
"This year's part is $300" beside the pledge's "$600 due in FY 2026–27". It should read `pledges.dueOf` to
the fiscal year's end and the same year label. Also: "due this year" (`dueOf` to the year's end) includes an
installment overdue from an earlier year; the brief's wording ("fall due in the current fiscal year") would
leave those out, which changes Home's and Fundraising's totals, so it was left for a decision.

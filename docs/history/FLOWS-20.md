# FLOWS-20 · A profile tick that won't finish a task, a bulk touch with no lasting undo, a journey with two counts, a Giving tab that errors, and a saved view that won't reopen

Six items from lead-2026-11-20 (the ninth staging night), plus ONBOARD-3's Ask Jonathan. One PR, one new suite
(`tests/flows20.test.js`).

## What happened
- **The profile tick (W-1120-Donors-T11).** FLOWS-17 made a profile tick on a call or meeting ask how it went, as the
  Tasks page does, but it opened the generic Log a touch (`setConvoOpen`), not the Tasks page's FinishSheet. Log a touch
  never names a task, so logging the call left the task open, and its default "Follow up" replaced the person's open
  next step. Harborlight's "Call about the spring showcase" and org_stagewalk's "Call about the spring visit" are both
  kind `call` (staging, read): nothing about the org differed, and no tick of a call task could finish on any profile.
  FinishSheet now lives in `components/tasks/FinishSheet.jsx`; the Tasks page, the Calendar and every profile door use
  it. When the person already has a different next step open, it starts on "No next step" and says that step stays.
- **The bulk touch (W-1120-Donors-T20).** Recent changes is read from the seams that undo things; a touch batch was not
  one, so after the toast it could only be undone person by person. Batches are now a source (`touchBatchChanges.js`),
  undone by the toast's own route. The toast's own 60 seconds held in a clean staging run; the vanishing toast did not
  reproduce (see the report).
- **Two journey counts (W-1120-Fundraising-32).** The list header counted every run; the panel counted runs of people
  still on file (Harborlight's New donor, first year: 17 vs 6). Both read `shared/numbers/journeyCounts.js` now. The
  panel's "changing" value was a race: landing opens a journey, and its late stats reply overwrote the one clicked.
- **Verity's Giving tab (W-1120-Fundraising-13).** Not NUMBERS-7 or FLOWS-19. Staging's HTTP log, 20 Nov 05:18–05:19 UTC:
  Verity's profile loaded in Harborlight, a sign-in to org_stagewalk followed in the same browser, and every read on her
  tabs then went out with org_stagewalk's token and came back 404. HARDEN-1 bound writes to the tab's org; reads were
  not. Reads now carry `X-Steward-Org` too, and the server answers a stale tab's read 409 `org_changed`.
- **Saved views (W-1120-Donors-16).** A `<select>` fires no change for the value it holds, and the menu kept the view's
  id after its filters changed. A changed list shows "<name> (edited)", so picking the view applies it again.
- **Touch titled (W-1119-Donors-T8, repeat).** EDIT-2 wrote "Type the touch's title." on the server, but the client never
  sends an empty filter, so the words never showed. The hint now sits under the empty box with the org's recent titles.

- **Follow-up (#2 PR), found on the staging re-check.** With a second tab signed in to another org, the banner showed and
  "Donor not found" was gone, but the fund panel still read "Could not load fund data.": its loader swallowed the error.
  It now says the refusal's own sentence. The suite's first check swapped the token after the panel had already loaded,
  so it could not see this; it now swaps before the Giving tab's first read.

## What was learned
- A guard on writes only is half a guard: reads answered from another org look like missing data, and the fleet
  reported them as a new defect in the numbers.

## FIX-28 · Peer-to-peer create, many grant deadlines, one calendar rule (2026-10-06)

Jonathan walked Harborlight on 6 Oct: he could not create a peer-to-peer campaign, could not add a
second deadline to a grant, and the deadline he did add never reached the Calendar.

- Peer-to-peer create was hidden, not missing: the only door was the Campaigns form's "let supporters
  fundraise" tick. The tab now has "New peer-to-peer campaign" (one request through POST /giving-pages,
  which now takes `endsOn` and `p2pRequiresApproval`) and a staff "Add a fundraiser"
  (POST /giving-pages/:id/fundraisers: same exact-email person match as the public sign-up, written
  active, emails nobody, returns the manage link to the staff member).
- Grant deadlines: the "one LOI per grant" refusal is gone; any number of any kind, plus `custom` with
  its own name (`grant_milestones.label`). Only the same kind on the same day twice is refused. The form
  stays open after an add. Edit, move, done, undo done (`/reopen`) and take off (`/remove` = skipped,
  which every read already leaves out) all offer the shared Undo toast.
- The calendar rule: grant deadlines were the dated item calendar.js did not read. They are type
  `deadline` now, owned by the grant's officer, draggable through PUT /grants/milestones/:id (which moves
  the follow-up thread with it). A saved type choice from before keeps new types visible.
- Her own calendar: opt-in per person (`mailbox_connections.push_dates`). Her deadlines, next steps,
  tasks and journey steps for 60 days go to Google or Outlook as all-day entries with no attendees, so
  the calendar read never brings them back as meetings; moved ones move, finished ones come off,
  turning it off removes them all (`calendar_pushes`). Shifts, events, sends and pledges have no one
  owner and stay on the Steward Calendar.
- The ASK-3 bug elsewhere: thinking left at the model default with a small budget. Eight short-text
  calls now pass `thinking: {type: "disabled"}` and refuse a reply whose stop_reason is not end_turn
  (milestone and at-risk drafts, wealth rationale, board summary, voice memo, draft-email, column map,
  and the help answer on opus-5, which was the live case). Forced-tool calls were unaffected.
- Test: `tests/fix28-calendar-rule.test.js` (one of each dated type on the feed, three deadlines and a
  drag, the push to a stand-in Google). Proven able to fail three ways before it was trusted.

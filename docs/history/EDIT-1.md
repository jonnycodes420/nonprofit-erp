# EDIT-1 · A task on a person's profile opens to edit, the way it does on the Tasks page (18 Nov 2026)

One item from a paying customer, by email on 18 Nov: "I put in a task for Dec 2 … I want to edit it.
Can I do that?? It doesn't seem like I can click into it?", and earlier the same day, after ticking
"Send thank you": "and then want to click into it to write details of what it was and it won't let me."

## What was found
Reproduced on staging (build bab7e24) with Playwright, read-only clicks on a Harborlight person's
task: a click on the title in Coming up opened nothing, and on the Tasks tab it only expanded the
card. The Tasks page's edit sheet (`TaskSheet`) was a private function inside `Tasks.jsx`, so no
other screen could open it; the profile drew a task's title as plain text. FLOWS-17 made the box
beside a profile task tick it, but never gave the title a way in.

## What changed
- The sheet moved out of `Tasks.jsx` into `client/src/components/tasks/TaskSheet.jsx`, one component
  the Tasks page and the profile both import. It saves through `PATCH /tasks/:id` only.
- `client/src/components/profile/ProfileTaskSheet.jsx`: the title button and a hook that asks
  `GET /tasks/:id` for the row the Tasks page reads, then opens that sheet. Coming up, the timeline
  (cards and list view) and the Tasks tab (the same timeline, filtered) use it.
- A done task opens: notes, checklist and the rest stay editable, Reopen replaces Mark done.
  Read-only shows every field disabled, with Close and no Save. The sheet now says its own errors.
- No refresh was added by hand: the PATCH is announced on the one channel (STALE-1) and the
  profile's task list re-reads (COUNTS-1), so the edit shows with no reload.

## Why it was missed before
Each screen that showed a task grew its own way to act on it (FLOWS-6 the picture box, FLOWS-17 the
tick). Opening a task was never listed as a thing a profile did, and the sheet that did it was not
exported, so there was nothing to reuse.

## Existing rows
None. This was a missing way in, not bad data.

# SENDS-1 · Off means off, Atlas asks before it saves, every action happens once

7 Nov 2026. From the QA fleet's 7 Nov synthesis (W-1107-*), run on prod in CREO Arts (Demo).

## Why

The Settings page said "Steward sends nothing on its own" and "Email is off for your organization" while the
Journey and sequence steps switch read On and two sequences read Active above "No active sequences". Nothing
actually sent (the gate held it), but every surface told a different story, and an enrollment that came due
was closed as "unsubscribed" when the org's email was off: the person had done nothing. Atlas's footer says
"I send nothing without your yes" while it logged calls and set reminders on its own, the reminder twice.
A skip completed the follow-up it was meant to leave alone; a gift got two thank-you tasks; an owner change
two records; Done on a Home move brought the same person straight back.

## What changed

- One master: the org's Donor mail (`server/outreach/sendsOff.js`). Off, every surface says Off and a due
  journey or sequence step becomes a draft (never a send, never an "unsubscribed"). A sequence with an empty
  step or no trigger can't be turned on. `scripts/ops/sends1-off-audit.js` lists orgs that broke it.
- Atlas proposes, she saves (`server/atlas/proposal.js`, `ProposalCard.jsx`), claimed once by proposal id; a
  draft is signed and makes no task unless "remind me" is ticked. `create_task` writes one follow-up.
- Skip closes nothing (`server/tasks/logClose.js`). One thank-you per gift (`server/shared/thankYouOnce.js`,
  `tasks_one_thanks_per_gift`). One Reassigned line, from the assign route. Done on a move settles the
  person's folded Drifting sign.
- Journeys: the birthday preview uses the run's own start day; "Add to a journey" lists every journey, greyed
  with why; Calendar tasks have Delete; batch Undo has a backstop for Threads and scheduled emails.
- giftSentence reaches the editor's own preview, the text part (drafts) and the subject; the ask starter says
  "a second time" instead of "again".

## What was not reproduced

W-1107-Fundraising-29 (batch Undo left step tasks) does not reproduce on a clean fixture on main or here: a
step's Thread is deleted by Undo and its task goes with it (the thread trigger). The backstop above covers a
journey Thread no step points to; if the fleet sees it again, the org's batch and plan ids are what to read.

## Tests

`tests/sends1.test.js` (the brief allowed more than one test; they are one suite): main 8 passed, 22 failed;
here 30 passed. Planted: `mailPolicy.orgMailDecision` reading Donor mail as on sent four emails while Off
(§1 red). Pins moved with the rule: feel1 §3 (a skip on its follow-up), send-gate-2 §4 (Off, not Waiting),
atlas4-brief §6 (the empty-state line), flows2 §1 ("people to follow up"); Atlas suites press Save
(`tests/helpers.js` `atlasSaved`).

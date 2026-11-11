## TOUCH-1 · Log any touch in her own words, finish a task early, edit the Ask in the Top 100 (2026-11-10)

Why: a beta director (10 Nov) logged a handwritten note under "Log a call" because nothing else fitted,
said a task "wouldn't let me mark it done because it was too far in advance", and could not find how to
edit the Ask column in her Top 100.

- **Log a touch** replaced Log a call at every door (profile, Home's moves and Thread rows, the Top 100's
  rows, the plan of care, Atlas's log step, the onboarding board, Donors). She picks a kind
  (`shared/touchKinds.js`: Call, Handwritten note, Email, Visit, Meeting, Gift sent, Event invite, Text,
  Other, plus her org's own from Settings → Your words → Kinds of touch, `org_touch_types`) and writes it
  in her words. When is today or earlier, Who did it defaults to her, a call can be Reached, Voicemail or
  No answer, and the next step is optional ("Follow up in 2 weeks" sets the day). The request names
  `touchKind`; the older `touch` key is unchanged for FinishSheet, Atlas and the suites.
- **The timeline** reads "Handwritten note: Sent a thank-you card ... · Today · By Allie", with an icon by
  kind (`touchIcons.jsx`, also on the dialog's chips). **Last contact** (meetings.js) counts every kind,
  and its sentence, the census line and the truth check's key (`tests/lib/countsKey.js`) say so.
- **A planned touch is done by logging it.** The dialog offers "This completes the planned note (due
  Dec 1)"; the task keeps its due day and is done today. The care-touch trigger no longer writes a second
  "(plan of care): done." line when her logged touch completes the task. Ticking a planned touch in Tasks
  or the plan of care offers to log it.
- **"Too far in advance" was not reproduced.** A task due next month marked done from the profile, its
  Tasks tab, Home, the Tasks page (Later) and the plan of care on main, in a production build, and the new
  suite's §4 is green on main. No such rule exists in the code; the suite pins that none comes back.
- **The Top 100's Ask, Ask by, Stage, Owner and Next step edit in place** (`InlineCell.jsx`), as do the
  same fields on the plan of care: one field per save (`PATCH /donors/:id/care-plan`, `.../touches/:taskId`,
  `server/majorGifts/top100Edit.js`), Stage and Owner through the person's own routes.
- Found on the walk: the next-step date box in the dialog was 150 px tall (a flex basis on an input inside
  a column wrapper became its height); it was the same in the old dialog. Fixed.
- Not in this build (next brief): Last contact's other copies (`donorList.js`, `groups.js`, `why.js`,
  `routes/voice.js`, `prospectBrief.js`) still list calls, meetings and emails only; the Engagement
  score's "No meeting, call, reply ..." reason does not count a handwritten note.

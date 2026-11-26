## COMMS-3 · Drafts to review opens every time; Audience shows who you can reach (2026-11-26)

Jonathan on prod, 25 Nov: Drafts to review "makes no sense, half the time I hit read it and it glitches";
Audience "could look a LOT better" (he approved `_briefs/COMMS-3-mockup.html`).

**The glitch, reproduced on staging first** (org_stagewalk, 92 drafts, Playwright, list sampled every 50 ms):
the first Read of a draft POSTed `/thank-yous/:id/opened`; its X-Steward-Changed said `draft,task`, so every
view on the `draft` topic re-read. MilestoneDraftsPanel's `load()` set `loading` and returned `<Spin />`,
which unmounted the thank-you list under it: the list went to 0 rows twice and came back with nothing open.
"Half the time" because a draft already opened sends no POST. Fix: `/opened` answers `none` and is a
seen-only write in api.js (it also stopped throwing away held reads); the panel shows the spinner only on its
first read and keeps the newest answer; the thank-you list reads through `useLiveRead` and keeps a set of
rows taken away here until Undo, so a read that left before I sent it cannot put the row back.

**Undo on I sent it** (`server/outreach/thankYouUnsend.js`): the send now keeps the gift's acknowledgement
columns in its interaction's metadata, so Undo puts back exactly what it changed (the timeline line, the
gift, the thread it closed, the draft), within an hour. Not sending this is COMMS-1's dismiss without the
confirm, with its Undo.

**Audience** (`server/outreach/audienceView.js`, `shared/numbers/reach.js`): one statusSql read feeds the
lapse card, the Major card and every row's pill. The reach split is DEFINE-1's Donors population, by has an
email / a postal address Printed letters can print to (ackLetter.js addressLines' rule) / neither, so it
always foots to Donors. Two new figure sources (`reach-part`, `audience-segment`) open every count and dollar.
A zero card says why from the data. Major is FIX-49's giving level, not a stage, so "no stages set" is said
only together with "no one gave at your Major level"; the step is Major Gifts → Pipeline with the top 40 by
Lifetime and no stage, ready to stage (`server/majorGifts/stageTop.js`). `+ Add` stamps `prospect` on new
people while imports leave stage empty: an org built by hand will rarely see the no-stages reason.

figureSources.js was at its big-files ceiling on main, so its module registrations moved to
`server/reports/sourceModules.js` rather than squeezing lines.

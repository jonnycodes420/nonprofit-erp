## VOICE-2 · Tell Steward everywhere, a whole meeting filed, and the check fixes (2026-10-20)

Jonathan walked prod on 20 Oct: check capture and Tell Steward on the phone were good; the green bar on Home looked
clunky, laptops could not listen, the same-name choice could not be clicked, and he wanted Granola. Built: browser
speech recognition on any device that has it (`shared/voiceMeeting.js` `listenMode`, Firefox types and says so);
meeting mode (`voice_meetings`, MeetingMode.jsx: brief, consent line, live transcript with restarts stitched, her own
notes, Pause/Stop, saved as it goes, summary filed through the one memo path, transcript screened and deletable, one
question about the meeting); the payee check and written-cents reading (`shared/chequeRead.js` `payeeMismatch`,
`chequeDigitsToCents`). The same-name cause: each pick REPLACED the last, so a memo naming two shared names asked
about the other one forever; with AI off a pick kept both people and asked again. Home is unchanged: two mockups
(docs/voice-2/mockup-A/B) wait for Jonathan's pick. Not built, and why: the other side of a Zoom call (needs a
desktop app or a paid speech service), and chat across every meeting plus Recipes (CLAUDE.md: no chat). Suite
`voice2-everywhere`.

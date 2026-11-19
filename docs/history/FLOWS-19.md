# FLOWS-19 · The starter card's $25, a cancelled plan that vanishes, a paused journey that still acts, a step 2 that doesn't exist, and one lapsed count

Five items from lead-2026-11-18 (the seventh staging night). One PR, one new suite (`tests/flows19.test.js`).

## What happened
- **The starter card (W-1118-Fundraising-T1, third night).** New campaign's cards were filled by `GET /campaigns/templates`
  from its own SQL: the person with the newest gift ROW and that row's raw amount. Silas's newest row was a $25 gift
  refunded in full. FLOWS-14 fixed the segment preview's read (`lastGiftRow`), FLOWS-18 the starter's merge tag and the
  block engine; each fixed the surface it was shown, and the gallery was a third reader of "the gift" that neither
  looked for. Now the card, the editor's preview person and "Send me a test" as a person all take their person from
  `server/outreach/previewPerson.js`, whose gift is `emailCompose.personFields`, the send's own fill (lastGift.js).
- **The cancelled offline plan (W-1118-Finance-24).** Recurring giving's roster listed offline plans through
  `OFFLINE_ACTIVE` only (MONEY-4 wrote it for MRR and reused it for the list), so a cancelled offline plan left no row,
  while a cancelled card plan stayed as "canceled". The roster now lists cancelled offline plans as `canceled` with
  their cancel date; MRR and the sustainer count still read `OFFLINE_ACTIVE`. On read, so no rows change.
- **The paused journey (Area 1 Explore 8).** Staging's audit log shows every Birthday-card entry was the fleet's own walk
  (resume, apply by hand, stop, pause), stamped "Steward (journey)" because every journey write is. No runner write.
  But the guess about the runner was right in kind: pausing stopped new starts only; the people already in a paused
  journey still had their next step opened, an automatic email still sent, and touches were re-spaced. A paused journey
  now holds everyone at their step (`server/shared/journeyPaused.js`); turning it back on picks them up.
- **Step 2 of 1 (W-1115-Fundraising-32, repeat).** FLOWS-16 wrote `step ${seq + 1}` believing seq counted from 0;
  plan steps count from 1. Its own test fixture inserted seq 1 for a one-step journey with no steps and expected
  "step 2", so the test held the defect in place. The number is now the editor's position of that step.
- **Re-engage +1 (W-1118-Donors-T6).** Nothing kept who was on Re-engage, so a changed count could not be explained.
  `reengage_snapshots` keeps the list once a day (an hourly job), and the line under the count names who moved since
  and why, from the count's own condition (`peopleCounts.reengageRowsSql`). The lapse rule is unchanged (NUMBERS-7).

## What was learned
- When a fix names "the surface", grep for every reader of the same fact before closing it. Three repeats of one
  starter came from three readers of "a person's last gift".
- A test fixture that hand-writes rows must be shaped like the rows the app writes (seq from 1, a journey with steps),
  or it pins the defect.

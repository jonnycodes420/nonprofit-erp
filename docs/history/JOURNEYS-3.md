## JOURNEYS-3 · Journeys start themselves (2026-10-07)

Nine new triggers (membership ending in 30 days and lapsed, monthly gift failed and cancelled, card
expiring next month, volunteer hours 10/25/50/100, first event, grant awarded, peer-to-peer goal), one
`lifecycleRows` definition shared by the hourly sweep and "already qualify", and a ready-made journey for
each that arrives off, its email steps drafting from the org's own EMAIL-1 templates (saved from the
starter by `ensureStarterTemplate`). The one-journey-per-person rule was retired on purpose: a person may
be in several journeys, steps from different journeys are spaced by the org's touch gap (7 days,
`spaceTouches`), and only journeys marked "Only one of these at a time" still replace each other.
`thread2a-no-send` §5 was rewritten to the new rule. The Harborlight walk's four defects: the apply
dialog now counts the split before the click (`applySplit`, the same one the apply uses, which is what
made "18 qualify" and "11 put in" disagree); the result is the shared Undo toast with an exact Undo; the
counts read 0 because `window.alert` blocked React from drawing them; and the em dash, plus a guard in
`no-emoji` that parses client copy (518 dashes removed across 52 files). The dialog opened in 74 ms
locally before and 84 ms after (one query, now two reads in parallel); prod was not timed because signing
in to the demo writes a session. Test: `tests/journeys3-triggers.test.js` (99). Map 163 / 55 / 4 to 168 / 50 / 4 (merged after THREAD-3).
**Follow-up (JOURNEYS-3-FIX):** the dash codemod treated a spaced separator (" — " between two values) as a
bare placeholder and printed "Not set" in 44 places ("until your first charge of $199 Not set", "Org: X Not set
mission"). Each became the separator its sentence needs (a colon, a middle dot, a comma, "to"), and `no-emoji`
now fails on "Not set" with copy beside it (44 on f733ac4, 0 after).

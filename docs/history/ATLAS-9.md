# ATLAS-9 · Atlas understands the question however it's asked, and the brief names what matters next (2026-11-23)

Why: Jarvis's 23 Nov re-run (after the 11 sweep builds). A brief on Margaret Chen had the money right and skipped her open $25,000 ask, an unthanked gift and coffee the next day. Lapsed questions got no count: ATLAS-8 read "lapsed" with one whole-sentence regex (`LAPSED_ONLY`), so "who's lapsed this year?" went to Ask and came back as 43 donors past their own rhythm, and "how many people stopped giving?" as a retention sentence. "Who should I call to win back lapsed donors?" was the morning call list (why.js `call`, which ranks reasons): one person in five was lapsed. Top donors showed each person's last gift ($80) where the year's total ($19,049) belonged; Ask's people already carried the total, and Atlas's list never read it. And the reading-off line was in the dialog only.

Reproduced first on staging (5c922c6, Harborlight, real clicks in Tell Steward): all of the above, word for word.

- **The brief names what's open** (`server/atlas/briefOpen.js`): open asks (amount, purpose, stage, expected date), gifts not yet thanked (thanks.js AWAITING since the org's Steward start, the profile's rule; the start's SQL moved to `shared/numbers/stewardStart.js` so both read it), the next meeting with its date. Then the next step, giving, conversations, About.
- **Any population question** (`server/atlas/populationAsk.js`): the registry's words, minus the plain words of asking; nothing left means a population question. Ambiguous Lapsed/LYBUNT answers both. Lapsed rows now read lifetime and last gift by shared/numbers, not the stored rollups.
- **A population's call list** (`populations.js populationCallAnswer`): the askable twin, ranked by lifetime, drawn as a `why` answer labelled "lifetime"; a portfolio user is refused it like the other org-wide lists.
- **Top donors** (`answers.js periodTotalWords`): each row is Ask's own per-person period total, labelled ("$30,080 this year").
- **Reading off** (`shared/atlasReading.js`): one line, drawn by the dialog, the Home Thread (AskRail) and Settings > Atlas.
- Tests: `tests/atlas6-grounded.test.js` §7 (14 checks, a 23-phrasing table). Run against a main server on the same database: 10 red.

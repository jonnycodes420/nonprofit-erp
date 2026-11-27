# FRESH-4 · The screen is right the moment a save lands, everywhere, from one rule (27 Nov 2026)

**Why.** W-1112-Volunteers-01X had been ranked every night since 12 Nov. Eight builds wired one surface at a time to the kinds its write announced (FLOWS-8, FLOWS-10, FLOWS-13, STALE-1, STALE-2, LIVE-2, FRESH-2, FRESH-3). Each passed its own tests, and the fleet still saw stale screens.

**Measured first (staging c03e332, walker, org_stagewalk, real clicks).**
- For each write: open the screen and take every GET it makes (bundles taken apart into their parts). Then do the write and ask two things:
  - did the page ask for each part again within 1 s;
  - does a fresh GET of each part, 300 ms after the answer, differ from before?
- Client-stale cases:
  - The Donors list after a gift from Record a gift: the list re-read only when the dialog closed, 1.6 to 2.2 s later.
  - Home's organization name after a rename: the boot read of `/org`, never read again.
  - The profile's insights card after a pledge.
- Server-stale: one answer only, a person's scores. The queue rewrites the row 3 s after the change.
- Every other aggregate (Finance, Fundraising, Home, Reports and the profile, 27 GETs after a gift) was new at 300 ms.
- Most of the fleet's list was already fresh on c03e332: hours, shifts, recurring plans, journeys and meetings, on the profile and on Volunteers.
- The template case was a real bug the lag hid. The Event invite goes in as four parts, ✕ took out only the part selected, and the other three were saved.

**What changed.**
- **Any write re-reads every surface on screen** (`client/src/lib/changes.js`):
  - A write from this tab, or another tab on the org, reaches every mounted view.
  - The views its kinds name re-read at 120 ms; every other view in the same round, by 250 ms.
  - Every such change carries `wide: true`, so a view's own filter can't veto it. The Donors list's "only adds and deletes" filter was one.
  - A hidden tab re-reads when it is shown again.
  - An answer that says `none` reaches nobody. The worker's marks and `told()` keep their kinds.
- **A read after a write is never older than it** (`server/donors/scoresPending.js`). While the person's change is still landing, their scores are computed on the fly for that answer:
  - the event not yet relayed;
  - the after-change step waiting or running;
  - the org's rescore queued.

  Read in the same tick as the gift's answer, the rescore is not even queued yet, so checking the rescore job alone was not enough (the plant showed it). The stored per-org answers already never serve stale (REPORTS-SPEED-1).
- **Home's org is a boot slice** (`lib/bootSlices.js`, `adaptOrg` in `api.js`), so a rename reaches the greeting.
- **A ready-made or saved block's parts are one block for ✕** (`useEmailBuilder.js`), by block id for the session, so it holds across a save. One undo step puts them all back.
- **An emptied Hours a week asks first**: "Clear hours a week?" (W-1126-Volunteers-01).

**The guard** (`tests/stale2.test.js`, `tests/lib/fresh4Walk.js`).
- §K does each write with real clicks and asserts the visible line within 1.5 s, no reload: gift, pledge, recurring, hours, Can give, shift, meeting, journey, org rename, and the template's invite taken out.
- §L reads four answers in the same tick as a gift and compares them with the answer once the queue has finished.
- §M is the census: every write route of the live router in those families names a step. A refund taken out of the list fails it.
- Plants, each red:
  - the scores bypass removed → §L;
  - ✕ taking only one part → §K's template step;
  - a missed kind on the Donors list → §K's gift step stays green with the wide rule, and goes red with it off.

**What was learned.**
- Wiring checks pass while the screen is stale. Check the screen.
- A per-view filter on a change is a second rule that can disagree with the first. The wide flag makes the write win.
- A row the queue rewrites after a change is stale for that window. Either bypass it while anything for that person is landing, or don't serve it.

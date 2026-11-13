## COMMS-SPEED-1 · Communications opens without reading every person, and stops when you leave (2026-11-13)

PROFILE-SPEED-1 found Communications paging through every person's summary (`GET /donors/summaries`,
500 at a time: 21 pages and ~40 s on a 10,000-person org), and the loop running on after the page was
left. It moved the read so it no longer ran on open, but it still ran when a hand-picked (Manual)
audience was chosen. `lib/people.js`'s `allPeople()` (Donors' Team, Re-engage and Map, Lost and Found,
the gift-history import) did the same and could not be stopped.

- **Manual audience searches on the server** (`components/communications/ManualAudience.jsx`): the
  Donors list's person search (`/donors/pick`, match "person", with an email address), the first
  50, highest giving first, with the people already chosen read by id. Communications reads nobody's
  summary now. Audience counts and reasons were already one server call (FLOWS-7's
  `audienceReasons`, through segment-preview and the hub); they are unchanged.
- **Nothing outlives its page.** `allPages()` takes a signal and stops between pages and mid-page.
  `allPeople()` is shared by its callers and cancelled when the last caller with a signal leaves.
  Every caller passes one: the effect's own AbortController, or `useLeaveSignal()` for reads a
  button starts. The server already cancels a read whose request closes (LOAD-1).
- **Each summaries page is ~10× cheaper.** Two causes. Every page re-read the whole org's
  interactions and drift, and stored the drift from a GET. It now reads them for that page's people
  with `store:false`, as the Donors list's page has since LIST-2. And `LAST_YEAR_OF_GIVING`
  (`shared/numbers/atRisk.js`) was planned with the "last gift date" aggregate inside the loop over a
  person's gifts (14,584 runs per 500 people, 1.7 s). It is now a sub-select that runs once per person
  (53 ms). The figure is the same for all 83,015 people in the ten-orgs fixture, and the full
  summaries are byte for byte the same. The whole-org read went from 42 s to 5.6 s.
- Tests: `page-budget` gained two checks (Manual reads no summary; 1 s after leaving Re-engage no
  summaries read is in flight or started, with each answer held 1.5 s so a read that isn't cancelled
  is caught). The audience-sum rule stays with `flows7-truth` §4.

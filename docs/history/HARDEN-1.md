## HARDEN-1 · Imports, deletes, undo and sending that cannot go wrong (2026-10-27)

- **Why (27 Oct).** Every serious bug of the day sat between features: an import that timed out but committed, a receipt with no Undo, pledges from the wrong column, deleted people re-created, and three imports that landed in the wrong org. Every build's tests passed because each tested its own feature against a file it wrote itself. This build changes how Steward is tested.
- **The wrong-org imports (confirmed).** There is no org switch inside Steward. A user row belongs to one org (email unique), `requireAuth` takes the org from that row, and the token lives in `localStorage["npe_token"]`, shared by every tab and replaced by a sign-in in any tab. A tab still showing Steward LLC wrote with CREO's token. Now every non-GET carries `X-Steward-Org` (client/src/lib/orgBinding.js), `middleware/orgBound.js` answers 409 "This page was for A, but you're now in B. Reload to continue.", an import's commit must match its preview's org, other tabs get a banner within a second (BroadcastChannel `steward-org`), and commit buttons (`data-commit`, client/src/lib/commitGuard.js) never fire on Enter from a field.
- **Real-shaped fixtures.** tests/real-shaped.test.js imports Jonathan's scrubbed gift history (287 rows), dinner sheet (106 + a totals row) and contacts (656) into one empty org, checks them to the cent against his `expected.json` (whose `years` are net of the set-aside rows), and undoes each back to the exact state before. Contacts match 79 people already here. Fixes: Category is read cell by cell (an event or appeal label is the gift's campaign, an accounting label stays on the gift as its category), commas in business names, organisations by whole-word business tokens, a name-only match to someone deleted is a question, one importer at every entry point, and the old mapper's runs undo.
- **The truth check.** `assertSurfacesAgree` (tests/lib/surfacesAgree.js) runs after every import, delete, undo, merge and restore in eight suites. It found the Move Report counting deleted people's gifts, Fundraising comparing this year so far with all of last year (now one `vsLastYear` over the same days), Home's file line summing stored counts, giving pages counting deleted people, and `/annual-fund` joining NUMERIC strings and reading the year through a UTC Date.
- **The breaker.** tests/breaker.spec.js drives the real app: double clicks, dropped networks, closed tabs, two tabs on two orgs, a 3-minute sleep, Enter in every field. It found a campaign Send that mailed twice, an undo that ran twice from two tabs, "nothing was changed" said about an undo that ran, a half-restored bulk delete, an import's lost answer reported as nothing written, and a deleted person's email not blocking a row when living people shared the name.
- **The nightly check.** nightlyCheck.js runs at 3:30 ET on the worker, read-only, and mails only Jonathan, only when red. Check d reads Home as she sees it (the stored answer) and counts archived people in, because archive takes a person off the list and nothing else.
- **Leftovers.** The two POLISH-3 flakes are deterministic, the battery takes a lock, and an undated gift no longer breaks a receipt, an acknowledgment letter or the QuickBooks and Xero sync.

## HARDEN-1 · Make it hard to break (2026-10-07)

FIX-29 reached prod because every test runs with AI off and nothing checked the whole product after a merge.
- **The rule** (CLAUDE.md): no fix merges without a test that fails before it and passes after.
- **Golden journeys** (`tests/golden-journeys.test.js`, in CORE so every PR runs it): ten journeys through real
  routes on a Harborlight-shaped `org_golden` (the demo seed has hundreds of hard-coded keys, and no suite may log in
  to `org_b72demo`): import, gift, thank, Agent drafts, Ask why, grant + instalment, email template, calendar,
  figure rows, merge. About 2s locally. Found: a grant's received amount ignored paid instalments (fixed).
- **Guards**: fix29-tool-schemas also checks names, required keys, closed strict objects, schema size and every
  prompt builder at its largest input.
- **Nightly real-AI run** (`nightly-ai.yml`): 20 fixed questions against the real API on a seeded throwaway DB, a
  counting proxy capped at $2, an issue on failure. $1.32 a run. Needs `ANTHROPIC_EVAL_KEY` (NEEDS-JONATHAN).
- **Prod AI smoke**: `/agent/preview` and `/ask/preview` (read-only, nothing saved) run once after every deploy
  (`scripts/prod-ai-smoke.js`, also in `npm run status`), about $0.04.
- **Error digest** (`error-digest.yml`): a day of Railway error lines grouped by type and route into
  `docs/errors/`, committed with `[skip ci]`. The 500 handler now logs `[500] METHOD /route`.
- **Found by the nightly run and the prod logs, all fixed with a red-first test:** the Agent's update_contact wrote
  the step's run state "runs" into the donor's postal state (compilePlan's two meanings of `state`; prod repair is
  Jonathan's); the scores job raced the schema migration on boot; Show me's amount-and-year rule dropped every word
  before the year ("in Marblehead"); `/ask` answered a who question with gifts.

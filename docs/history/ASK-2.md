## ASK-2 · Ask anything about your own file (2026-10-04)

- **Measured first.** 60 director questions on Harborlight (`docs/ask-2/score.md`), hand-computed in SQL
  (`docs/ask-2/truth.cjs`). Today's box: 14 right, 10 answered a different question, 36 could not answer.
  After: 58 right, 2 refused by name (donor age, the weather), 0 wrong numbers. Both runs AI off (no
  model key locally); the templates were written against these 60, so a held-out ten was also run (9 answered).
- **The catalog** (`shared/askCatalog.js`): metrics each with their sentence; dimensions; periods; the plan
  is checked against it and against the org's own funds, campaigns and events. `askEngine.js` computes every
  number from one gift set in cents, and the figure source `ask` (plus `ask-change`, `ask-share`) returns the
  same rows, so a number and its rows are one computation. Metrics other screens already show (retention,
  monthly giving, pledges, volunteer hours, campaign progress) are those screens' sources.
- **The model fills a form** (`ask_plan`) whose enums are the catalog; its `restatement` has every number
  stripped; anything else it says is ignored. Why and who questions go to Ask why and Show me unchanged.
- **question_log has org_id now**, so the box suggests an org's own most-asked questions; follow-ups are
  logged as follow-ups and never suggested. `ask_pins` keeps a plan (never numbers) pinned to Home.
- **Found on the way:** "lapsed donors who came back" cannot be the Recaptured tag (4 people, a status), so
  `recaptured_count` is computed from the gifts (180). Two people have logged shifts without the Volunteer
  role, so "active volunteers" is 25 by role, 27 by shifts.

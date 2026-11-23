# LIST-6 · One list engine: the server filters, searches and scores (2026-11-23)

From Jarvis's 22 Nov sweep (staging Harborlight and prod, a2746ab). The People list ran on two engines: the
Directory paged from the server (`buildDonorFilter`), while a second filter bar, the "Search notes & tags" box and
the Giving strength badge ran in the browser over `orgPeople`, the whole-org list loaded only when Team, Re-engage or
the map opened. Reproduced first with real clicks: items 1–3 on staging (read only), items 4 and 6 on a local
production build of main (`NODE_ENV=production`, the built client) because they need a write and the walk account's
sign-in is a secret.

- **1 · One score.** Staging: Alaric Applewhite read 81 on the list and 77 on his profile. The list drew
  `shared.jsx donorScore()` (dollars, days and gift count on a fixed 5..99 scale); the profile and the sort read
  `donor_scores.generosity`. `donorScore()`/`donorScoreParts()` are deleted. List rows and `/donors/summaries` carry
  `generosity_score` and `generosity_parts` (the stored parts); `shared/givingStrength.js` writes the hover from the
  parts with the profile's See why labels. The profile's "Generosity" is "Giving strength"; the census entry says
  what the number is (a percentile among your donors, 1–100, not a fixed scale).
- **2 · One filter state.** Staging: Owner + a chip, then Clear filters, left `?owner=` and the Owner select on.
  `client/src/lib/listFilters.js` reads the filters from the address on every render (`useLocation`), and only from
  there; every setter replaces the address; Clear filters sets all of them to empty. The fifteen `useState`s, the two
  clear functions and `urlList`'s reseed are gone. Under a profile (`/donors/:id`) the list keeps the filters it last
  showed, so closing the profile brings them back.
- **3 · Search means the same everywhere.** Cause, read on staging: `/donors/summaries` never carries `notes`, so the
  browser "Search notes & tags" box could only ever match a tag; whether prod "found" a note depended on a tag
  holding the word. The box is gone; the server gains the `text` rule (`server/donors/textMatch.js`: notes, About,
  tags; `strpos`, so what she types is never a pattern) and the registry field "Notes or tags", whose chip reads
  "Notes or tags: 'gala'". The main box says what it searches ("Search name, email, phone or household"; its label
  adds linked organization). No index: 10,000 people, 20 reads each, the Donors page p50 59 ms → 63 ms with the chip.
- **4 · Saved views update and reapply.** Main: changing a view and saving it made a second "Bo's people"; a view was
  never in the address. `PUT /donors/list-views/:id` updates one of her own views; an edited view shows Update "name"
  and Save as new. The view's id is `?sv=`; arriving with it and no other filter applies the view, once the views have
  loaded. Existing duplicates are hers, so nothing deletes them: `scripts/ops/list6-duplicate-views.js` lists them
  (read only).
- **5 · The whole-org views read the same filter.** Chosen after measuring: `GET /donors/ids` with the list's filter
  object is 4–40 ms at 10,000 (a search 145 ms, the person match it already was), and it removes a whole-org read
  (`/donors/custom-field-values/all`) from every Donors open. Team, Re-engage and Map now draw only the people the
  Directory's filters match (search included), under FLOWS-4's "Filtered: N filters from the Directory · Clear"; their
  own Filters bar (tiers, pattern, gift dates, totals, custom fields, notes) is gone, each of those being a Directory
  chip already.
- **6 · The profile's Donor chip follows the giving rule.** Main: a never-giver marked Donor had `person_types:
  ["donor"]` on `GET /donors/:id` while the Contacts list held them; their role line was blank. `typesOnRead` now
  applies `isDonor` both ways (adds Donor for a giver, takes it off a never-giver), on read only; `GET /people/:id`
  adds `shown_types`, and the role line says "Contact" when no role is left. The stored role, which the + menu
  toggles, is unchanged, so no row needs a repair.

Test: `tests/list2-list-shows.test.js` §9 (7 checks), red on main (34 passed, 7 failed: `?owner=u_list2b` after Clear;
"list 48, profile 63"; the text rule a 400; Update a 404; `?sv=` ignored; `["donor"]`), green on the branch (41/41).

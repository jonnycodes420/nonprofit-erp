# TRUTH-2 · Donor-facing money is never wrong, and every count agrees to the last person

From Muse's Walk A, evening run (5 Nov, 110 pass, 15 fail). What changed, and why each was wrong:

- **Milestone drafts stated the wrong lifetime** ("has now reached $12,500" for $21,000; "$1,050 total" for
  $16,050; "$3,200" for $11,200). Two sources. The boot seed (`server/db/seed.js`) wrote two drafts and a note
  with the amounts typed into the words, so the text stayed put while the person's giving moved on. The
  live builder (`generateMilestoneDraft`, `computeNoteTalkingPoints`, `generateAtRiskDraft`,
  `computeMilestoneCandidates`) read the stored `donors.total_giving`, and so did the draft check
  (`draftCheck.js`), which grounded a stale total as "one of their amounts". Now every figure comes from
  `shared/numbers/draftFigures.js` (LIFETIME, lastGifts, this fiscal year), read when the draft is made, and
  the seed reads the lifetime from the seeded gifts. Pending drafts store their words, so Send checks them
  again (`server/drafts/figureCheck.js`): a giving figure that is not the person's amount today, or a figure
  claiming a total ("now given", "has reached", "lifetime", "in total") that is not their lifetime or this
  year's giving, refuses the send with the figure named. The guard alone let "$3,200" stand as a total
  because one of the person's gifts was $3,200. With AI off, the draft is the template sentence with the
  true lifetime (WHY-1), where before there was no draft at all. Merge fields (`emailCompose.personFields`,
  `sequenceMergeValues`) read the last gift by the one rule, so a refund is never "your last gift".
- **Counts one apart.** Fundraising 363 against the Giving summary 362: `givingBetween` counted anyone with a
  money row in the year, `figureSources.givers` only people with a gift above $0, so a person whose only
  row was a $0 gift counted on one. One rule now, `shared/numbers/money.js` `GIVERS` (a gift above $0, not
  erased). LYBUNT 310/309 and SYBUNT 555/554, and the header's $428,081 against the footer's $425,422: three
  LYBUNT rules. The header (figure source `bunt`) read amount > 0; the report's rows and the group page
  (`buntPredicate`) read any row; the Groups starters (`shared/numbers/starterCounts.js`) read any row too.
  A $0 gift this year took a person off the list and the group and left them in the header with their
  prior-year money. One rule now, `shared/numbers/bunt.js`, read by all four.
- **The 300-row cap.** There is no row cap on the LYBUNT report path (the report returns every row and its
  table sums them). The walk's header-vs-footer gap was the two predicates above; the header and the rows
  now foot by construction, and the truth check holds them.
- **Journey step Nov 7 on the Calendar, Nov 9 on the profile, flipping on reload.** Both read the one stored
  `cultivation_plan_steps.due_date`. The profile shows one of a person's active journeys, chosen by
  `ORDER BY ... priority DESC, created_at DESC`: two journeys started in one moment tie, Postgres returns
  either, and the profile showed the other journey's step. It now shows the journey whose step comes next,
  with a full order (`server/majorGifts/plans.js`), so it names the Calendar's first step on its day.
- **Erased people counted.** Erasure (TRUST-2) keeps the record as "Erased person" so the gifts stay; every
  people count still read only `deleted_at`. `shared/numbers/households.js` `PERSON`, the directory filter,
  `peopleCounts`, the volunteer roster and list, Drift, top donors, the donor count and LYBUNT/SYBUNT now
  leave them out. Their gifts stay in every money total (people-and-records.md).
- **A $0 gift could not be deleted, silently.** The server deletes it; the profile's Delete swallowed any
  refusal (`catch(e){console.error(e)}`), so a gift with an issued receipt (409, "void the receipt first")
  did nothing on screen, and nothing on screen offered the void. The refusal now shows its reason, the
  receipt cell has Void with a note, and a void with no note typed keeps "Voided by <name> on <day>." The
  receipt keeps its number; the org's counter only goes up, so the number is never issued again.
- **TRUTH-1's key** (`tests/keys/truthKey.js`) now holds erased people (counted nowhere, their gifts money),
  the donor count this fiscal year, LYBUNT and SYBUNT; `assertSurfacesAgree` pass `bunt` checks Fundraising,
  the reports' header, rows and money, and the group pages against it.

Left for a next brief: the Donors CSV export's lifetime reads the stored `total_giving`; `meetingEffects`
`restoreSteps` puts a journey step's day back but not its thread's.

## SEARCH-2 · Search finds everything (2026-10-06)

WIRE-1's map left eight ⌘K cells missing. ⌘K now finds gifts (by amount, cheque number, day or donor),
monthly plans, pledges, journeys, meetings, emails (subject and sender), notes and imports, and each result
opens on its own row: the donor profile reads `#gift-`, `#pledge-`, `#plan-` and `#item-` anchors and
`#gifts`, the calendar reads `?day=`, Settings > Imports reads `?import=`. `searchTerms.js` reads "$500",
"Oct 3" and "Rafael gift" before the query is built. Results come three to a group with "See all"
(`/search?kinds=`, fifty of each). The whole search is now ONE SQL statement, each kind a `json_agg`
sub-select: the old route ran fifteen reads side by side, and twenty-three would have queued on a pool of
ten at about 65ms a round trip on prod. Indexes added: `idx_gifts_org_amount`, `idx_gifts_org_check`
(partial), `idx_interactions_org_type_date`. Local p95 on Harborlight: 12ms. Gifts, notes and emails are
hard-deleted; a soft-deleted person takes theirs out of search through the donor join. The coordinator is
still refused the route entirely. Test: `search2-everything` (30 checks, three planted defects went red).

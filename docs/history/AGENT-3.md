## AGENT-3 · The Agent sees everything (2026-10-07)

WIRE-1's map said the Agent could not see grants, memberships, campaigns, giving pages or auctions, so "who has a grant
report due this month" or "draft a renewal to every member expiring in November" planned for the whole organisation and
was cut off as too long. Now the find reads them (grant report due in N days, membership ending in a window, auction
winners, pages waiting for approval, a campaign's givers), and every plan and draft batch shows each person's grants,
memberships, pledges, campaign and page gifts, peer-to-peer pages and auction wins (`agentObjects`). New draft purposes
(membership renewal, funder update from the org's template, pay-your-bid, approval reminder) and grant tasks. A task now
lands on the person's Thread and timeline like a draft. Plans of any type are batched ten people at a time. "Gone quiet"
in every common phrasing reaches the Agent's find and Ask's lapse question. Every AI fallback is counted in
`ai_fallbacks` and fails the nightly run. One list status for a plan (`planListState`). Test `tests/agent3-catalog.test.js`
(67 checks; on main's code 49 of 64 fail). The map's Ask + Agent column: 9 / 13 / 1 to 17 / 5 / 1.

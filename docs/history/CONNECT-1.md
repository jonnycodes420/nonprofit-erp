# CONNECT-1 · Who brought whom: introduced by, guest of

Why: major-gift work runs on who knows whom. Steward linked spouse, partner, household, family,
employer match, owner and works at, but not how a person came in. Allie kept that in her head.

What was built:
- Two directional types in `donor_relationships`, stored newcomer first (`donor_id_a`), the
  connector second, from whichever profile they are made: `introduced_by` and `guest_of` (with a
  nullable `event_id`). One writer for every door: `server/donors/connections.js addConnection`
  (the profile's picker, an event's "Guest of…", the import).
- The connector's line, "Brought in N people · $X given since", from
  `shared/numbers/broughtIn.js` through the figure sources `brought-in-people` and
  `brought-in-gifts`, so the line and its drawer are one computation.
- Donors list filters Introduced by, Guest of (any event or one), Brought people in; the
  sheet import's Introduced by / Guest of columns; merge sets aside a twin link before moving.

What was learned:
- Every reader of `donor_relationships` that pools or groups already whitelists its types
  (lapse.js `UNIT_LINK_TYPES`, households.js, `householdsFromLinks`, currentThrough, buntUnits),
  so a new context type cannot leak into a total. Keep it that way: never read the table for
  money without naming the types.
- A merge's moved row can't be set aside AFTER the move: Undo would put it back pointing at the
  kept person. Set the twin aside before anything moves (`server/dataHealth/mergeConnections.js`).
- `GET /donors/:id/relationships` answers no `householdTotal` for someone with no links at all;
  the household panel's own figure is the one to compare.
- A new import role takes a header away from "Keep as a custom field". "Referred by" in a real
  file held first names ("Odette"); mapped to Introduced by, an unmatched value would only be
  listed, not kept (import4-layers caught it). Only "Introduced by", "Introduced through" and
  "Guest of" map by themselves; anything looser stays a custom field unless she picks the role.
- The direction can't be inferred for two people (unlike owner and works at, where the org end is
  the org), so the picker offers each type from both ends and the server takes `side`.

Left for a next brief (found, not built):
- The older pair-level dedup in Data health's "link as spouse", Insights' family link and the
  sheet import's partner link still treats any existing link as "already linked"; an Introduced
  by link between two people would stop one of those suggestions from linking them as spouses.
- The connector's count and total are over everyone the connector brought in; for a staff
  member limited to her portfolio (ACCESS-2) that may include people she can't open. Not checked.
- `whereSentence` names a Guest of choice by its ids in a group's sentence.

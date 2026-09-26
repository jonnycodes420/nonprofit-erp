# FIX-1 §B — Fundraising, reorganised: notes for the lead

## What changed
- `client/src/lib/fundraisingSections.js` is the one map: `FR_SECTIONS` (four
  sections, each with a `question` and its `parts`), `FR_LEGACY` (every old id →
  `{section, part, label}`), `resolveFr(id)`.
- Fundraising renders four tabs (Overview · Campaigns & pages · Major gifts ·
  Money in), a one-line question under the strip, and, where a section has more
  than one part, a wrapping row of part pills. Each part is the SAME component
  the old sub-tab rendered, with the same props, so no figure moved.
- The sidebar's Pipeline left TABS / MORE_TABS / MORE_NAV. `navigateTo("pipeline")`
  now becomes Fundraising → Major gifts → Pipeline (scope carried). The board is
  the same `Pipeline` component with `embedded` (drops its own page title).
- `TEAM_GATED` still holds `"pipeline"`; Fundraising reads it to put the Team
  padlock on the Pipeline part for Core orgs. Only the Pipeline part carries it:
  the rest of Major gifts (at a glance, proposals, portfolios, plans) was never
  gated and still is not — a padlock on the whole tab would claim otherwise.
- `/dashboard?fr=<id>` is a new GET deep link (any old id, any section id;
  `pipeline` goes through `navigateTo("pipeline")` like the old sidebar did).
- The Overview ends with "Everything in Fundraising": every part, under its
  question, one click away. It is how somebody who learned the old tabs finds
  them, and it is also why build99-proposals / build98-events browser legs
  (which click an exact "Proposals" / "Events" button after opening
  Fundraising) still pass without an edit.
- There was no saved localStorage tab state to migrate: the App never persisted
  the active tab (only `steward_nav_more`, the More disclosure).

## Placement that wants Jonathan's confirmation
- **Members → Campaigns & pages.** A membership level is a way to give, sold on
  the same public pages (BUILD-101 online joins), and a membership payment is a
  gift. It answers "where can people give?", not "what came in". It is not a
  major-gift activity.
- **Funds → Money in.** The old Funds sub-tab is a read-only list of fund
  balances with a link to Finance → Funds. A fund is where money that came in
  sits, so it answers "what has come in". If Finance is where he wants it
  entirely, this part can be deleted and `FR_LEGACY.funds` pointed at Finance.

## At merge
- `fix1-fundraising` is added to CORE in tests/run-all.sh (last line).
- tabRegistry.js: B removes only the two `pipeline` entries and the MORE_NAV id.
  §12 (the PRIMARY_NAV rewrite) belongs to another workstream — expect a
  neighbouring-lines conflict in that file, nothing semantic.
- `SectionTabs` (shared.jsx) gained optional `dataKey` / `stripProps`
  and role/aria-selected; no existing caller changes.

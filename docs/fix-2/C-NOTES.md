# FIX-2 C — less green, more cream: notes for the lead

Branch `fix-2-c`, cut from `fix-2` at `58c61bc`. Scope: Part 0 finding 5 and Part C
minus the Agent room (workstream D owns `Agent.jsx`).

## What the branch does

1. **Every colour is a token.** A codemod over `client/src` (AST, `@babel/parser`) turned
   1,296 inline hex literals into token reads. The authenticated app reads `T` (the CSS
   inside `GlobalStyles` reads `${T.x}`); each public / white-label surface names its colours
   once in its own palette (`publicTheme`'s `T`, the landing's `C`, `Invitation`'s `C`,
   `GivingDashboard`'s `G`, `PortalEditor`'s `E`, the ops console's `A`, the login and invite
   pages' local `T`, and a `PAL` on the portal, forgot/reset, pricing, privacy, terms, `main.jsx`,
   `PortalWidgets`, `PortalBanner`, `ShareBlocks`). Off-palette values in the app snapped to the
   token they imitated (listed in the commit `d7a18f8`); Branding's four preset accents are
   customer data and are now `T.accentRust/Slate/Plum/Ochre`.
2. **One active treatment.** `activeMark(on, edge)` in `shared.jsx`: `T.bg2` ground, ink text,
   700, a 3px emerald inset rule on the leading edge. Read by the rail (`sideBtn`, which also
   sets `aria-current="page"`), `SectionTabs`, Fundraising's part tabs, the donor profile's tabs,
   and every segmented control / chip set outside the A/B/D files. The mobile bottom bar and
   More drawer are white now; `.mobile-bottom-tab.active` / `.mobile-more-row.active` are the
   same treatment in CSS (top / left rule). The gold `.section-tab-on` wash is gone.
3. **Cream grounds.** Fundraising's goal hero, Home's goal banner (+ its chips), the donor
   profile's right-hand panel and the grant detail's right-hand panel were ink / pine rooms;
   they are white with a brass rule. `AIPanel` and the prospect-research card are brass on
   white; `AIBtn` is brass (brass = what the agent is doing). The avatar chip in the top bar
   is cream.
4. **Emerald is the one action.** The Thread's and the profile's Done, Settings' secondary
   saves, Make a key, + Add Metric, + Add prospects, + Log, Calculate score, View giving in
   Reports are ink or ink-outline; emerald eyebrows, table-header bands, figures, stage chips,
   initials, role pills, account-type pills and stat-tile edges are ink / cream; toggle
   switches are ink when on.
5. **Overdue is brass** (your note from E): `STAGES.lapsed` → `T.gold600`, `SC.lapsed` →
   `gold600`, `SC.high` → `gold700`, Fundraising "Behind pace", the profile's overdue open step
   text / card border, the task-row badge and border, and the pledge "d overdue" line.
6. **A crash found by the walk:** Settings › Your words rendered `<Card>` and `<SecHead>`,
   neither defined in Settings, so the tab threw and the error boundary took Settings with it
   (on the branch point too). It now draws the same card + `SectionLabel` as its neighbours.

## The guards

- `tests/fix2-c-hex.test.js` (pure). Zero hex (`#rgb/#rgba/#rrggbb/#rrggbbaa`) in any string,
  template or JSX text in `client/src` outside `shared.jsx`'s `export const T`; on the PUBLIC
  list, a hex is legal only as the whole value of a `const X =` or of a property of a
  top-level palette object.
- `tests/fix2-c-cream.test.js` (§1 pure, §2 browser; SKIPs without Playwright/dist). Fixture
  org `org_fx2c_<run>` (Team plan, five donors with gifts through the gift route, a goal, a
  campaign). Visits Home, Donors, Fundraising × 4 sections, Volunteers, Agent, Reports, Finance,
  Settings, Dashboards and a donor's record at 1440 and 390, and asserts per screen: (2a) the
  content root's effective ground is not dark and no child ≥ min(280px, 60% width) × 120px is
  ink / a dark green (luminance < 0.2, colour or gradient); (2b) the active rail item (1440) /
  mobile nav tab (390) and every `[role=tab][aria-selected=true]`, `[aria-current]`,
  `[aria-pressed=true]` in the content wear the light treatment (ground luminance ≥ 0.6, ink
  text, weight ≥ 700, a 3px emerald rule on some edge); no option row draws its selection as
  a solid dark block (heuristic: one dark filled sibling, the rest of the same tag+shape all
  unfilled or all dressed alike); (2c) at most one filled emerald control in the content
  (colour swatches marked `data-swatch` excluded).

## What the guards expect of A, B and D at merge (EMPTY these two lists)

- `tests/fix2-c-hex.test.js` `OWNED_ELSEWHERE`: `Dashboards.jsx` ≤ 2 hex, `Reports.jsx` ≤ 5,
  `ReportBuilder.jsx` 0, `Agent.jsx` 0 — each must reach 0 (use `T.*`; `"#fff"` → `T.white`,
  `#a97f22` → `T.gold600`). Any new Figure / drill-panel component is already held at zero.
- `tests/fix2-c-cream.test.js` `PENDING`:
  - `agent` (D): content ground not dark (D may mark its ink margin `data-agent-margin`, the one
    element allowed an ink ground), no large dark child, the selected Plans/Ask/… tab is
    `activeMark` (today it is a brass block), ≤ 1 emerald fill.
  - `dashboards` (A): the left list's selected dashboard is a solid emerald block — use
    `activeMark(on, "left")` and `aria-current`.
  - `reports` (B): the period row draws "This FY" as a solid emerald pill — use
    `activeMark(on, "bottom")` + `aria-pressed`.
  Everything else on those three screens is already counted (and green) here.
- `SectionTabs` changed in `shared.jsx`, so Reports' tab row already wears the new treatment.

## Census / assertion changes

- `tests/palette-census.test.js` `HEX_CEILING` 1149 → 273 (the token definitions themselves;
  Part C "zero hex literals outside tokens"). `RGB_CEILING` 232 → 169 (the dark panels'
  cream-at-opacity text became `T.ink3` when the panels became white; the census rule "every
  other count is a ceiling that may only fall").
- `tests/clickability.test.js`: two assertions pinned the goal card's and GoalStat's
  `interactive(…, {dark: true})` call ("(dark variant)"). Part C makes those cards white
  ("the ground of every page is cream or white"), so they take the light `interactive()`;
  the pinned call text and the two labels now say "(light card)". Nothing else changed.

## Deliberately left

- The Thread row's 3px emerald left rule (`t.overdue?T.gold500:T.greenDk`) — a hairline, not a
  block, and palette-census pins that exact expression for "overdue is brass".
- Inline text links in emerald ("Import →", donor names in the ledger) — a link is an action
  and the brand-glyph convention makes links forest green; they are not fills.
- Mist (`T.green100`) washes on a few Settings notices and the Directory's bulk-selection ink
  bar (a floating toolbar, 50px tall); toasts on ink; the full-screen first-run welcome on ink.
- Stage colours other than Lapsed (`STAGES` greens) — the pipeline's category ramp; the
  directory now draws stages as cream chips, the kanban still uses the ramp.
- The donor profile header's stage pill — workstream E owns `stageTone()` there.
- Deprecated, unrouted surfaces (Events, Board, Volunteers, Programs, AnnualFund) were only
  tokenised (library colours → palette), not redesigned.

## Proof the guards can fail (planted, run, reverted)

- hex: `const PLANT_HEX = "#123456"` in Tasks.jsx and an inline `{ color: "#0f1a12" }` in
  Pricing.jsx → "zero hex … outside the token definitions" FAIL (count 2, both named); one more
  hex in Reports.jsx → its ceiling FAIL (6 > 5).
- cream §1: `activeMark` returning an emerald ground → "its ground is cream's shade or white"
  and "text is ink" FAIL.
- cream §2 (rebuilt dist): same plant → "the active rail item is the light treatment" FAIL on
  every 1440 screen and every selected tab/segment FAIL; Fundraising's hero back to the pine
  gradient → §2a fundraising-overview FAIL at both widths; a 200px ink band on Finance → §2a
  finance FAIL; two emerald buttons on Volunteers → §2c FAIL. The root-ground check and the
  solid-block heuristic are shown failing live by the PENDING agent / dashboards / reports lines.

## Suites

84 CORE suites that read client source (every suite naming client/src, APP_URL or chromium,
plus palette-census) ran on this stack: 82 passed; `clickability` failed on the two pins above
(fixed, 56/56); `build88c-composer` failed once on "the FIRST RECIPIENT's own first name"
(the preview named Bob, not Margaret) and passed 53/53 on two reruns — the segment's first
row comes from a query with no ORDER BY, so it is an ordering flake, not a colour change.
SKIP: build89s-surfaces §7 only ("no fixture org on this stack (run build89s-sources first)"),
an ordering dependency on a suite outside the selection.

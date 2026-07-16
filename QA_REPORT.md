# Steward Pre-Launch QA Sweep

**Date:** 2026-07-10
**Target:** https://stewardapp.dev (production)
**Account:** admin@creoarts.org (CREO Arts demo org — currently in `read_only` access state, trial ended)
**Viewports tested:** Desktop 1440×900, Mobile 390×844
**Method:** Automated Playwright sweep (screenshots + console/network capture) + manual visual review of all 50+ screenshots + targeted code-level verification of every suspected bug before reporting it. Discovery only — nothing in the app was fixed.
**Tooling:** Playwright + Chromium installed standalone in `~/steward-qa` (a separate npm project outside this repo) — **did not touch this repo's `package.json`/`package-lock.json`**. The reusable sweep script lives at `~/steward-qa/sweep.mjs`; raw findings/screenshots are in `~/steward-qa/findings.json` and `~/steward-qa/screenshots/`.

No console errors and no failed (≥400) network requests were observed anywhere in the sweep — verified with a separate diagnostic script first to confirm the capture logic actually works (it does; it caught real `[SW] registered` logs and would have caught any real error).

---

## Summary

| # | Issue | Severity | Viewports |
|---|---|---|---|
| 1 | Signup page is broken/unusable on mobile — form overflows off-screen | **Blocking** | Mobile |
| 2 | Read-only (trial-expired) write access isn't enforced for Volunteers, Tasks, Events, Campaigns, Custom Fields, Board Members — server has no gate, and most "create" buttons aren't disabled either | **Blocking** | Desktop + Mobile |
| 3 | Finance "Overview" shows real fund/account balances that contradict every other Finance subtab, which show $0 for the same org | **Blocking** | Desktop + Mobile |
| 4 | Donor/Grant profile view renders *alongside* the list instead of replacing it — list bleeds through below | Visual-cosmetic | Desktop + Mobile |
| 5 | Grant Kanban cards (default Grants view) have no click handler — only List view opens a grant's profile | Visual-cosmetic | Desktop + Mobile |
| 6 | Settings billing badge shows "Trialing" for an org whose trial has ended | Visual-cosmetic | Desktop |
| 7 | Landing page ROI calculator shows an underwhelming "1x" return | Minor (content) | Desktop |
| 8 | Gmail shows "Connection lost — please reconnect" for this org | Minor (informational, not new) | Desktop |

---

## 1. Signup page unusable on mobile — BLOCKING

**Page:** `/signup`, mobile viewport (390×844)
**Screenshot:** `mobile__public_signup.png`

The signup card is cut off the right edge of the screen — headings ("Crea...", "Your...", "acco..."), field labels ("ORGANIZATI..."), inputs, and the submit button ("Create your accou...") are all clipped mid-word. A new user cannot practically complete signup on a phone.

**Root cause (confirmed in `client/src/pages/SignupPage.jsx`):**
- Line 74: outer container is `display:"flex"` with **no `flexWrap` and no `@media` query anywhere in the file** (grepped — zero matches).
- Line 80: the dark left panel is `width:"40%", minWidth:280, flexShrink:0` — this alone forces at least 280px regardless of viewport.
- Line 115: the right panel has fixed `padding:"40px 40px 40px 0"`, and its inner card (line 116) has its own `padding:"36px 40px"`.

At 390px: `390 − 280 (left panel) − 40 (right padding) − 80 (card's own left+right padding) ≈ −10px` of usable space for the card's content — a mathematically negative width, guaranteeing overflow/clipping on any viewport under roughly 700–750px.

By contrast, `/login` (single-column, no hardcoded min-width) renders correctly on the same viewport (`mobile__public_login.png`) — this is specific to Signup's two-column layout.

**Recommendation:** stack the two panels vertically below a breakpoint (e.g. `@media (max-width: 768px)`), matching the responsive pattern already used elsewhere in the app (`GlobalStyles()` in `shared.jsx`).

---

## 2. Read-only access control has real gaps — BLOCKING

Instruction was to flag missing disabled states, not correct disabling. This sweep found more than a cosmetic gap.

**Client-side:** an automated audit clicked/inspected every button whose text starts with Add/New/Create/Log across every tab, at both viewports (identical results both times — not a viewport-specific glitch):

Correctly disabled (with the `"Reactivate your subscription to make changes."` tooltip):
- Add Donor, Log Gift, New Grant (Dashboard Quick Actions)
- "+ Add" (Donors tab, main add-donor button)

**Not disabled** (fully clickable while the account is read-only):
- Add Volunteer, New Task (Dashboard Quick Actions)
- "+ Add Grant" (Grants tab — inconsistent with the Dashboard's own "New Grant" shortcut, which *is* disabled)
- "+ New Campaign" (Communications)
- "+ New Event" / "Create Your First Event" (Events)
- "+ Add" (Tasks)
- "+ Add Field" (Settings → Custom Fields)
- "+ Add Volunteer" (Volunteers tab)
- "+ Add Board Member" (Board tab)

**Server-side (`server.js`) — this is the more serious part.** `checkWriteAccess` (the middleware that returns 402 for read-only orgs) is applied to exactly these routes:
```
POST /donors, POST /donors/import-combined, PUT /donors/:id,
POST /donors/:id/gifts, POST /gifts/import-history,
POST /grants, PUT /grants/:id
```
It is **not** applied to `POST /volunteers`, `POST /tasks`, `POST /events`, `POST /campaigns`, `POST /board`, or `POST /custom-fields`. Combined with the missing client-side disabled states above, this means a churned/trial-expired org can likely still create real Volunteers, Tasks, Events, Campaigns, Board Members, and Custom Fields through the UI — not just see a button that isn't grayed out, but actually write data the read-only tier is supposed to block. (I did not attempt to actually create a record to prove this end-to-end, since that would mutate the shared demo org's data without a green light — but the missing middleware is unambiguous from the code, and the "+ Add Grant" case specifically shows a client button that isn't disabled even though the server route it hits *is* gated, which would produce a confusing 402 dead-end for that flow.)

**Recommendation:** apply `checkWriteAccess` to the volunteer/task/event/campaign/board/custom-field creation (and likely update/delete) routes, and reconcile every create-button's `disabled={isReadOnly}` state to match.

---

## 3. Finance module shows contradictory numbers across its own subtabs — BLOCKING

**Screenshots:** `desktop__finance_overview.png` vs. `desktop__finance_accounts.png` / `desktop__finance_funds.png` / `desktop__finance_budgets.png` / `desktop__finance_reports.png` / `desktop__finance_transactions.png` (same pattern confirmed on mobile).

**Overview** subtab shows real, non-zero data for the *same org, same session*:
- Fund Balances: General Operating **$42k**, NEA Arts Education **$35k**, NY Community Trust — Youth **$25k**, Gala Reserve **$8.2k**
- A populated "Monthly Breakdown (Legacy Data)" chart with real Jan–May dollar figures

Every other subtab shows **$0 / empty** for the identical funds/accounts/period:
- **Funds**: all four funds listed above show `$0 income · $0 expenses · Balance: $0`
- **Accounts**: all 26 chart-of-accounts rows show `$0`
- **Budgets**: every line item and both totals are `$0`
- **Reports → Income Statement**: Total Revenue/Expenses/Net Surplus all `$0`
- **Transactions**: "No transactions" empty state

This isn't a fiscal-year-rollover artifact (I checked — the FY Revenue/Expenses/Net Surplus summary cards showing `$0` for the brand-new FY, Jul 2026–Jun 2027, that started 10 days ago *is* expected and correctly labeled "(LEGACY DATA)" for the chart). What's not expected is that a specific fund's balance is a completely different, non-zero number on one tab and exactly zero on every other tab in the same module. This strongly suggests Overview reads fund/financial data from a separate legacy table (the `financials`/`funds` fields the `/financials` endpoint and `adaptData()` in `api.js` expose) while Funds/Accounts/Budgets/Transactions read from the newer `fin_funds`/`fin_accounts`/`fin_transactions`/`fin_budgets` tables, which are simply empty for this org — two data models that were never reconciled.

For a finance product handling restricted nonprofit funds, showing a customer one number for "NEA Arts Education: $35k restricted" on one screen and "$0" on the next is a serious trust/accuracy problem, not just a cosmetic one.

---

## 4. Donor/Grant profile renders alongside the list instead of replacing it — visual-cosmetic

**Screenshots:** `desktop__donor_profile.png`, `desktop__grant_profile_v3.png` (both show the full donor/grant list bleeding through below the profile panel)

Confirmed in `client/src/components/Donors.jsx` (line ~3841):
```jsx
{selected&&<ErrorBoundary key={selected.id}><DonorProfile donor={selected} onClose={...} .../></ErrorBoundary>}
{/* toolbar, filters, and the full donor list render unconditionally right after, not gated behind !selected */}
```
`DonorProfile` (and the equivalent `GrantProfile`) has its own "← Back" button, implying it's meant to be a full replacement view — but it's inserted into the same flex column as the directory list rather than the list being hidden while it's open. On any viewport where the page is tall enough to scroll, scrolling down while a profile is open reveals the entire underlying donor/grant table again below it.

---

## 5. Grant Kanban cards aren't clickable — the default Grants view has no way to open a profile

**Screenshots:** `desktop__tab_grants.png` (Kanban, default) vs `desktop__grants_list_view.png` (List) vs `desktop__grant_profile_v3.png`

Clicking directly on a grant's funder name in the default Kanban view does nothing — confirmed live (no state change, no error). Confirmed in code, `GrantKanban` in `client/src/components/Grants.jsx` (~line 344): each card has `draggable`, `onDragStart`, `onDragEnd`, and `cursor:"grab"` — no `onClick` at all. The `onClick={()=>setSelected(g)}` that opens `GrantProfile` only exists in the List view's row rendering. Switching to List and clicking a row does correctly open the profile.

Since Kanban is the default view when opening the Grants tab, most users landing there have no way to discover a grant's AI strategy/LOI-drafting/notes/activity timeline (all only reachable from the profile) unless they happen to switch to List first.

---

## 6. Settings billing badge shows "Trialing" for an expired trial

**Screenshot:** `desktop__tab_settings.png` — the same page shows the red banner *"Your free trial has ended"* directly above a `Trial` / **Trialing** badge in the Billing card.

Confirmed in `client/src/components/Settings.jsx:579`:
```jsx
{billing.subscriptionStatus==="active"?"Active":billing.subscriptionStatus==="past_due"?"Past Due":billing.subscriptionStatus==="cancelled"?"Cancelled":"Trialing"}
```
There's no branch for `trial_expired`, so it falls through to the `"Trialing"` default. It also only checks the legacy misspelling `cancelled` (2 L's) rather than `canceled` (1 L, the current spelling used elsewhere per this repo's own conventions) — so a `canceled` org would show the same wrong label.

---

## Minor / informational

- **Landing page ROI calculator** (`desktop__public_.png`, ~y:950-1450) shows "**1x**" as the headline return figure with the seeded defaults (50 donors, $500 avg gift → $2,900 recovered vs. $2,988/year cost). A borderline/break-even "1x" is a weak number for a calculator meant to sell the product — worth a copy/default-input review before launch. Not a technical bug.
- **Gmail integration**, Settings page: shows *"Connection lost — please reconnect."* with a working "Reconnect Gmail →" button. This is expected — it's the CREO Arts org's pre-existing disconnected Gmail connection (the `invalid_grant`/revoked-refresh-token issue fixed server-side earlier this week). The fix correctly surfaces this state; it just hasn't been manually reconnected since. Confirms that earlier fix's UI messaging is working correctly in production.

---

## Confirmed clean

- **Zero console errors, zero failed (≥400) network requests** anywhere in the sweep: public pages, login, signup, every AppShell tab, all 6+ Finance subtabs, donor/grant profiles, invite modal, and the public `/give` page — both viewports.
- No broken internal links found on the Landing page.
- `/give/creo-arts-creo` (public donation page) renders correctly and completely on both desktop and mobile — no layout issues.
- `/login` renders cleanly on both viewports.
- The `read_only` banner (Export data / Reactivate) and the Reactivate → plan-picker flow (both shipped earlier this week) render and are present correctly on every authenticated page/tab, both viewports.
- Today, Dashboard, Donors (list), Communications, Events (correct intentional empty state, not broken), Finance subtabs (data itself aside from the Overview/rest split above), Analytics, Tasks, Settings, Volunteers, and Board all render with real, realistic seeded demo data and no visible layout breakage, on both viewports.
- Mobile bottom-nav / "More" drawer navigation works correctly for every tab.

**Methodology note:** several full-page *mobile* screenshots (e.g. `mobile__tab_dashboard.png`, `mobile__finance_overview.png`) show the fixed bottom nav bar appearing to "float" mid-page, overlapping content. This is a known Playwright/Chromium artifact of full-page screenshots with `position:fixed` elements — the viewport is temporarily resized to the full document height for capture, so the fixed bar renders at its original pixel offset rather than the true bottom of the taller image. It is **not** a real bug; an actual phone user scrolling the page always sees the nav bar correctly pinned to the bottom of their viewport. Flagged here only so it isn't mistaken for a real defect.

---

## Re-running this sweep

```bash
cd ~/steward-qa
node sweep.mjs
```
Screenshots land in `~/steward-qa/screenshots/`, raw findings in `~/steward-qa/findings.json`. Playwright + Chromium are installed standalone in `~/steward-qa/node_modules` (separate `package.json` there) — this repo's dependencies were not touched.

# DEVBOARD-3 · The admin view leads to Ops and Map, and one page shows how all of Steward works

Jonathan lands on /admin after sign-in, and nothing there led to /ops or the Map. He also wanted
one place that shows how a customer gets onboarded, how a gift moves through Steward, and where
each real customer is.

## What was decided
- **/admin's nav is its own component** (`client/src/pages/ops/AdminOpsNav.jsx`), a dark strip at
  the top of the main column with Ops, Map and Journey. AdminDashboard.jsx is over 1,500 lines, so
  it grew by two lines only.
- **/ops has four tabs**: Machine, Map, Journey (`?tab=journey`), How it works (`?tab=flow`), and a
  "Back to admin" link in the tab bar on every tab.
- **The ten onboarding steps and how each is detected** live in `server/admin/opsJourney.js`
  (`STEPS`). Detection reads counts and timestamps only, one query per fact across every customer
  org, never a donor's name, address or amount:
  1. Signed up: `orgs.created_at`.
  2. Org set up: `orgs.timezone_confirmed_at`, else `onboarded_at`.
  3. Team invited: the first `invites` row, or the second non-super-admin user, whichever is first.
  4. First import: the first `imports` row not reversed (`committed_at`).
  5. Duplicates reviewed: the first `donor_merges` row not undone, or the first pair in
     `data_health_dismissals`.
  6. First gift recorded: the first gift with no `import_id` and not sample data.
  7. Receipts set: EIN and signature name both filled in; dated by the later of the first
     `fin_audit_log` rows on the org that changed `ein` and `receipt_signature_name` (undated if
     they were set before the audit trail).
  8. Giving page live: the first active `giving_pages` row.
  9. Daily email on: a person on the org has `notify_thread_nudge` not false; dated by the first
     morning email in `digest_sends` (thread_nudge, daily_tasks or meeting_brief).
  10. First week active: 5 distinct days within 7 consecutive days (the org's own days) on which a
      person who is not a super-admin started a session, was last active in one, or made a change.
- **The current step** is the first one not reached; the customer has sat on it since the latest
  step they did reach (or sign-up). More than 7 days is stuck, drawn brass (overdue is brass).
- **Which orgs are customers** is DEVBOARD-1's rule (`orgKind.inferKind`, not archived), now one
  function, `opsSources.customerOrgs`, read by the Machine's Customers section and the Journey.
- **How a gift flows** is drawn from `ops/flow.json`: stages, boxes, edges, and for each box its
  module paths, its queue jobs and its Map area. `tests/devboard3-journey.test.js` fails when a
  named module stops existing; the page also marks a missing one. Live health per box is the
  Machine's worker and queue reports plus each job's last finished run from `job_queue`.
- **No chart library.** The path is CSS; the diagram is hand-laid SVG (left to right above 860 px,
  top to bottom below). Motion is CSS only and off under `prefers-reduced-motion`.
- **The demo's giving page** comes from `ops/map.json`'s demo block, not from code.

## The test
`tests/devboard3-journey.test.js` (the one new suite): the door (404 for signed out, staff and an
org admin on both routes), /admin's three links, five fixture customers at their steps (a 7-day sit
is not stuck, 19 days is), no donor name or amount in the answer or the rendered page, every
flow.json module exists, and each diagram box opens its details. Red on main; planted defects (a
donor's name on a customer row, a deleted module in flow.json) each went red.

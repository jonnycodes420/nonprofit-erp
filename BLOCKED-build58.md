# BLOCKED — BUILD-58 items needing Jonathan (or counsel)

## 1. Transactional-vs-marketing mail line — attorney's eye (when the legal work happens)

BUILD-58 W-4 split every donor-facing message kind into `transactional` vs
`marketing` in ONE table — `DONOR_MAIL_POLICY` in server.js. Transactional
kinds (failed-card dunning, recovery thank-you, gift receipts, year-end
statements, recurring-gift changes/proposals) deliberately do NOT honor the
marketing suppression list; marketing kinds (campaigns, sequences, workflow
recipes, milestone drafts, pledge reminders, the founder onboarding drip) do,
plus the new `do_not_contact` donor flag. `deceased` blocks everything.

This is the product's best-faith classification (CAN-SPAM's
transactional/relationship-message concept), **not a legal conclusion**. When
the legal pass happens (see BLOCKED-legal-network.md), have counsel review:

- the table itself (each kind's bucket — pledge reminders and milestone
  thank-yous are the debatable ones);
- that dunning/receipt/year-end mail still CARRIES the unsubscribe footer
  (donor courtesy) while no longer being blocked by it — confirm that
  presentation is acceptable;
- whether any state-law analog (e.g. CA) draws the line differently.

Ten minutes of attorney time against one file section:
`server.js` → search `DONOR_MAIL_POLICY`.

## 2. Prod throwaway orgs to purge (grew by one)

The W-3 prod read (read-only, 2026-08-16) confirmed the only chartless prod
orgs are five throwaway test orgs — no real org damaged, so no repair was
performed. While in there: **org_a53ad331 "Go-Live Test Shelter (DELETE ME)"**
(portal plan, application still `pending`) joins org_78dea45b + "Steward Live
Test Collective" + `TEST`/`Jon`/`ou` trial stubs on the purge-when-convenient
list. Use `DELETE /admin/orgs/:id` from the admin dashboard (the FK-safe
cascade), not manual table deletes.

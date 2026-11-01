## GRANTS-1 · Grants as its own system (2026-10-06)

Jonathan wanted Grants to stand on its own, good enough for an org that uses nothing else in Steward.

- Eight stages (Prospecting, LOI, Invited, Submitted, Awarded, Declined, Reporting, Closed) on a board
  with drag and Undo, and a list with the same filters. `invited` and `reporting` were added to the
  canonical list; every SQL site that meant "awarded money" now reads awarded, reporting and closed.
- Funders: a page each with program officers (people rows, linked), interests, typical award size,
  cycle and due months, every ask and award with the win rate, notes and the public filing.
- Each grant: deadlines (FIX-28), a checklist of tasks, the award in instalments each linked to the gift
  that paid it, reports with a kept history, documents, and what went to the funder and when.
- Library of reusable pieces with versions; drafting a section from it through the AI switch, refusing
  invented numbers and outcome claims.
- Email in: the mailbox sync and the BCC path both route mail with a funder contact onto the funder's
  open grant, attachments stored as documents. Gmail mail URLs got a test seam (`GMAIL_API_BASE`).
- Renewals planned on close from the funder's cycle; a Reports tab of grant figures that open their rows.
- Test: `tests/grants1-system.test.js` (§1 instalments foot to the cent, §2 email), proven red both ways.

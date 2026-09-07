# BLOCKED / decisions — BUILD-83

## Finance: stays in the nav, or behind a flag? (JONATHAN'S CALL — recorded, not taken)
Part 6's decision. Cowork recommends the flag: Steward is a CRM, not an ERP (Sept 2
positioning), the books live in QuickBooks, and a half-built ledger is the one screen
where an ED's accountant can prove the product wrong in a minute. Keep the tables, hide
the tab, revisit when a customer asks. This build implements the two CHANGES (import
never posts to the ledger; the all-time label is honest by construction once it doesn't)
but does NOT hide the tab — nav visibility is Jonathan's decision. To take Cowork's
recommendation: comment `finance` out of TABS/MORE_TABS in App.jsx (the documented
reversible-hide pattern from the 2026-07-12 pivot).

## donor-truth.json / gen-messy-v3.py still not on disk
The Sept-7 key names both; only the .md arrived (saved verbatim to
claude/messy-25k-v3-fixture-key.md + tests/fixtures/build82/). The drift-level
verification ("the drift list near the planted set less exclusions" — 400 seasonal
drifting, 600 quarterly at 2x, etc.) needs donor-truth.json's name lists to assert by
identity; until it lands, BUILD-83 asserts the drift list's COUNT and the at-risk
definition, not per-name membership.

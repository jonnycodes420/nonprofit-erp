# IMPORT-10 · A lot named "Total Wine" is a gift, not a total row (12 Nov 2026)

**What happened.** On 11 Nov a customer's 251-row silent-auction winners file previewed 249 rows. Two
winners with a full name, email and address had lot names holding "Total" (a supplement brand "Total …",
a class at "Total Wine & More"). The reader's `anyTotalWord` treated any non-money cell matching
`\b(total|sum…)\b` as a total line, so both were set aside as subtotal rows ($280 paid, $1,010 of value),
said only in a "rows above it add up to" warning. Worse, each false subtotal reset the running
since-subtotal sum, so the real subtotal and total then failed to foot too.

**What changed.** The rule moved out of `shared/sheetRead.js` into `shared/totalRows.js`:
a total word counts only in a label's place (a name column or the row's first non-blank cell, a short
cell: at most four words, or "Total for …"); a row with a person on it (another name, or an email) is
never a total; a total-looking row that foots is a checked total; one that doesn't foot is listed under
"Not read, check these" with Include (`answers.includeRows`) and counted in the headline
("46 rows: 45 read, 1 needs a look"). A nameless row with no label that foots is still a total.

**Why this way.** Over every import fixture in the repo (92 files) the only reading that moved was the new
fixture's; the one existing total that doesn't foot (`lost-and-found-messy.csv`, a TOTAL of $123,456)
now asks instead of disappearing. Guard: `tests/import10-total-rows.test.js`.

**Existing rows.** Nothing in the database is wrong: the dropped rows were never written, so there is
nothing to apply. `scripts/ops/import10-lost-total-rows.js` (read only) lists past sheet imports whose
stored total rows were really people (an email on the row) or do not read as a total label, by org,
import, file, line and amount, so each org can bring in just those lines.

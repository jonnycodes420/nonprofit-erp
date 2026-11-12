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

## Items 5 to 8 (same customer import, 12 Nov, added to the brief mid-build)

- **5 · One event however it is typed.** The importer matched an event only on `LOWER(name)`, so
  "Night of The Stars" beside "NIght of the Stars 2026" made a second event. `shared/eventMatch.js`
  holds the rule (same once case, punctuation and spacing are set aside; close once a year is set aside
  or a letter or two apart); `server/imports/eventAsk.js` links the same event, asks "Did you mean …?"
  (a required question) for a close one, and the preview carries the org's events so the Event box
  suggests them as she types, newest first. Picking one carries its date, so it is never asked again.
- **6 · Done, and the same file twice.** "Done reopened the preview" was **not reproduced**: Done closed
  the importer from the Donors menu, a file dropped on Donors and a file dropped on Settings, Imports.
  What did reproduce: the same file opened again was importable with one click. Now a file the org
  imported in the last 30 days (by its cells, `summary_json.fileKey`, or for older imports its name) is a
  required question, "You imported this file on Nov 12 (251 gifts). Import again anyway?", which the
  commit enforces whichever screen opened it (`server/imports/importedBefore.js`). The Import button stays
  disabled under the question and keeps saying what would be imported (fix55 pins that design).
- **7 · Imported purchases are sold items.** The import placed paid items but no bidder and no bid, and
  Won, Items sold and Bidders read bids. `recordWinners` (server/events/auctionImport.js) records the
  gift's donor as the bidder and a winning bid of what was paid on any item with no bid yet, tagged with
  the run (`import_id`, additive) so Undo removes them. A winner with no email gets a bidder address
  under `import.invalid`, which can never receive mail; nothing is sent to an imported, paid winner.
- **8 · No gift, not a Donor.** The Directory counts the stored role, and two import paths
  (`server/imports/combined.js`, `server/imports/routes.js`) stored "donor" on every row. The rule now
  lives in `shared/numbers/donorType.js`: the stored donor role means the person has given
  (donorLabel.js HAS_GIVEN). A gift still adds it (recordGifts.js); imports take it off the people they
  made who have not given. The Directory's predicate is unchanged, so lists and money totals keep their
  speed. Not changed: the column default (`'["donor"]'`) and a person added by hand as a donor.

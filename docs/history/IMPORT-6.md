# IMPORT-6 · Every row is accounted for, and a real customer's first import goes right

**Why (1 Nov).** A beta org's first import was a people list of 1,697 rows (name, street, city, state,
ZIP). The preview said "1,380 on the list"; the 317 missing were exactly the rows with only a name. Its
`Mailing Zip` column was kept as a custom field. After the import the Donors page said "0 donors · No
donors found · Try adjusting your filters", because the Directory showed donors only and every imported
person was a contact. The org's trial had also ended, so the account was read-only while the import
dialog still opened. Data health then offered to split "Anthony C Thomas" and "Erin Swanson Russell"
into couples.

**Why the rows went.** `understand` (shared/sheetRead.js) read any row with exactly one filled cell as a
section label ("October 2026"), pushed it to `notes` with `label: true`, and never counted it; the
preview hides label notes. A name-only row has one filled cell. A one-column file (`Full Name` alone)
failed earlier: `headerScore` wants two header cells and the row under it two filled cells, so no table
was found.

**What changed.**
- A lone cell in a name column of a list of people is a person unless it reads as chrome
  (`SECTION_LABEL_RE`: a digit, a trailing colon, a letter divider, a bare month, a group heading, a
  footer word) or a note (`NOTE_LINE`: a colon or six words). A one-column list, and a header naming a
  person's column over rows of one name, are tables.
- `understand` returns `rowLedger`: every non-blank row under a header is written (a person, a gift or
  pledge, merged into a person, a note on one) or set aside, once; `missing` is the rest and must be
  empty. The preview's set-aside list reads it, so labels, totals and repeated headers show with their
  line ("Line 6: a section label ("Page 2 of 3")"). `tests/import6.test.js` §1 holds it on all 66
  fixtures.
- Address headers in their mailing / home / billing / primary forms, and a new `country` role written to
  `donors.country`. `fixZip` writes ZIP+4 as 12345-6789 and gives an 8-digit ZIP+4 its zero back.
- Directory: Everyone · Donors · Contacts, each counted under the same filters (`GET /donors?roleCounts=1`;
  `role=contact` is `NOT donorOnlySql`; `role=auto` opens on Everyone until the org has a donor). The
  receipt links to `/donors?people=everyone&import=<id>`.
- A read-only org: `importOpen` refuses the preview and the write with the one sentence; the dialog says
  it before a file is chosen. The admin Overview lists trials ending in the next 7 days.
- A file with no gifts: the receipt says one line and offers Import gifts, not five zero tiles.
- Couples: the no-comma "old reading" (`Brad Hollins Alex`) is a couple only when the record says two
  people (a household or two emails) and the last word is not a common surname; an initial, suffix or
  title is always one person.

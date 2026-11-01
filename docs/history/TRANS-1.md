## TRANS-1 — moving takes about a day, and there is nothing to learn (2026-09-29)

Demos were closing and the objection had stopped being the product. Primate
Rescue loved it and chose January because she will not switch during giving
season. CKRH signed and is keeping Salesforce while she eases in. The line
Jonathan needs to be able to say, and have be true: moving takes about a day,
you keep your old system until you trust us, and there is nothing new to learn.

Census first, and most of it already existed: the mapper, dedupe, named
imports, the import moment, and BUILD-98's eight vendor presets with their
checklists and their "what does not come across". What was missing was the
FRONT of it — the question is now asked BEFORE the file ("Where are your
donors today?", eleven tiles), each tile opens a printable page in the
vendor's own menu names, and after the commit one page proves nothing was
lost. eKYROS takes the spreadsheet path and its tile says so in as many
words: it is a client-services system, it holds clients rather than donors,
and no donor export format is published.

**The bug under the whole brief.** An import wrote `external_donor_id` on the
way in and never read it again. Matching was by email and nothing else, so the
one thing a fundraiser actually does mid-move — correct a typo'd address in
the old system, then export again — produced a SECOND record, because the only
key Steward matched on was the one she had just changed.

**And then the walk.** Every part was green in tests and five things were
still wrong on the screen, which is the entry worth keeping:

1. A real DonorPerfect gift export landed NO MONEY. The shape detector called
   it "one row per donor (totals)" — reason, in full, "no per-gift date
   column" — about a file whose fifth column is `gift_date`. The preset had
   already mapped date and amount, but the SHAPE decides which mapper renders.
2. The source id never reached the record, so the fix above was inert on the
   main path. `isDonorIdHdr` ran `\s*` over the RAW header: it knew "Donor ID"
   and missed "donor_id". That is the BUILD-84 rule, written down in
   `docs/decisions/imports.md`, applied where it had not been — and a fixture
   spelling the header "Donor ID" could never have caught it.
3. The CSV path recorded no run at all, so the files every tile leads to had
   no named import and no Move Report.
4. The re-import's Move Report accused itself: "8 fewer gifts than your file
   and $3,124.84 less than your file", about a move in which nothing had been
   lost.
5. A run excluded itself from its own list, because Postgres keeps
   microseconds and a JavaScript Date holds milliseconds.

The one new test is the brief's own sentence: the same export twice, then an
updated export with five new gifts, leaves exactly the original plus five,
footing to the cent. It was proven able to fail before it was trusted —
reverting the match order splits Ivy Chen into two people — and it was written,
green, and NOT in `run-all.sh`'s CORE list, which is its own small lesson.

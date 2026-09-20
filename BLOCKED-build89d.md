# BLOCKED-build89d — the three statement files nobody had

Written 20 September 2026.

89d's brief was explicit: **"Needs Jonathan before this part runs: one real
export from Cash App, one from Venmo and one PayPal activity download,
scrubbed, dropped in `fixtures/sources/`. The presets are written against those
files."**

Jonathan's answer when asked: *"just do what you can - build the infrastructure
so api etc can just be plugged in later do the work now."*

So the infrastructure is built and the files are still owed. This is what is
real and what is not.

## WHAT IS REAL

`shared/sourcePresets.js` — a statement is a **preset on the existing mapper**,
never a second importer. Choosing "Venmo statement" pre-fills the answers the
mapper already asks for and lands on the same review step, the same duplicate
review and the same receipt as any other file.

Proven without a real file, by `tests/build89s-presets.test.js` (42):

- **the column table is load-bearing** — every candidate spelling declared for
  every preset is actually read, so a wrong guess fails here by column name
  rather than importing quietly wrong;
- **the rules that do not depend on the file**: a named movement that is never
  a gift is refused whichever way the money went, the sign decides when the
  type word says nothing, and the payment method is a fact about the FILE
  rather than a guess about a row;
- **re-uploading next month is safe**, and asserted at the seam that makes it
  so: `presetExternalId("paypal_csv", id)` is byte-identical to 89a's
  `externalKey("paypal", id)`, so a PayPal CSV row and the PayPal API reading
  the same transaction land on ONE gift;
- **a file that is not that statement is refused**, in a sentence naming the
  missing column.

Each preset declares its own honesty:

| Preset | Confidence | Basis |
|---|---|---|
| PayPal activity download | `documented` | PayPal's activity CSV columns are long-stable and published |
| Venmo statement | `reported` | the web statement's columns as widely reported, including the `Amount (total)` spelling and its signed values |
| Cash App statement | **`unconfirmed`** | the commonly-reported CSV shape, and see below |

## CASH APP MAY NOT HAVE A CSV AT ALL

The brief said sources disagree about whether Cash App exports a CSV or only
monthly PDF statements. That disagreement was not resolved. The preset is
written against the reported CSV shape and **declares itself unconfirmed**.

**NO PDF PARSER WAS BUILT**, as instructed. If the real export turns out to be
PDF-only, the honest move is to withdraw the Cash App preset and say "once a
month you drop the statement in" stops being true for Cash App — not to prop it
up with a parser nobody asked for this weekend.

## THE TEN-MINUTE WALK THAT CLOSES THIS

For each of the three:

1. Download one real month. Scrub it: replace donor names and emails, keep the
   COLUMN HEADERS and the row shapes exactly as they came.
2. Drop it in `fixtures/sources/`.
3. Run `node tests/build89s-presets.test.js`. A header the preset does not know
   shows up as an unmatched column.
4. Add the real spelling to the FRONT of that field's list in
   `SOURCE_PRESETS` — one line — and re-run.

For Cash App, step 1 also answers the question the brief could not: if the
export is a PDF, say so here and the preset comes out.

## WHAT IS NOT WIRED

The preset **selector on the import screen** is not built. The pure layer is
complete and tested; putting a "This looks like a Venmo statement" banner with
a one-tap override on the mapper is the same pattern BUILD-80's shape banner
already uses, and it wants a real file in front of it to be worth drawing.

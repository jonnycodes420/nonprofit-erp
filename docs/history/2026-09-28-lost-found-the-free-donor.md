## LOST & FOUND — the free donor audit (2026-09-28)

A consultant charges $500 to $2,000 to tell a nonprofit which donors are
slipping away. `stewardapp.dev/lost-and-found` does it in two minutes, free,
with no account, and it is Steward's best salesperson.

**The promise, and how it is kept.** "Your donor file never leaves your
computer" is not a policy, it is an architecture. The file is read into an
ArrayBuffer and handed to a Web Worker; the worker returns an audit. The
worker and the audit module contain no `fetch`, no `XMLHttpRequest`, no
`sendBeacon`, no `WebSocket` and no import of anything that has one, and that
is checked by reading the files rather than promised in a comment.

**Exactly two things reach a server**, and both are built by name in one place
each: the three fields she types to get the PDF, and four aggregate numbers if
she ticks the benchmark box. The benchmark route REFUSES a fifth field rather
than ignoring it, because a page that started sending more should fail loudly
here and not succeed quietly in production. The two tables enforce the same
thing structurally: `lost_and_found_leads` has no column that could hold a
donor, and `lost_and_found_benchmarks` has no column that could join it back
to a lead.

**The audit** is five questions a development director cannot answer from a
spreadsheet without a day of pivot tables: who gave last year and not this
one, who has gone quiet in any year, who is still giving and down 40% or
more, which recurring gifts stopped, and the top 25 at risk by dollars, plus
the retention rate and the dollars at risk. Every number opens its donors on
the page and carries the sentence that defines it. Somebody who stopped
entirely is counted as QUIET and not as drifting; counting them in both is how
a free audit inflates its own headline.

**The parse is Steward's own.** `shared/importShape.js` already solves the
three things every real donor export gets wrong — where the header row
actually is, whether 03/04 is March or April, and whether 1.234,56 is a
thousand or a decimal — so Lost & Found reuses it rather than growing a
second, worse copy. The fixture it is tested on has a title row above the
header, a blank row, two name columns, money with symbols, a mixed Recurring
column, rows with no amount, and a trailing TOTAL row.

**The funnel is honest.** The results are free and complete with no email at
all, and the page says so before she uploads. The form is only on the PDF.
`?ref=` rides the lead so an affiliate gets credit. "Start Steward with this
file" cannot carry the file — it never left her browser, and putting it in
storage would break the promise — so what travels is the intent, and the
import step after signup says "You ran a Lost & Found audit on X. Use the same
file here."

**The one new test** (`tests/lf1-no-donor-data-leaves.test.js`) runs the real
fixture through the real parse and the real audit with every network primitive
replaced by a recorder, then asserts the recorder is empty, that the benchmark
payload's every value is a band label or a whole percentage, that the worker's
source contains no way to make a call, and that the two routes refuse a field
carrying a donor. Four defects were planted and each watched go red.

**Two things the build got wrong and the tests caught.** `normalizeDate` and
`normalizeEmail` return `{ value, warn }`, not the bare value — reading
`.iso` compiled fine and produced an audit of zero gifts on a perfectly good
file. And the first fixture generated 140 people who shared twenty names
between them, because `i % 20` and `(i * 7) % 20` have the same period; the
walk was grepping the network for one string instead of a hundred and forty.

**The walk (`scripts/lf1-walk.js`, 56 checks at 1440 and 390)** is the half
the Node suite cannot do: it uploads the messy file in a real browser, records
EVERY request for the whole session, and greps each one's method, URL, headers
and body for all 140 names and all 140 emails. Zero. Exactly two posts reach
the API and the walk prints both bodies in full.

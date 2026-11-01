## FIN-1 — the Finance facelift (2026-09-28)

Finance worked and answered nothing. Eight sub-tabs in a flat strip, every one
of them equally loud, four figures that were period totals of a ledger most of
the org's giving never reaches, and a restricted balance of zero on the demo —
so the one screen that exists to answer "how much of this is not ours to
spend" said less than the bank statement.

**The shape.** Five sections, each one a question, with all eight old views
folded in underneath as parts: Overview (This month, Transactions), Funds
(Funds, Budgets), Deposits and payouts (Payouts, Deposit sheet), Grants money
(Restricted), Exports (Month close, Year-end statements, Audit log). Nothing
was dropped and every deep link that named a sub-tab still resolves, because
`PART_SECTION` maps an old id to the section it now lives in. The title is
"Your money.": finances is what an accountant calls it.

**The four figures, and they open.** Money in this month, restricted balance,
unrestricted balance, deposits not yet matched. Each one opens its rows, and
the rows SAY OUT LOUD whether they add up: "129 rows, $138,543. They add up to
the figure, to the cent." That sentence is the whole point — a number a
bookkeeper cannot get behind is a number she will not sign, and "trust me" is
exactly what she will not do. The figure and its rows are the same query run
twice, so they cannot drift.

**Money in by month** is twelve bars that each open their gifts, with empty
months drawn as zeros rather than skipped: a chart that skips them makes a
quiet year look like a busy one.

**Needs you** is three things at most and every one is a thing somebody can do
today — gifts with no fund, cheques not on a deposit, restricted money with a
report due inside sixty days. Not a health score, not a progress bar, and not
a warning: a count, a sentence, and the rows.

**Funds** is one card per fund with the balance, in and out this period, the
restriction, and WHO restricted it — read from three places (a grant whose
money was posted to the fund, a gift that named it, and a ledger line carrying
the body it came from) rather than guessed from the fund's name. The third one
matters because most restricted money in a small shop arrives as a transaction
somebody typed.

**Exports** gathers what a bookkeeper needs into one place: the month-close
checklist (five things, each open or done, each saying what to do), the
existing bookkeeper file with its cents assertion, the QuickBooks and Xero
column sets, and the year-end statement run. The QuickBooks and Xero mappings
are a RESHAPE of the same rows, not a second export — nothing there adds
anything up — and both are marked documented-not-walked on the screen itself,
because neither has been through a real import.

**Three bugs this build wrote and then found**, all three in SQL against
columns that do not exist, and all three would have shipped looking fine:
`grants.funder_id` (there is none; `funder` is TEXT and the grant's title is
`program`) inside a `.catch(() => [])` that turned a wrong column name into a
silently empty Needs-you list; `gifts.receipt_number` (a receipt is a row in
`receipts`) which would have counted every gift as un-receipted for ever; and
`gifts.deposit_id` (a deposit is an `imports` row with shape='deposit' and its
gifts carry `import_id`). The catch is the lesson: a catch that swallows a
query error is a catch that turns a typo into an answer.

**The demo now has a finance month.** Three funds, a restricted grant whose
$55,000 first instalment sits in its own fund with $27,350 left and a report
due in 41 days, a scholarship fund restricted by three named donors, and the
month's operating expenses so the bars and the funds are not one-sided.

**The walk (`scripts/fin1-walk.js`, 107 checks at 1440 and 390)** opens every
section and every part, checks each figure foots through the real route before
it looks at a screen, and asserts NO DARK GROUND anywhere in the content
column. Its first version flagged three correct pages, because it counted a
filled ink button and a twelve-percent tint as a ground; a ground is large,
opaque, and not a button.

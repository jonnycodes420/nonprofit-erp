# NUMBERS-9 · for the fleet

**Surfaces changed:** Finance → Funds (each fund card's new line under Balance, "Gifts on the books … and transactions
in …", and its parts; the dialog a card opens shows the same line); a printed letter (Communications → Letters, the
PDF and Word file) that covers more than one gift; the year-end statement's deductible total; Donors (the Last gift
cell), the profile's Last gift figure and its line under it; Reports → LYBUNT and SYBUNT (a household line's
Lifetime and its parts); a person's profile rail (Gives through, for an Owner link and for a link that credits
nothing) and an organization's Given through it; Home's thank-you card, Drafts to review, Acknowledgments' backlog
sentence, Reports → People "Gifts not yet thanked since <day>", the Report builder's Thanked.

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** Finance → Funds → General Operating. Under Balance: "Gifts on the books $… (gross: what
   donors were charged) and transactions in $… (the ledger's income rows as posted) differ by $82.13: $82.13 is the card
   fee donors covered on 4 gifts …". Click "Card fees donors covered": four gifts, each row the gift less its ledger
   row, adding to $82.13. Click the card: the dialog shows the same line word for word. After the next rebuild of
   staging, the line reads "agree, to the cent".
2. **(Read only.)** Any other fund: the line says the two figures agree, or names each part that differs; every part
   opens rows that add up to it.
3. **(Needs a write: org_stagewalk.)** Make an event; give one person a $500 gift to it with $190 of goods received,
   and a $100 gift to it. Letters → that event → Preview: $600, deductible $410. Download the PDF: it lists both gifts
   and ends "the deductible amount of these 2 gifts is $410.00". Off the path: refund the $100 in full, preview
   again: one gift, $310, and the single-gift sentence.
4. **(Needs a write: org_stagewalk.)** Give a person $50, then Record a refund of $15. Donors: Last gift "$35 · $50 less
   a $15 refund"; profile Last gift $35 with "Less a refund of $15.00 on $50.00"; Lifetime $35. Undo the refund: $50
   everywhere, no refund words.
5. **(Read only.)** Reports → LYBUNT, One row per household: a household line reads "<name> household" (or the
   household's own name) and its Lifetime shows "household: A $x + B $y"; each of those matches that person's profile
   Lifetime. Switch to One row per person: each row equals the profile.
6. **(Needs a write: org_stagewalk.)** Make an organization (Data health or an import), link a person as Owner (gives
   through it), give the organization $1,000. The person's rail: Gives through → the organization, $1,000, "soft
   credit through the Owner link", and the figure opens the gift. The organization: Given through it names them at
   $1,000. Change the link to Works at: the person's rail says the organization's gifts are its own.
7. **(Read only.)** Home's thank-you card (when it shows), Acknowledgments' backlog sentence, and Reports → People
   "Gifts not yet thanked since <day>": the same count. Report builder → Gifts → Thanked is No and Date on or after
   that day: the same count and total.

**What could have broken nearby:** Finance → Overview's Posted / Waiting figures (same ledger rows); Post to the
books; the receipt for one gift and the year-end statement (one deductible rule now: a gift with goods received and
no stored deductible is deductible less their value, where the statement used to print the whole gift); merge fields
and lists that read the stored last gift amount (now net of a refund); the nightly number check; Top 100 and the
officer portfolios (Gives through rows); Atlas's "who should I thank".

**Needs a write:** clicks 3, 4 and 6 (org_stagewalk).

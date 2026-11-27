# NUMBERS-10 · for the fleet

**Surfaces changed:** Finance → Funds (each card's balance sentence and the covered-fee line), the fund dialog, Transactions
filtered to a fund (its footer), Finance Overview's fund balances; Reports → Acknowledgment backlog ("Older than the
window"); Home's thank-you card and the thank-you queue line; a next-move thank-you draft; the donor profile's Gift History
header and Giving tab count; the profile rail's Gives through and an organization's Given through it; an event's After the
event tile, First-time givers; the Giving tab's pledge × and the in-app confirm; the timeline after a gift delete; the
import preview and receipt headlines.

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** Finance → Funds → General Operating, then click the card. The card, the dialog and View txns →
   All years give the same balance to the cent. Until staging is rebuilt, the card ends "$82.13 of card fees donors covered on
   4 gifts is not in it: those gifts' rows were posted before the fee". After a rebuild it reads "agree, to the cent". Off the
   path: Transactions for the fund with the year set to this year. The footer asks you to choose All years and still quotes
   the all-years balance.
2. **(Read only, Harborlight.)** Home: "Gifts not yet thanked since Apr 22, 2025". Reports → Acknowledgment backlog gives the
   same count and total. "Older than the window" is a separate figure and opens its gifts. Off the path: set From earlier,
   click Show, then click "Home's window" and check it returns to Home's figure.
3. **(Read only, Harborlight.)** Open Granville Thistlewood. The rail reads "Gives through: Tidewater Community Foundation
   $25,000". It opens 4 gifts adding up to $25,000, and his own Lifetime is unchanged. Open Tidewater: "Given through it" lists
   him at $25,000.
4. **(Needs a write: org_stagewalk.)** Give one new person $1,000 and $25 on the same day. The queue reads "$1,000 and $25 on …"
   and the draft "your gifts of $1,000 and $25". Refund $15 of one gift. The Gift History header's count equals the Giving
   tab's, and the refund row is named as not counted.
5. **(Needs a write: org_stagewalk.)** Give a new person $40 with no event, then $150 stamped with an event on the same day.
   That event's First-time givers does not count them. Click the figure: the people listed are exactly the count.
6. **(Needs a write: org_stagewalk.)** Profile → Giving → × on a written-off pledge with a payment. You get "This pledge stays
   on the record" with only Close, and the pledge stays listed after a reload. On a pledge with no payment: "Delete this
   pledge?", then an Undo toast.
7. **(Needs a write: org_stagewalk.)** On a new donor whose first gift started "Call to say thank you", delete the gift. The
   timeline gains one "Thank-you cancelled: …" line and the call leaves Tasks. Undo in Recent changes: the line goes, and the
   step and the call come back.
8. **(Needs a write: org_stagewalk.)** Import a CSV with future-dated and duplicate rows. The preview and the receipt both say
   "N rows: G gifts $X in (S of them scheduled gifts, $Y, that count on their dates), A set aside", and the figures foot to the file.

**What could have broken nearby:** Restricted funds and Post to the books (the card's waiting figure), the Report builder's
Thanked = No, the weekly email's unthanked figure, LYBUNT/SYBUNT giving units, the census's soft credit line (still explicit
soft credits only), the event list's counts and Fundraising's lead event card, Recent changes and gift restore, the journey
panel, Settings → Imports.

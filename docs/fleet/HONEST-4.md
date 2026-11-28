# HONEST-4 · For the fleet

**Surfaces changed:** Settings → Connections (every connected card: a new proof line under the badge, "Last gift
read <day, time> · N gifts, $X in the last 30 days"; the badge "Example data" over demo or sample rows; the dot is
emerald only beside Connected; the summary line's counts). Each connection's panel under Manage or Fix (the same
proof line above **Last three checks**). The **QuickBooks** card and its panel (headline, reasons as links, the
pause and **Try again**). The **Stripe** card's panel (its proof and checks first, the giving-pages setup after).
The **Zapier** card under Build your own. Recurring → **Recurring Health** ("Cards updated by the bank this year")
and the recurring gifts list (a card line under "Card · Stripe"). The public **Status** page (`/status`), the public
**Connections** page (a "Build your own" group), and **Book a call** (`/book`).

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** Settings → Connections. Stripe, PayPal, Givebutter, Square, QuickBooks, Mailchimp
   and Gmail and Outlook each read **Example data**, with a hollow dot. None reads Connected, Working or Needs
   attention. Each connected card's proof line opens "Example data: nothing real has come through it." The summary
   line over the page reads **0 working** and does not count them. Press QuickBooks' button: the panel says the
   same proof line as the card.
2. **(Read only, Harborlight.)** The QuickBooks card's line: "273 gifts ($261,998.91) waiting. Auto-sync is off. 2
   funds aren't mapped (…)." The dollar figure opens the 273 rows. Click **Auto-sync is off.**: the panel opens and
   lands on Turn auto-sync on. Click **2 funds aren't mapped**: it lands on Review the mapping. Off the happy path:
   click a reason with the panel already open. It must scroll, not close the panel.
3. **(Read only, Harborlight.)** Press the Stripe card's button. The panel opens on the Stripe history's figures,
   proof and Last three checks, with "Set up Stripe" below them. No Stripe Connect page opens.
4. **(Needs a write: org_stagewalk.)** Recurring → Recurring Health: the line "Cards updated by the bank this
   year: 0" is shown even at nought, and the 0 opens an empty list. The recurring gifts list: a card gift shows
   its card line ("Visa ending 4242 · not updated since Steward first read it"). An offline gift has none.
5. **(Read only, no sign-in.)** `/status`: on staging no real org holds Stripe or a giving source. So "Stripe gift
   sync" and "Other connection syncs" show **no status word and no percentage**, with the sentence "No live Stripe
   connection to measure yet." Nothing on the page says Working over example data.
6. **(Read only, no sign-in.)** The public Connections page: Zapier appears once, under **Build your own**, as
   "Connect to 6,000+ apps. Starts a Zap on New gift, New person or Stage changed; can Create person, Record gift
   or Add note." Open API and Webhooks are in the same group. No app Zapier reaches is listed as if Steward
   connects to it.
7. **(Read only, no sign-in.)** `/book`: staging holds no Calendly token. At once (no spinner), the card says
   "Times didn't load. Open the calendar in a new tab. Or email …" with a link that opens Calendly in a new tab.
   Fill the form and press Send, then pick a time: the card says "Thanks. Now pick a time" with the same link.
   No calendar frame appears. On prod (Jonathan's token): three weeks of weekdays with Later dates and Earlier
   dates. A day with no times says "No open times on <day>". Times reach into December and January.

**What could have broken nearby:** Home's connection lines and Finance's QuickBooks line (they read the same
flow, now with `head` and `fixes`). The "Connects directly" tiles (FlowWord, the badge words). The setup steps'
Connect step. The Gmail and Outlook card (its badge is now "Example data" in the demo). The weekly "why" on a
source tile (`weekWhy.js` was widened, not changed). The QuickBooks Sync and Sync all buttons (the pause check runs
first). The order page's calendar embed (`SlotPicker` is unchanged and still used there).

**Needs a write:** item 4, and any QuickBooks pause check (three failed syncs need a connected QuickBooks
sandbox). Run those in org_stagewalk only, never in Harborlight.

## FIX-11 Part 6 follow-up — the icons are 20px again (2026-10-01)

Jonathan looked at the 24px rail and reverted it the same night: too big. Back
to 20px and stroke 1.75, exactly as NAV-1 shipped them, and the phone back to
18 and 19.

The measurement below is kept because it is the answer to "why do they look
slightly soft", and the next person should not have to redo it. The size is the
thing that matters more, so a small amount of antialiasing is now a deliberate
accepted cost rather than an unknown.

## FIX-11 Part 6 — the icons were grainy, and it was the stroke (2026-09-30)

Jonathan saw the new sidebar icons as slightly grainy. Measured on a retina
screenshot rather than guessed at: **nothing scales them, nothing dims them**,
no ancestor carries a transform, a filter, an opacity or a fractional width,
and all thirteen sat exactly on the device-pixel grid at 20x20.

The softness was the STROKE, and the arithmetic is the whole story. An SVG
stroke is centred on its path, so at device-pixel ratio 2 it is crisp only when
it covers an EVEN number of device pixels. The coverage of one vertical stroke,
read straight across:

```
20px / 1.75  = 2.917 device px   116 255 255 116   two half-lit pixels
20px / 1.8   = 3.000 device px   127 255 255 127   two half-lit pixels
20px / 1.5   = 2.500 device px    63 255 255  63   two half-lit pixels
20px / 1.2   = 2.000 device px       255 255       clean
24px / 2     = 4.000 device px   255 255 255 255   clean
```

So "a whole number of device pixels" is not the rule, which is where the first
guess went: 1.8 gives exactly 3.0 and is still soft, because 3 centred on a
boundary is 1.5 either side.

At 20px the only clean strokes are 1.2 (31% less ink, dimmer on a dark rail)
and 2.4 (38% more, noticeably bolder). Neither keeps the weight. **24px with
stroke 2** is clean and keeps the proportion: 2/24 is 0.083 where 1.75/20 was
0.088. The icon is 20% bigger, which is the visible part of this change and
the part to reject if it is wrong. The phone's two sizes (18 and 19, neither
even in device pixels) became the same one size.

NAV-1's walk passes at the new size with fresh screenshots in `docs/nav1`.

### The tail: the two holes Part 1's census named

**The Agent is the actor, and a person approved it.** Part 1's middleware
supported `req.audit.actor(...)` and no route set it, so an action a model
drafted and a person merely approved was logged as that person's own work. The
row was right about who authorised it and silent about the fact a model wrote
it, which is the one thing oversight of a model exists to record. Declared by
route pattern in `auditTrail.js` — one visible list, not a line added to each
of twenty-nine agent routes and forgotten on the thirtieth — and the row now
reads "Agent, approved by Dana Reyes", by name, because an email address reads
as the software talking to itself. An instruction a person wrote, and a person
undoing the agent, stay theirs.

**Background jobs have the guarantee routes have.** A periodic sweep does not
pass through Express, and the sweeps that logged called `writeAuditLog` by hand
— the same arrangement that left four hundred and thirty-four routes unlogged
for a year. `recordTick` is the one seam every job passes through, so the rule
lives there: a job is declared in `jobAudit.js` as one that WRITES (donor data,
money, mail) or one that only READS, and **a job in neither list throws rather
than running**. Forgetting is not a silent option. A writing job returns its
orgs and gets one audit row in each, through the same insert the request
middleware uses, so a job's row and a person's row are the same kind of row.
Eighteen jobs declared writing, eight read-only, each with a sentence saying
what it writes or why it does not — checked, so the read-only list cannot
become a place to park a job nobody wants to think about.

## FIX-11 Part 5 — the Resend inbound actually lands on the donor (2026-09-30)

On 30 September Muse wired Resend inbound on log.stewardapp.dev: receiving on,
MX and DKIM at Vercel, Railway variables set, the webhook pointed at
`/inbound-email` with the shared secret. **It would have received nothing**,
for two reasons, and both were silent.

**Resend nests the whole message under `data`.** The payload is
`{ type: "email.received", created_at, data: { email_id, from, to, cc, bcc,
message_id, subject, attachments } }`, and the route reads `to` and `from` at
the top level. So `orgSlugFromPayload` found no recipient, every message was
dropped as "no_org", and the drop counter would have been the only trace. The
suite proves it from the other end: asked for the org, the unadapted payload
answers `null`.

**And Resend's inbound webhook carries no body at all.** Not the text, not the
html, not the headers: metadata and an `email_id`. The body is a second call,
`GET https://api.resend.com/emails/receiving/{id}` with the API key. So even a
flattened payload would have filed a subject with an empty note. A message
whose body cannot be fetched now stores nothing, because a half-record on a
donor's timeline cannot be told from a donor who wrote nothing.

**A no-match stored the subject and the body, and should not have.** The brief
said "same storage rules as INT-4: only messages involving someone already on
file are stored". It turned out INT-4 disagreed with itself. The Gmail and
Outlook half (`shared/mailboxLog.js`) drops a no-match and its decision carries
no subject, no body and no address, which `tests/int4-mailbox.test.js` §1 pins
byte-wise. The BCC half HELD, with all three, on the Unmatched list. Two paths
handling the same kind of data, and the looser one was the one receiving mail
from the open internet.

The strict one is right: a message that names nobody on file is correspondence
with somebody Steward has no relationship with — a vendor, a friend, a
journalist, a doctor. Keeping its subject and body so staff MIGHT file it later
means a donor CRM holding the contents of mail about people who never consented
to be in it. The count is kept, because "eleven messages arrived that Steward
stored nothing from" is true and useful. `multiple` and `self_test` still hold:
everybody involved in those IS on file.

**A signature where there is one.** The shared secret rides in the webhook URL,
which works and puts the secret in every proxy log between Resend and here.
Resend signs with Svix and `RESEND_WEBHOOK_SECRET` is already set for the
delivery webhook, so `/inbound-email` now keeps its raw bytes (one scoped
`express.raw` above the JSON parser, the same pattern the other webhooks use)
and verifies a signature when one is present. A request that CLAIMS to be
signed and is not is refused outright rather than falling through to the
secret, which would otherwise let anybody who learned the URL bypass the
signature by sending a bad one.

**The address is on a screen now.** Settings, Account — which is where the user
chip in the top bar already leads, so it is the profile menu's destination —
with a copy button and the honest sentence: it is ONE address for the
organisation, Steward knows it came from you because you sent it, and a message
naming nobody is stored nowhere at all.

**BCC logging is per organisation** (`orgs.inbound_email_enabled`, default
true), and the demo org is opted out by the one script that writes it. Its
people are fictional and strangers look at its screens.

`RESEND_RECEIVING_BASE_URL` is a second Resend seam, separate from
`RESEND_BASE_URL`: sending goes to the local mail sink and the receiving API is
a different API, which the suite stands up itself. Both are in `tests/shard.sh`
so the suite RUNS in CI rather than skipping, because a suite that skips is
coverage that is not there.

NEEDS-JONATHAN.md §0-INBOX named the wrong route (`/resend/inbound`, which does
not exist) and the wrong authentication, and called the adapter done. Corrected,
along with the Google note: the consent screen is In production, not Testing,
and publishing it is not the same as passing verification.

## FIX-11 Part 4 — a gift file with no donors is not a dead end (2026-09-30)

On 30 September Jonathan imported a 40-gift file into an org where those donors
did not exist. The screen said "0 gifts ready to import, attaching to 0 donors ·
40 unmatched (will skip)", offered a grey "Import 0 Gifts" button, and told him
to "use combined mode later", which is not a place. A customer arriving with a
gift file from another system hits exactly that, and the only answer the product
had was: go away, split the file, come back.

**It is an offer now.** The unmatched rows become a count of PEOPLE, named
before anything is written, beside two buttons: "Create 5 new donors and import
their gifts" in emerald, and "Import only the 3 that match" — which says "No
gifts match somebody on file" and is disabled when nothing does, rather than
reading "Import 0 Gifts" as the only button on the screen.

One person per identity: by email where there is one, lower-cased, otherwise by
exact normalised name. A row with neither a name nor an email is counted and
left out rather than becoming a donor called "". It goes through
`/donors/import-combined`, the combined import that already existed, under one
run id. There is no second import path.

**The whole thing undoes as one import**, and that is a deliberate widening of
"only a deposit can be reversed as a whole. An import is undone gift by gift,
on the record." That rule is right for an ordinary import: those gifts landed
on donors who already existed and have a history of their own. A gift file
imported where NONE of those donors existed is the opposite case: every gift
and every person came out of one file, there is no prior history to disturb,
and the thing a customer needs when they have imported the wrong file is one
undo. The safety is the machinery that was already there, unchanged: gifts by
`import_id`, and people only where `created_import_id` is this run AND they
have no other gift and no other interaction. A created donor who has since
acquired a gift is kept.

The route stopped being admin-only, which is the one gate this changed.
Importing takes `checkWriteAccess`, so a staff member can import; if undoing it
took an admin, the person who had just put forty gifts on the wrong org would
be shown an Undo button and refused by it. An admin may undo any whole-import
run; anybody may undo their own.

**THE GIFT-HISTORY IMPORTER WAS ROUNDING EVERY AMOUNT TO WHOLE DOLLARS.**
`Math.round(amtVal || 0)`, in both parse paths, since the surface was written.
A $250.50 gift was imported as $251.00 and a $33.33 one as $33.00, so every
gift-history import had been quietly wrong by up to 49 cents a row and no file
had ever reconciled against its own source. The browser walk found it: the
server-side suite posts amounts directly to the route and could never have
seen it. Widening the guard to the whole file then found a THIRD site, in the
year-column branch of the recommended "Import + History" path, so the import
Steward pushes hardest was rounding too.

Also found: calling `onImported()` on success dismissed the result screen the
instant the import finished, because the parent wires that callback to closing
the modal. The undo went with it.

## FIX-11 Part 3 — a bookkeeper export a bookkeeper can use (2026-09-30)

Jonathan exported `bookkeeper-2026-08.csv` from the demo org on 30 September.
The arithmetic was right — 243 gifts, $240,853.00, the fund totals footed — and
a bookkeeper still could not use it.

**The three format buttons were `<span>`s.** Steward / QuickBooks / Xero looked
like buttons, had a tooltip each, and had never been clickable: the column sets
lived in `routes/finance.js` and the download lives in `routes/crm.js`, so the
choice had nowhere to go. The sets moved to `bookkeeper.js`, declared once, and
the download honours `flavour`. A format Steward does not know is refused by
name rather than quietly falling back to one that looks similar.

**The totals rows were inside the CSV body.** A blank row, a TOTAL row, another
blank, a "TOTALS BY FUND" heading, a line per fund and a second TOTAL — under
the gift columns. It reads beautifully in a spreadsheet and it is the reason a
QuickBooks import of the August file would have booked six phantom
transactions, one of them for $240,853: an importer reads rows, not layout.
They are on the payload the screen shows instead.

**Two files now, from the same query.** The gift detail is one row per gift, for
the record, and it gained the four columns a reconciliation cannot be done
without: processing fee, net, which deposit the gift arrived in, and whether it
was cash. The deposits file is one row per deposit LINE, which is the shape a
bank statement has and the shape both vendors' bank-deposit imports take:
date, deposit account, a line per fund, ONE negative fee line, and a net that
equals what hit the bank. Non-cash gifts (stock, in kind) are their own file,
never a section inside a file somebody imports as bank transactions.

**A cheque number was never a column.** 0 of 51 cheques in the August file
carried one, and the reason was not a missing export column: the deposit sheet
wrote the number into the gift's NOTES, and the export reads `reference`, which
is an external or Stripe id. `gifts.check_number` exists, and a one-shot
backfill recovers every number already written into a note.

**The seed was worse than the brief recorded.** Not one gift with no fund:
every gift in the demo had `fund_id` NULL — all 3,942 of them — because the
seed writes gifts in bulk and bypasses `recordGift`, which is the one place
that assigns the unrestricted fund. So "TOTALS BY FUND" had exactly one line,
called "(no fund)", and it footed, which is how it went unnoticed. No gift
anywhere carried a processor fee either. Every seeded gift now has a fund, a
method, a deposit, a fee if it was a card, and two cheques in three have a
number — not all of them, because a seed where every cheque has a number hides
the screen's own "a cheque with no number" flag.

**What is missing is said before the file is written.** Four counts — no
payment method, no fund, a cheque with no number, not matched to a deposit —
each one opening its rows, each with the fix. The August file had four gifts
worth $57,500 with no method and nothing said so: correct, and quietly
incomplete, which is the worse of the two ways a file can be wrong.

**The defect the footing check caught.** The QuickBooks deposits file's fee
lines went out as `'-3.68`. `reportCsvCell` prefixes any TEXT cell beginning
with `-` with an apostrophe, correctly, because `-2+3` is a formula — but its
own comment always said numbers pass through, and it only recognised a number
when the value was typed as one. QuickBooks reads `'-3.68` as text. The guard
was narrowed (`CSV_PLAIN_NUMBER`), not worked around; emitting a JS number
instead would have written `-8.3` into a money column. Found by adding the
file's own Amount column up and getting NaN, which is the cheapest possible
check and is now §1 and §2 of the suite.

## FIX-11 Part 1 — everything leaves a trail (2026-09-30)

On 30 September Jonathan recorded a $100,000 gift by hand on the Creo demo
record and the audit log did not mention it. The cause was not a filter, a
delay or the demo org: **no gift path wrote an audit row at all.** Thirty-three
`writeAuditLog(...)` calls existed, every one hand-placed in a finance or
settings route, and the other four hundred and thirty-four mutating routes
wrote nothing. A list of audit calls is a list somebody forgets to add to, and
what they forget is a record of whose money moved.

**The shared layer.** `middleware/auditTrail.js`, mounted above every one of
the app's routers in `server.js` — above the raw-body webhook routers, so there
is no route a change can reach without passing through it. A route does not opt
in; a route written tomorrow is logged with its author doing nothing. 467
mutating routes, 0 uncovered, 1 declared read-only
(`auditTrail.READ_ONLY_POSTS`), and `tests/fix11-audit-trail.test.js` reads
that off the live Express router rather than a hand-kept list.

**Before and after, with nothing written per route.** The middleware reads the
record before the handler and again after, and stores only the fields that
moved. Two things about that cost a silent half-feature each, and both were
found by verifying rather than by reasoning:

- The before-read happens before `requireAuth`, so there is no `req.user` and
  no org to scope it to. The first version scoped it to the org anyway, got
  null every time, and recorded no before/after on a single edit in the
  application. It now reads by primary key and checks the org at finish time.
- The resource name does not identify a table. `/finance/funds/:id` is
  `fin_funds`, and there is ALSO a table called `funds`. Picking by name picked
  the wrong one. The name now only proposes candidates and the right table is
  the one that actually holds the id.

**The thirty-three hand-placed calls are not deleted.** Several of them know
something a route pattern cannot ("api_key_created", "oauth_tenant_chosen").
`writeAuditLog` now finds the request it is inside (an `AsyncLocalStorage`) and
*improves* the row the middleware is already writing instead of inserting a
second one beside it. One action, one row, and the better name wins. Outside a
request — a background sweep — it inserts as it always did.

**Append-only, enforced by the database, on the application's own connections.**
Every connection `db.js` opens carries `steward.app_connection=on` as a startup
option, and a trigger refuses UPDATE and DELETE from such a connection. The
polarity is deliberate: refusing everything and letting the one legitimate
purge announce itself would also stop twenty test teardowns and every
maintenance script clearing a scratch database, for no extra safety — a psql
session can drop the trigger either way. What matters is that no screen and no
route can touch history, and that is what this enforces. The one path that may
is closing an organisation's account, which sets `steward.audit_purge`
transaction-locally and says so out loud (`routes/billing.js`). The org foreign
key became `ON DELETE CASCADE` in the same breath: an org's history goes with
the org, said once where the relationship is declared rather than in four test
teardowns.

**"+ Log → Gift" made a note and no gift.** The modal posted the typed fields
as a key:value blob to `/donors/:id/interactions` AND posted a gift whose
`notes` was that same blob; `recordGift` writes one linked timeline entry of
its own, so the record carried two entries, identical text, same day — which is
exactly what Jonathan saw. The Amount, Designation and Payment Method he typed
were prose in a note rather than a fund and a method on the gift, so the money
reached no total, no receipt, no bookkeeper export and no audit row. The gift
type now collects nothing and hands off to the gift form on the Giving tab: one
gift path, a real fund, a real method, an acknowledgement flag, one timeline
entry. A gift reads as `$100,000 · General Operating · ACH · not yet thanked`,
from one formatter both timeline modes call.

**What only the browser caught** (`scripts/fix11-audit-walk.js`, 25 assertions
at 1440 and 390):

- The hand-off did nothing when the profile was already open. React keys the
  profile by donor id, nothing remounted, and the initial state that opens the
  gift form never ran again. No test of the modal in isolation could see it.
- A gift posted with `payment_method` — the spelling the form, the gift EDIT
  route and the bookkeeper export all use — was stored with NO method, because
  the create route read only `paymentMethod`. That is one of the blank-method
  rows Part 3 is about, and it was being created on the way in.
- The timeline printed "Needs you", the sentinel for a missing method, as
  though it were a payment method.
- An audit row for a CREATE showed nothing about what was created, so a
  recorded $100,000 gift was a row with no amount in it.

Also noted, older than this build and not touched: reaching `/settings` by URL
at 390 lands on Home, which is why the phone leg of the walk goes through the
More drawer.

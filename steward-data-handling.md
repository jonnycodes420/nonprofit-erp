# Steward — data handling

What Steward stores, and who else sees it.

## Inbound email (BUILD-87 Part 3)

- An email you BCC to your organization's logging address is stored on the
  matched donor's record as plain text — subject, date and body, with quoted
  replies trimmed and attachments dropped — and the inbound mail provider that
  receives the message on Steward's behalf holds it in transit. (The provider
  is **Resend** (decided 2026-09-25: Resend already sends Steward's mail, so it is already a subprocessor and this disclosure does not grow by a name). Not yet switched on — see `NEEDS-JONATHAN.md` §9. Until it is, this line names it as
  "the inbound mail provider" until a human picks one, and the name goes here
  before a single message is received.)

## Outbound email (BUILD-88c C.1)

- **Resend** (resend.com) sends every email Steward sends: appeals, receipts,
  year-end statements, recurring-gift notices, reconnect links, sequences, and
  the notifications Steward sends your own staff. Resend is a **subprocessor**:
  it sees the recipient's email address, the subject, and the message body —
  which for a receipt includes the donor's name, the gift amount and its date,
  and for an appeal includes whatever your organisation wrote.
- **Your own sending domain (optional).** If you verify a domain you control,
  Steward asks Resend to create it and shows you the DNS records to publish;
  Resend then holds the DKIM key for that domain and signs your mail with it.
  A sending domain belongs to **one** organisation on Steward — the uniqueness
  is enforced at the database, not by convention.
- **Until a domain is verified**, mail leaves on Steward's shared sending
  domain with your organisation's name in the From and a Reply-To that reaches
  you. Once it is verified, the From is your address at your domain and Resend
  is the only party in the path besides you and the recipient.
- **Open tracking.** A campaign email carries a 1×1 image hosted by Steward, so
  Steward records that an address opened it and when. Receipts and other
  transactional mail carry no such pixel.
- **Unsubscribe links** in campaign and sequence mail resolve on Steward's
  domain, because Steward hosts the page that honours them. A recipient who
  inspects that link sees `stewardapp.dev` even when the message is sent from
  your own domain; putting that link on your domain is tracked separately in
  a deferred item (path-based URLs remain v1).

## Connected giving sources (BUILD-89S, 2026-09-20)

**Steward never holds or moves your money.** You keep whatever you take gifts
through today, and Steward reads from it with read-only access you can switch
off at any time. There is no Steward account in the middle of a gift, and no
balance anywhere that belongs to you.

What that means concretely, per provider:

| Provider | What Steward reads | What Steward sends it |
|---|---|---|
| **PayPal** | completed incoming payments on your own PayPal account: the amount, the fee PayPal took, the date, the payer's name and email, and PayPal's own subscription id when the payment is a subscription | one request to mint a read token, then nothing but reads |
| **Zeffy** | the payments on your own Zeffy account, with the same fields | nothing but reads |
| **Stripe** (your own account, not Steward's) | charges on your own Stripe account, their fees, and the subscription behind a charge | nothing but reads |
| **Givebutter** | transactions and recurring plans on your own Givebutter account | nothing but reads |
| **Cash App, Venmo** | nothing. Neither has a way for software to read an account. A statement file you upload is read the same way any spreadsheet is, and never leaves Steward | nothing at all |

**Steward cannot write to any of them.** Not "does not" — cannot: every
provider adapter is handed a connection that refuses any request that is not a
read, and the one exception in the whole system is the single PayPal request
that mints a read token. A refund, a payout, a cancelled subscription or a
deleted payment is not a thing this software can express.

**Your credentials.** A provider key you paste is encrypted before it reaches
the database (AES-256-GCM, bound to your organisation, so the stored value is
useless anywhere else), and the database itself refuses to hold one that is not
encrypted. No screen, export or log ever shows the key back to you or to us.
Disconnecting a source destroys the stored key and keeps every gift already
read.

**Off is off.** Disconnect a source and Steward stops checking it that moment.
The gifts it already read stay on your donor records, because the money did
arrive that way and deleting that history would be the lie.

## Reading cheques and drafting text (BUILD-96 Part 3, 2026-09-24)

**Anthropic** (anthropic.com) is a **subprocessor**, in the United States. Two
features send data to it, and nothing else in Steward does.

| | What is sent | What is NOT sent |
|---|---|---|
| **Reading a cheque photograph** | the photograph your treasurer chose to upload, and nothing beside it — no donor record, no name lookup, no history | your donor list. The image is read on its own; the payer's name is matched against your records **afterwards, inside Steward** |
| **Steward's agent drafting text** | the instruction your staff typed, your organisation's vocabulary, and the rows **Steward selected for that instruction** — capped, org-scoped, and excluding anyone nothing may be drafted for | a database handle, a query the model wrote, any row outside the org, or any row outside the selection |

**Images and records are not retained by the provider for training.**

**A cheque photograph is the most sensitive image this product holds.** It
carries a name, an amount, a bank, an account number and a signature. That is
why reading is a disclosure with a switch rather than a feature with a button:

- It is **off entirely** until an API key is configured. With no key the
  deposit sheet still photographs the cheques — the evidence was always the
  more valuable half, and it is what answers "did Margaret really write $250?"
  three months later — and the control simply does not offer to read them.
- Each organisation can **switch it off**, in Settings → Your Data, under
  *Reading and drafting*. Default on. Off stops both features at once: they
  share one gate, because two gates would eventually disagree and the way they
  would disagree is by one of them sending something after you said not to.
- **Nothing is entered or sent until you confirm it.** A read fills the deposit
  sheet's paste box and cannot post a gift; an amount the two halves of the
  cheque disagree about lands **blank** rather than guessed. The agent shows
  you the plan, and the count of messages it would send, before anything runs.

**The cost is Steward's, not yours.** Reading and drafting are included; there
is no per-page or per-draft charge to your organisation.

## Email opens (BUILD-94 Part 4, decided 2026-09-22)

**Steward counts opens per campaign and shows nothing per person.**

A campaign's own summary says how many of its emails were delivered, how many
were opened, and how many people unsubscribed after it. Those are **counts**.
No donor's profile anywhere in the product says "opened your appeal at 6:41am",
no list can be filtered by who opened what, and no export carries it.

The mechanism, stated plainly: a tracking pixel in a campaign email records an
open against that recipient's row so the rate can be computed. That row is what
the counts are summed from. It is never rendered per person, and the Resend
`email.opened` webhook is deliberately **not** subscribed (see MANUAL-STEPS
§10), so no second per-event stream exists.

**Why the line is drawn here.** An open rate tells a fundraiser whether a
subject line worked, which is a fact about the email. "Margaret opened this
four times" is a fact about Margaret, and it is the kind of fact that changes
how somebody is treated without them ever agreeing to it being collected —
open tracking is invisible to the recipient and defeated by any modern mail
client's image proxy anyway, so it is simultaneously intrusive and unreliable.

**Turning per-person opens on is a data-handling change, not a feature.** It
would need: this section rewritten, a line in the customer agreement, and a
decision about what an organisation may see about a donor who never consented
to being measured. It is not a switch somebody flips in an afternoon.

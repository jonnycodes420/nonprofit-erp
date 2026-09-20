# Steward — data handling

What Steward stores, and who else sees it.

## Inbound email (BUILD-87 Part 3)

- An email you BCC to your organization's logging address is stored on the
  matched donor's record as plain text — subject, date and body, with quoted
  replies trimmed and attachments dropped — and the inbound mail provider that
  receives the message on Steward's behalf holds it in transit. (The provider
  has not been chosen yet; see `BLOCKED-build87.md`. This line names it as
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
  `BLOCKED-custom-domains.md`.

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

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

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

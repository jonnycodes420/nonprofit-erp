## ADDRESS-1 · A street address typed by hand, kept through a merge (2026-11-03)

- **The gap.** `donors.address` and `address2` existed, imports filled them and `PATCH /donors/:id/contact`
  saved them, but the Edit donor form had only City, State and ZIP, and `PUT /donors/:id` and `POST /donors`
  ignored the street. A person added or edited by hand could never get a street address, so their receipts and
  letters had no line to mail to.
- **What changed.** The Edit form and + Add ask for Street address and Apt, suite (optional) above City, and
  every field has a visible label (placeholders alone hid what a filled field was). `PUT` saves the two lines
  only when it is sent them, so an older caller never clears an imported street, and records the change in
  `donor_address_history`. The profile's Contact section already drew the server's full mailing line; it now
  re-reads after an edit instead of waiting for a refresh.
- **The merge screen.** It already offered the street (as "Street"); the labels now match the form. Its
  defaults were "the newer non-empty value", so a record touched yesterday won the name and address over the
  record she chose to keep. They now start on the kept record (a blank there takes the other's value), and
  swapping which is kept starts on that one's. The button read "Merge into <kept name>" even when she had
  picked the other name; it now names the result.
- **Decided, not asked.** A field the kept record leaves empty starts on the other record's value rather than
  on "(empty)", so starting the screen never drops data. The bulk merge keeps its old rule.
- **Found, not fixed (next brief).** On the compare screen, when everything that moves is in a hidden table,
  the line reads "Moves to the kept record: . Both emails and phones are kept." (an empty list).

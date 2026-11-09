# POLISH-7 · Words that match what happened (2026-11-08)

The fleet's lead report found ten places where a word disagreed with what had happened. The new rule this round was to reproduce each one first with real clicks on a production build (NODE_ENV=production, the built client) on a fixture shaped like the fleet's description (`tests/lib/polish7Fixture.js`).

- **Greetings for organisations.** `shared/greeting.js` greeted an organisation's named contact whenever one was on file, so a move's note to grants@windermere opened "Hi Ruth". A caller that knows where the note goes now passes `to`; the contact is greeted only when the address is theirs (`contactOwnsAddress`), else "Dear friends at <name>". Home's moves (`insights.js` `hello`) pass the record's email. Callers that pass no `to` are unchanged.
- **Toasts.** The write-off reused the delete toast's default, "Deleted the write-off." It now passes its own message, "Wrote off $450."
- **Audit log.** A field holding JSON text printed as quoted JSON, and counts said "(1 records)". The server's sentence calls such a value "new details" and uses `countRecords`; the screen's detail table and a person's History read objects as words (`client/src/lib/auditWords.js`).
- **Current through a household.** The tag's sentence is now the gift that keeps them Current ("Current: household gift by Marlowe Quennell, Nov 5."), and the score's hover says "no gift of their own in the last year", which is true beside it.
- **Periods.** `fyLongLabel` is the long form ("FY 2026–27 (Jul 1, 2026 to Jun 30, 2027)"); the board report and its PDF use it instead of "fiscal year Jul 1, 2026 to Jun 30, 2027". Home's goal tile and retention line no longer build "This FY …" or "FY 2027" by hand. polish7 §1 fails on any hand-built FY string in client/src.
- **One journey span.** `journeySpan(steps)` in journeyShape.js; the builder no longer computes its own.
- **Brand preview** reads the saved org name and logo. **Import choices** show email, city and last gift for each candidate (`client/src/lib/candidateLine.js`). **Campaigns**: Sent counts only campaigns that reached at least one person (`reachedAnyone`).

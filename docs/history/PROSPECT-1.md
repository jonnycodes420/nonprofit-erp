## PROSPECT-1 · Room to give (2026-10-03)

A director asks "Who could give more?" and gets names, each with why (from their own file) and how much room
there is (from a screening file, when one has come back), and a step. Room to give is one plain word (Strong,
Some, Not yet known) from nine own-file signals in `shared/roomToGive.js`; a screening file is stored as the
provider wrote it (ranges, never one number) in `screening_results` with the provider's name and the date, and can
move the word to Strong when the capacity range starts at five times what they gave in the last twelve months.
The eighth Ask why question (`more`) ranks by the word, then closeness, then room. Public filings come from
ProPublica Nonprofit Explorer only when a person presses Look up, cached in `public_filings`; a TEST_MODE server
reads `tests/fixtures/propublica` instead. The Researcher's prospect brief is assembled from rows (Steward's
record, the screening results and the filing), every line with its source, and saved to the person's files as a
major-gifts-only material. Everything is admins plus the new `users.can_major_gifts`, read live. Two tests:
`prospect1-room-to-give` (words, import, the eighth question's rows) and `prospect1-who-sees` (who sees what,
the portal, the CSV export, export and erase).

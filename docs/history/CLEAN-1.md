## CLEAN-1 · Clean data without the dread (2026-10-03)

Donors, Data health: duplicates (reasons in words, high/medium/low), addresses tidied offline, people who
moved (an NCOA file out and the provider's results back in), emails, and people with no way to reach them.
The July merge moved a hand-kept list of about 25 columns; db.js has 70 person pointers, so most tables
added since were silently left pointing at a soft-deleted record. The new merge covers all of them, foots
the money to the cent inside its transaction, and undoes exactly for 30 days. Two tests: clean1-merge (every
pointer from db.js, footing, exact undo) and clean1-duplicates (one org only; "Not a duplicate" survives an
import). What the walk caught: Undo did not appear until a reload; a test's placeholder text in a date-named
column broke the demo seed's cross-org date cast; the tidy dropped "One" from "410 Route One" until a
no-loss guard flagged it instead.

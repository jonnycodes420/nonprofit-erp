## FIX-44 · Ask stops answering with nobody, and the paid AI run is started by hand (2026-10-19)

Issue #209: the nightly real-AI run found Q01, Q04, Q06 and Q07 "answering with zero people". The counts were right
(149, 23, 10, 25); the Show me list answer carried its people as `rows` with the sentence "149 people match.", while
every other Ask answer carries `people` and `peopleCount`. A list answer now carries both, its sentence names the first
three, and an empty list names the filters that found nobody. A10 ("plan a call to everyone who gave for the first time
this month") planned 18 calls where 11 were right: the filters had only "new" (first gift in the last 12 months), so the
model paired it with "gave in October". `firstGiftFrom` (first gift ever on or after a day) is now a filter, and the
template reads "for the first time this month" itself. golden-journeys J12 and J13 were red on main.
The Nightly AI workflow lost its schedule (`gh workflow run nightly-ai.yml`); the error digest is one issue per day on
the workflow token, so FIX-38's three repo settings are no longer needed. The anonymous webhook probe's ECONNRESET did
not reproduce in 300 bad bodies; a body past the raw limit was a 500 and is now a 400, and each refusal logs one line.

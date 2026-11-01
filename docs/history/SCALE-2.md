## SCALE-2 · Every screen under a second with 20 people on at once (2026-10-13)

Measured on SCALE-1's 200-org load cluster, 20 zero-think users on 20 large orgs. Before → after, p95: shell
28.7 s → 0.7 s (24.2 MB → 457 KB), Home 28.8 s → 1.4 s, donors list 1.7 s → 0.86 s, profile 10.3 s → 1.0 s,
Drift 7.3 s → 46 ms, giving summary 10.2 s → 249 ms. Home, donors and profile still miss 800 ms: what is left is the
one Node process at a full core on one laptop, not the database (a 20-connection pool was worse).
- Part 1 (fork, 57e5624): the shell no longer reads `/donors/summaries`; pickers, counts and lookups read
  `routes/donorLookups.js` (`/donors/pick|lookup|counts|birthdays-near`, same rows and order); Team, Re-engage, Map,
  the call list and the gift import load the whole list only when opened (`lib/people.js allPeople`).
- Part 2: `orgSummary.js` stores org-wide answers per org and serves them only while no `org_changes` row (a
  statement trigger on every org_id table) is at or above the answer's snapshot xmin; `GET /home/bundle` answers
  Home's reads in-process (`inProcess.js`), so Home is two requests. A nightly check compares stored with fresh.
  Trap found by its own suite: the org-wide stewardship read writes today's metric snapshot, so the first read of a
  day lacked today's point; the upserts now write only when the value moves.
- Part 3: `donor_drift` stores the gift-derived half of each Drift answer; a gifts trigger forgets it.
- Part 4 (fork, c32f7ea): Gmail first read batches addresses up to 6,000 URL characters per search and runs as a
  queued job with "Reading your mailbox: N%": 1,505 calls / 96 s → 367 / 6 s on the stand-ins.
- Also: tenant joins (`g.org_id = d.org_id`, `i.org_id = d.org_id`) on Today's queue (560 → 67 ms), a
  match-employer index (279 ms per profile), Ask's sort parses each key once (40% of Node's CPU under load).
Suite: `scale2-same-numbers` (red on main, 12 fails). `npm run test:load` carries the targets. 300 reads compared
byte for byte against main on five orgs: identical apart from two added fields (`reading`, `onFile`).

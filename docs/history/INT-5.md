## INT-5 — a key does exactly what was ticked (2026-09-30)

BUILD-98 Part 6 shipped API keys that were read-only by construction: there were
no write routes, so `scopes: ["read"]` was a placeholder for a decision nobody
had to make. INT-5 adds writes, so the decision arrives.

**A KEY GRANTS EXACTLY WHAT SOMEBODY TICKED.** Not "read implies read everything
added later", not "write implies read". Each scope is one verb over one kind of
thing, because the person holding the key is, by definition, not the person who
has to live with the consequences: it goes to Zapier, to a consultant for one
afternoon, to a contractor's script.

**AND EVERY KEY ALREADY ISSUED KEEPS WORKING AND GAINS NOTHING.** Those keys hold
the literal scope `read` and they are sitting in somebody's Zapier account right
now. `read` stays for ever as a legacy scope that expands to every READ scope and
to no write scope, whatever is added to the registry later. Widening it would
hand write access to keys somebody granted for reading, silently, on a deploy.

**EVERY WRITE GOES THROUGH THE FUNCTION THE APP USES.** A gift recorded through
the API is written by `recordGift`, so the rollup, the fund, the receipt and the
duplicate handling all behave exactly as they do inside Steward. The actor names
the KEY (`system:api/<id>`), because "which integration created this record" is
the first question anybody asks of a row they did not expect.

**THE CALL LOG RECORDS THE ROUTE, NEVER THE FILLED PATH.** Logging
`/api/v1/people/d_abc123` would be keeping a list of donor ids in a table nobody
guards. The route is stored, the id is its own column, and the contents of a
request are never stored at all. Refusals are logged as well as successes, which
is the half somebody debugging actually needs.

**A WEBHOOK SIGNATURE WITHOUT A TIMESTAMP IS A PASSWORD SOMEBODY CAN
PHOTOGRAPH.** A bare HMAC of the body proves where a delivery came from and
nothing about when, so anyone who captures one can replay it for ever. The
timestamp is signed with the body and receivers are told to reject anything
older than five minutes. Deliveries retry with backoff for a day, every ATTEMPT
is kept (so "it failed four times and then worked" is visible), and an endpoint
that fails five times running is paused AND opens a Thread step, because a
webhook that died quietly is how an organisation finds out in March that its
automation stopped in January.

**The teardown is asked of the database rather than remembered.** `recordGift`
writes a ledger entry and a finance audit row against the org's chart of
accounts, so `accounts` outlives the gifts and blocks `DELETE FROM orgs` on the
SECOND run with an FK error that reads like a product bug. This suite was bitten
by that twice in one afternoon, so its teardown now asks the schema for every
table referencing `orgs` and deletes them in several passes. Adding a table to
the product cannot break it again.

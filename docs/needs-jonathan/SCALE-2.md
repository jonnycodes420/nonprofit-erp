## 0-SCALE-2 · ONE LOOK AT A REAL GMAIL FIRST READ, AND THE POOL (2026-10-13)

1. After SCALE-2 is live, connect a real Gmail in an org with more than 100 people who have an email (or press Read now on one that is connected). On Settings, Connections the card shows "Reading your mailbox: N%" and then the usual numbers. If the card instead names a Gmail error, set `GMAIL_QUERY_MAX=2000` on the Railway web service (it is the most characters one Gmail search may carry; unset means 6,000) and tell Claude. Nothing else is needed: Gmail's own "too long" refusals are already handled.

2. **The pool: change nothing.** After parts 1 to 3 the database connections are no longer the limit, so leave `DB_POOL_MAX` unset (10 per process) and add no read replica. Measured at 20 users on large orgs, one web process: pool 10 gave Home p95 1.4 s, pool 20 gave 6.4 s (more connections queued more work on the same CPU), with about 5 of 10 connections busy on average. The limit now is the one Node process at about 100% of a core. The step that helps is SCALE-1's 0-SCALE-1 below (a worker, then `WEB_REPLICAS=2`), because each replica gets its own CPU. That is 10 connections per web replica plus 10 for the worker; keep that total under half of the Postgres plan's `max_connections`.

---

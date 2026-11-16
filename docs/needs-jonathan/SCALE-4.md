# 0-SCALE-4 · BEFORE A SECOND WEB REPLICA: MAKE ROOM FOR ITS CONNECTIONS (2026-11-16)

Nothing to do until /ops's Capacity card says a second replica is due. Since SCALE-4 the card checks the connection budget first, and today it says a second replica **does not fit**:

- Each web process opens up to `DB_POOL_MAX` + the set-wise pool's share: 10 + 3 = 13. The worker: 5 + 1 = 6.
- A deploy runs the old and the new copy of every web replica at once.
- Worst case = web replicas × 13 × 2 + 6. One replica: **32**. Two replicas: **58**.
- Prod goes through Supabase's pooler in session mode, Pool Size **40** (POOL-1). Postgres's own `max_connections` (read live on the card) is higher on Micro (60), so the pooler is the limit. 58 > 40: a deploy with two replicas would hit "max clients reached".

One of these has to come first. Pick one; then do SCALE-3's replica steps.

## Option A · A smaller pool per web replica (free)

Railway, project nonprofit-erp, production, service `nonprofit-erp` (web):
1. Variables: set `DB_POOL_MAX=6`. That's 6 + 2 = 8 per replica: 2 × 8 × 2 + 6 = **38 of 40**.
2. Deploy, and check the Capacity card's budget line reads `1 × 8 × 2 + 6 = 22`.
3. Then SCALE-3's steps: `WEB_REPLICAS=2` and Settings → Deploy → Replicas 2.

Cost: $0. **The trade:** a request may then hold 3 connections, not 5 (`PER_REQUEST_MAX` is at most half the pool). PROFILE-SPEED-1 measured a profile open at ~1,116 ms at 3, against ~743 ms at 5. Two replicas give the web 16 connections in all instead of 13.
To undo: remove `DB_POOL_MAX` (back to 10) and Replicas 1.

## Option B · More room at the pooler ($5 a month more)

Supabase, project for prod:
1. Settings → Compute and Disk: Micro → **Small** ($15 a month instead of $10; 90 Postgres connections instead of 60).
2. Database → Settings → Connection pooling → **Pool Size 70** (58 for a two-replica deploy, plus one spare per process for a cancel, LOAD-1, plus room for Supabase's own).
3. Railway, service `nonprofit-erp` (web), Variables: `POOLER_SIZE=70`, so `npm run status` and the card read the new size.
4. Then SCALE-3's steps (Replicas 2, `WEB_REPLICAS=2`).

Cost: +$5 a month (Supabase compute, as listed on supabase.com/pricing on 16 Nov 2026). Keeps 5 connections per request.
To undo: Pool Size 40, `POOLER_SIZE` removed, compute back to Micro.

**Not an option today:** the pooler's *transaction* mode (port 6543). It would share a few Postgres connections among many clients, but Steward sets things per connection that transaction mode loses between statements: each request's `statement_timeout`, the set-wise pool's `enable_nestloop=off` startup option, session advisory locks (the queue, the nightly checks). Moving to it is a code change, not a setting.

My recommendation: **B**. It costs $5 a month and keeps the speed PROFILE-SPEED-1 chose 5 for. A is the free fallback.

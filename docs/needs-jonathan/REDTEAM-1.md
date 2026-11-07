## REDTEAM-1 · one thing is yours (2026-11-06)

1. **Turn on the database certificate check.** Every Postgres pool connects with `ssl: { rejectUnauthorized: false }` (`server/db/pool.js`, `server/shared/pools.js`): encrypted, but the server's certificate is not checked, so something on the network path could pose as the database. Download Supabase's root CA (Supabase → Database → Settings → SSL certificate) and set it on Railway as `DB_CA_CERT`; the next build switches the pools to `{ ca, rejectUnauthorized: true }` when it is present.

## REDTEAM-2 · one thing is yours: turn on the database certificate check (2026-11-07)

Today every connection to Postgres is encrypted but the server's certificate is not checked, so something on the network path could pose as the database. The code to check it is live; it waits on one variable. `npm run status` shows a yellow **db certificate NOT CHECKED** line until it is set. (This replaces REDTEAM-1's `DB_CA_CERT` step: the variable name is below.)

1. **Download Supabase's root certificate.** Supabase dashboard → your project → Project Settings → Database → SSL Configuration → **Download certificate**. It's a small text file (`prod-ca-2021.crt` or similar) that starts with `-----BEGIN CERTIFICATE-----`. It's public (it proves who the server is, it unlocks nothing), but keep it out of the repo all the same.
2. **Set it on prod web AND prod worker** (Railway → the service → Variables → New variable), on both services:
   - Name: `PGSSLROOTCERT_PEM`
   - Value: the whole file, from `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----`, pasted as is (Railway keeps the line breaks; if a field ever strips them, write each break as `\n`; both work).
   Railway redeploys each service when the variable is saved.
3. **Confirm it worked.** Once both are back up: `npm run status` shows **db certificate verified**, and `https://nonprofit-erp-production.up.railway.app/health` says `"dbTls":"verified"` and `"db":true`. If the deploy won't come up, or `/health` says `"misconfigured"`, the certificate was pasted wrong or doesn't match: delete the variable (prod goes back to exactly how it runs today) and send me the deploy log's first `[db]` line. It never contains the certificate.
4. **Staging (Railway Postgres).** Railway's own Postgres makes a self-signed certificate when it starts and publishes no CA to check it against, so there's nothing to set there for now. Leave `PGSSLROOTCERT_PEM` unset on staging web and worker; staging keeps today's behaviour (encrypted, unchecked). If Railway later publishes a CA for its Postgres, the same variable on the staging services turns the check on there too.

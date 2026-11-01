## INT-PROD-1 · PayPal and QuickBooks on production, and why guardsOk was false (2026-10-07)

- **guardsOk false on prod** was `themeAssets.dbFallbackRows: 28` with `dbFallbackSinceBoot: 0`. The count read every
  `portal_assets` row with `storage='db'` as a failed S3 put, and `scripts/seed-demo.js` writes exactly 28 of those
  on purpose (event 5, logo 1, media 16, sheetfile 3, video_thanks 1, volpage 2; the scratch seed counts the same
  28). So every prod re-seed of the demo held the paging field false with no failure anywhere. Now the S3-put catch
  stamps `s3_fallback`, and only those rows count. `/health.guardsFailed` names each failing guard (names only),
  and `npm run status` prints it. Guarded by `tests/int-prod-1-guards.test.js`, red on main's query.
- **QuickBooks:** the Vercel callback was checked live: 200, no redirect, query string intact, SPA at the current
  SHA. State is HMAC-signed with JWT_SECRET and checked in `POST /oauth/intuit/complete` on Railway, so the split
  hosts do not matter. Added `POST /qbo/preview` (company info, five customers, five payments; GETs only) with a
  "What Steward can see" block and a Disconnect button in the panel, which had none. The "Sandbox until Intuit's
  review" note is gone when `INTUIT_API_BASE` is production. parity2-qbo-sync §8 proves the preview writes nothing.
- **PayPal:** `scripts/verify-paypal.js` (token + Transaction Search, counts and totals only). int1-paypal-webhook §7
  proves a real signature made for another webhook id is refused. Note: nothing in the app reads
  `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`; orgs connect with their own pair. Only the script uses them.
- **Xero:** `accounting.transactions` became `accounting.banktransactions` (a deposit is a RECEIVE bank
  transaction). Still held; no connection has ever existed, so no one reconnects.

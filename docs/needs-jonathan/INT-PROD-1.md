## 0-INT-PROD-1 · PAYPAL AND QUICKBOOKS ON PRODUCTION, IN THIS ORDER (2026-10-07)

1. **PayPal:** `railway run node scripts/ops/verify-paypal.js --i-know-this-is-prod`. It prints the base, a token line,
   then counts and totals for the last 30 days. If it says Transaction Search was refused: developer.paypal.com,
   Apps & Credentials, Live, the Steward app, Features, tick **Transaction search**, Save, wait, and run it again.
2. **QuickBooks:** the ten-minute walk in `docs/int-prod-1/qb-walk.md` (turn sync on for TEST STEWARD in /admin,
   Connect, Read from QuickBooks, Disconnect). Do not press Sync.
3. **Xero (when you build the app):** request `accounting.banktransactions` and `accounting.settings.read`. Nothing
   to set today: Xero stays held and no org has ever connected it, so nobody has to reconnect.

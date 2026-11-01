## 0-FIX-33 · GOOGLE CONNECT: FOUR SETTINGS, IN THIS ORDER (2026-10-07)

The "Too many redirects" loop is fixed in code (the forwarders no longer read `APP_URL`, which on Railway is the
API host itself). These make Google's screens say Steward at stewardapp.dev and land the callback on the app:

1. **Google Cloud → APIs & Services → OAuth consent screen → Branding:** App name `Steward`; User support email
   `jonathan@stewardapp.dev`; Application home page `https://www.stewardapp.dev`; Application privacy policy link
   `https://www.stewardapp.dev/privacy`; Application terms of service link `https://www.stewardapp.dev/terms`;
   Authorized domains: add `stewardapp.dev`; Developer contact `jonathan@stewardapp.dev`. Save, then press
   "Verify branding" so the name shows instead of a domain.
2. **Google Cloud → Credentials → the OAuth 2.0 web client:** Authorized JavaScript origins add
   `https://www.stewardapp.dev`; Authorized redirect URIs ADD `https://www.stewardapp.dev/oauth/google/callback`
   (keep the Railway `/gmail/callback` line until step 3 is live, then delete it).
3. **Railway → nonprofit-erp → Variables:** `GOOGLE_REDIRECT_URI` = `https://www.stewardapp.dev/oauth/google/callback`
   (today it is `https://nonprofit-erp-production.up.railway.app/gmail/callback`).
4. **Then connect Gmail once** from Settings → Connections and walk `docs/fix-33/real-walk.md` (15 minutes).

**Outlook's "not read yet":** after this deploy the card shows the real last read or the error in one sentence. If it
still says "hasn't been able to read", press Reconnect on the card once (Steward never logged why the old runs
stopped, and FIX-33's run rows will). `npm run status` now fails while any connection is over two hours stale.

**One rule for you to decide (FIX-33 import scorecard):** 320 gift rows ($314,776.19) in the 1,000-donor file read
`20/10/2023` in a column whose other slash dates are month first. Today they are refused with their line numbers.
Reading a first number over 12 as the day is unambiguous but changes the BUILD-80 written rule. Say yes and it ships.

## 0-CONNECT-2 · FIVE CONNECTIONS, WHAT ONLY YOU CAN SET UP (2026-10-11)

1. **Givebutter, Zeffy:** nothing to register. On the first real org's first check, compare one gift with Givebutter's own screen (amount units are not stated in Givebutter's docs; `docs/connect-2/givebutter-walk.md`).
2. **Square OAuth:** a production Square application, redirect `https://www.stewardapp.dev/oauth/square/callback`, then Railway `SQUARE_APP_ID`, `SQUARE_APP_SECRET`, `SQUARE_REDIRECT_URI`. Until then an org pastes a production access token.
3. **Constant Contact:** a v3 app at developer.constantcontact.com, redirect `https://www.stewardapp.dev/oauth/constantcontact/callback`, then Railway `CONSTANT_CONTACT_CLIENT_ID`, `CONSTANT_CONTACT_CLIENT_SECRET`, `CONSTANT_CONTACT_REDIRECT_URI`.
4. **Xero:** a Web app at developer.xero.com, redirect `https://www.stewardapp.dev/oauth/xero/callback`, then Railway `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`. Never set `XERO_API_BASE` on Railway. Walk it against the Xero Demo Company: Sync writes.

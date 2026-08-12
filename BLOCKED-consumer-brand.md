# BLOCKED — consumer-surface name (founder decision)

The cross-org donor dashboard is Steward's consumer surface. It ships under
the placeholder **"Steward — Your Giving"**. Renaming it is ONE commit; every
place the string lives:

1. `server.js` — `const CONSUMER_BRAND` (used in every account-lifecycle email
   subject/body and the /account/* JSON `brand` field).
2. `client/src/pages/GivingDashboard.jsx` — `export const CONSUMER_BRAND` +
   the header wordmark ("Steward" + "Your Giving" sub-label).
3. `server.js` `consumerEmailHtml()` — the email header wordmark ("Steward" /
   "Your Giving").
4. The URL path `/giving` (routes in `client/src/main.jsx`, links in the
   lifecycle emails, `BLOCKED`/audit docs). A rename of the PATH also touches
   `vercel.json` (`/account-api`, `/network-api` untouched) and the emailed
   links — decide the path at the same time as the name.
5. Donor-facing privacy sentence (GivingDashboard footer + signup email):
   currently unbranded ("Each nonprofit sees only its own relationship with
   you…") — safe under any name.

Recommendation: decide before any donor-facing launch (the flags are OFF in
prod, so nothing is public yet); the name lands in emailed subjects, which are
the hardest thing to re-teach donors later.

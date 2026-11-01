## 0-SECURE-2 · FOUR THINGS ONLY YOU CAN DO (2026-10-29)

- **Sentry → each project (backend, frontend) → Settings → Security & Privacy:** turn on "Data Scrubber", "Use Default Scrubbers" and "Prevent Storing of IP Addresses". Steward already strips these before sending (redact.js); this is the second lock.
- **After the deploy, open www.stewardapp.dev signed in and look in the browser console for "Refused to".** The new script CSP is enforced; if `VITE_SENTRY_DSN` points anywhere but `*.sentry.io`, its host must be added to `connect-src` in vercel.json.
- **The DPA:** have an attorney read `docs/security/dpa-draft.md`. It and the security page promise customers word within 72 hours; `shared/dpa.js` (/dpa) still says "without undue delay". Pick one. It lists file storage under Railway; if prod's `PORTAL_ASSETS_S3_ENDPOINT` is really AWS, add AWS.
- **Say yes or no to SECURE-3:** `docs/security/cookie-plan.md` (the session moves to an httpOnly cookie; synced mail sealed at rest).

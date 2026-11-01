## 0-SECURE-1 · THREE SETTINGS ONLY YOU CAN CHANGE (2026-10-28)

- **If not done since the Railway breach of 21 Oct: rotate what lives in Railway's Variables.** Railway → nonprofit-erp → production → Variables: new `JWT_SECRET` (`openssl rand -base64 48`; everyone signs in again), then the Stripe, Resend and Anthropic keys from each dashboard. Nothing in git history held a real key (SECURE-1 scan), so this is about Railway, not the repo.
- **Supabase → Project Settings → Database:** turn on "Enforce SSL" and, under Network Restrictions, allow only Railway's egress (or note why not). Confirm Point-in-time recovery is on.
- **Before a fourth paying org:** book an outside penetration test (a web app + API test, about 5 days). Send them `docs/security-summary.md` and the route inventory (`node scripts/ops/build75-route-inventory.js` writes it to `.generated/route-inventory.json`).

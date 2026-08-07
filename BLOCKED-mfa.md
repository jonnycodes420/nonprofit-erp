# BLOCKED — MFA for admin/owner roles (BUILD-37 §A10)

## Finding

No multi-factor authentication exists for any role, including admin. Auth is email + bcrypt(12) password → 7-day JWT. An admin account is one leaked/reused password away from full org access (donor PII, giving records, exports, billing).

Per §A10, MFA is **not to be built in this pass** — this file is the scoped estimate.

## Scope of a v1

Recommended: **TOTP (authenticator app)**, optional per-user, **enforceable for admins** by org policy. Not SMS (SIM-swap) for v1.

- **DB:** `users.totp_secret` (encrypted at rest), `users.mfa_enabled BOOLEAN`, `users.mfa_backup_codes` (hashed). Optional `orgs.require_mfa_for_admins BOOLEAN`.
- **Enroll:** `POST /me/mfa/setup` → generate secret + otpauth URL + QR; `POST /me/mfa/verify` confirms a code before enabling; issue one-time backup codes.
- **Login:** when `mfa_enabled`, `/auth/login` returns a short-lived `mfa_pending` challenge instead of the JWT; `POST /auth/login/mfa` verifies the TOTP (with replay-window guard) and issues the real JWT. Rate-limit the MFA step per-account.
- **Disable/recover:** require current password + a valid code (or a backup code) to disable; backup-code consumption is single-use.
- **Client:** enrollment UI in Settings › Account; a second step on the login page; admin-policy toggle in Settings › Team.
- **Library:** `otplib` (TOTP) + a QR generator. No new infra.
- **Interaction with FINDINGS A5:** pairs naturally with the session-epoch work in `BLOCKED-session-revocation.md` — enabling MFA or changing the factor should bump the epoch.

## Estimate

~1.5–2.5 days for a solid TOTP v1 with backup codes, admin-enforcement policy, tests (enroll → login-challenge → verify → backup-code → disable, org-scoped), and the login-page/Settings UI. SMS/WebAuthn are separate, later.

## Recommendation

Prioritize enforceable admin TOTP before the first paying org with real donor data. It closes the highest-likelihood real-world account-takeover path (credential reuse) that neither rate-limiting nor the A5 fix addresses.

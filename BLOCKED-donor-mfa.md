# BLOCKED — donor-account MFA (TOTP), specced not skipped

BUILD-46 §1.1 allows optional donor-enabled TOTP but caps it at a day; the
core build (accounts, linking, the wall, the gate) consumed the build window,
so MFA ships as this spec + schema stubs rather than silently disappearing —
a board member WILL ask.

## Already in place
- `donor_accounts.mfa_secret` / `mfa_enabled_at` columns (nullable) exist.
- Session + audit machinery the flow plugs into (`donor_account_audit`,
  `revokeAccountSessions`) exists and is tested.

## The build (est. half a day + review)
1. TOTP per RFC 6238, HMAC-SHA1, 30s window ±1 step — implementable in ~30
   lines of node:crypto (no new dependency), or `otplib` if a dep is preferred.
2. `POST /account/mfa/setup` (authed) → generate secret, return
   `otpauth://totp/Steward:{email}?secret=…&issuer=Steward` for the QR +
   the secret for manual entry. Store UNCONFIRMED.
3. `POST /account/mfa/confirm {code}` → verify one live code →
   `mfa_enabled_at = NOW()`, generate 8 single-use recovery codes
   (hash-at-rest, new `donor_account_recovery_codes` table), return them ONCE.
4. Login flow: password OK + MFA enabled → 200 `{mfaRequired: true}` with a
   short-lived (5 min) challenge token; `POST /account/login/mfa {challenge,
   code}` mints the session. Magic-link sign-in: policy decision needed —
   recommendation: magic link BYPASSES TOTP (it is already an email-factor
   proof, and blocking it strands donors who lose their phone); note this in
   the donor-facing copy.
5. `POST /account/mfa/disable {code|recoveryCode}` — audit-rowed.
6. Rate limits: 5 code attempts / 5 min per account, then lockout window.
7. Suite: setup/confirm/login-challenge/wrong-code/recovery-code/disable +
   burst, added to `donor-accounts.test.js` or its own file in run-all.

## Decision needed from you
- Magic-link-bypasses-TOTP (recommended) vs magic-link-also-challenged.
- Dependency stance: hand-rolled RFC 6238 vs `otplib`.

## FIX-AUTH — a revoked session is refused, and the client acts on it (2026-09-28)

Jonathan opened stewardapp.dev and got "Failed to connect · Your session is
no longer valid — please log in again · Retry". The server was fine. Health
was ok, CORS answered for both the apex and www, the login route worked and
`requireAuth` returned every code correctly. The words on that screen were
`requireAuth`'s own `session_revoked` message, rendered on the OUTAGE screen.

**The client held an allowlist of three codes and the server returns six.**
`token_expired`, `invalid_token` and `no_token` were on it; `session_revoked`,
`user_not_found` and `account_deactivated` were not. For those three the stale
token was never cleared and nobody was ever sent to `/login`, so the app sat on
a screen whose Retry button could not possibly work. `sessions_valid_after` is
a SECURITY CONTROL — a password change, a role change, a removal and a
deactivation all bump it — and the product was declining to act on it.

**So the rule is inverted, and it cannot rot.** If we sent a token and the
answer was 401, that token cannot be used, whatever the server chose to call
the reason. A seventh code tomorrow is handled the day it ships. The codes now
choose only the wording, and an unknown one falls through to a general
sentence.

**And a sign-out is not an outage.** The 401 cleared the session and started
the navigation to `/login`, and then `apiFetch` threw anyway; the throw landed
in `loadData`'s catch, which set `loadErr`, which painted "Failed to connect"
over a redirect that was already on its way. `App.jsx` checks
`leavingForLogin()` BEFORE that branch now and says "Taking you to the login
page", which is what is actually happening.

**Reproduced before it was fixed, and after.** A real signed token, revoked the
way a password change revokes one, driven through a browser at 390 and 1440:
before, both widths showed the screenshot byte for byte with the token still in
storage; after, both land on `/login` with the session cleared and the
explanation on the login page where it belongs.

**What the suite caught about itself.** "Failed to connect" appears in a
comment four hundred lines above the branch that renders it, so an assertion on
the string was red for a reason that had nothing to do with the order of the
branches. It pins the branch, not the words.

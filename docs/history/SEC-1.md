## SEC-1 · two-factor sign-in and sessions (2026-10-01)

BUILD-98 had the authenticator code and an admins-only switch. SEC-1 is the
rest: a code by email, ten recovery codes shown once and stored hashed, trust
this browser for 30 days (off by default), five wrong codes lock code entry for
15 minutes and email the person, an owner switch that requires two-factor for
everyone, super-admins always, an owner reset that emails the teammate who and
when, and sessions as rows. Every token carries its session id and auth.js
checks it on every request, so a session signed out in Settings is refused on
its very next request (sec1-two-factor). TOTP stays on Node's crypto
(totp.js, RFC vectors); no library was added.

**THE INT2-SEND-ONCE FLAKE WAS THE SUITE REVOKING ITSELF.** Its reset() deletes
and re-creates its admin, and a new users row's `sessions_valid_after` defaults
to now, so the token from the first sign-in died whenever the run had crossed
two seconds by section 7. A loaded CI shard crossed it; a quiet laptop did not.
It signs in again after every reset now. With sessions as rows the old version
fails at once, which is the same bug made deterministic.

Two things the battery taught: a table that references `orgs` must cascade or
every suite that deletes its fixture org dies in teardown; and a fixture
super-admin now enrolls in two-factor through the real setup flow in
tests/helpers.js rather than any test-only bypass.

## INT-OAUTH — the Connect buttons actually connect (2026-09-29)

INT-1, INT-POS and INT-2 each shipped the data side of a connection and stopped
at the handshake, because the handshake needed a developer account nobody had
yet. FIX-8 Part F went looking for the authorize route and found there wasn't
one, for any provider. This build is that one missing piece: `shared/oauth.js`
is one registry (Xero, Intuit, Square) with one state format, one authorize-URL
builder and one token exchange, so a fifth provider is an entry and nothing
else. A request cannot widen what is asked for, because the scopes come from
the registry and not from the caller. Square's are five read-only scopes and
nothing with WRITE in its name.

**The callback could never have fired as first written, and the reason is worth
keeping.** It was `GET /oauth/:provider/callback` behind `requireAuth`. A
provider's redirect is a plain browser navigation with no Authorization header,
so it would have been a 401 every time; and it wrote, which the standing rule
forbids on a GET. Both problems have one answer: the provider lands the person
on the **app** (`/oauth/:provider/callback`, a real page), and the app finishes
the job with an authenticated POST to `/oauth/:provider/complete`. That is not
a workaround. It is what makes the wall mean anything — by the time the server
checks the signed state against a signed-in admin, there is one to check.

**The state carries three facts and is signed: the org, the admin, and a
nonce.** Without the org, an admin of org A could start a flow and have org B's
tokens land on A's row. `tests/oauth-state.test.js` is the one test this build
earned and it pins exactly that: a missing, unsigned or wrongly signed state is
refused; a validly signed state replayed by another org is refused; a colleague
in the same org cannot finish somebody else's sign-in; the state is single-use
and expires; after every refusal no connection row and no token exists anywhere;
and org A's sealed tokens will not open under org B's binding, so a row copied
between tenants is unreadable rather than useful. Proven able to fail twice:
removing the org/user check turns §2 and §3 red, and fixing the AAD to a
constant turns §7 red.

**Three defects the build found in its own earlier work.** The provider key and
the stored vendor key disagreed — OAuth calls it `intuit`, `shared/bookkeeping.js`
calls it `quickbooks` — so a finished connection would have been filed under a
vendor no screen reads; the registry now spells the stored key out. The Xero
tenant was going to be guessed: a Xero login can hold several organisations and
consent does not say which, so one is chosen for you and more than one is a
question, checked against Xero's own live list rather than taken from the
browser. And the send path had no Authorization header at all, because until
today there was no token to put in one; it now asks `accessTokenFor`, which
refreshes five minutes before expiry and once more on a 401, re-sealing the
whole bag because a refresh usually rotates the refresh token too.

**A connection that holds no sealed credentials still sends unauthenticated**,
which is how INT-2's mock and every sandbox works, and how every org sat before
today. Making the token unconditional turned `int2-send-once` red, which is the
suite doing its job. The demo is the same shape on purpose and now asserts it:
`seed-demo.js` refuses outright if `org_b72demo` holds a single set of provider
credentials, because a real token reaching the demo org would be a real
organisation's books behind a public login.

The tenant matrix's §1 coverage gate caught the three new parameterized routes
on the first run, which is FIX-9's repair of `readSource.js` paying for itself a
second time. `:provider` is an enum from a fixed registry, not a row id, so it
took a reasoned `PARAM_EXEMPT` entry pointing at the suite that actually proves
the tenancy. 51 suites green, tenant matrix 47/47, one known skip (the portal
tab, hidden from the CRM).

Also fixed: `OAuthCallback.jsx` hand-rolled a palette and the brand guard caught
two hexes inside a minute — `publicTheme.js` exists precisely to stop that, and
the page takes its tokens from there now. A stale `node server.js` from the
finished AGENTS-1 worktree was holding the mail sink's port and made two suites
red for reasons that had nothing to do with the code; that is the `:4173`
squatter again, wearing a different port.

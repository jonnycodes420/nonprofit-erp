# Plan: the session token to an httpOnly cookie, and synced mail sealed at rest

*SECURE-2, 29 October 2026. Jonathan said yes to both parts on 30 Oct.*

> **Status (SECURE-3, 1 Nov 2026).** Part 1 **Release A is built**: the server sets `steward_session`
> (and `steward_support`) beside the token, accepts either, and checks CSRF on cookie writes
> (`server/auth/sessionCookie.js`). The client still sends Bearer from `npe_token`, and now sends
> `credentials: "include"` so the cookie is kept. `api.stewardapp.dev` is live on Railway.
> **Release B is not built**: it is a later brief, no sooner than seven days after the app's
> `VITE_API_URL` becomes `https://api.stewardapp.dev`. Part 2 is built (see below).
>
> Two changes from the plan as written: (1) the CSRF defence is the header **and** a per-session
> token (`X-Steward-CSRF`, an HMAC of the session id, handed back on every authenticated answer
> as a response header), because the brief asked for both; (2) the cookie is host-only on
> `api.stewardapp.dev` (no `Domain=stewardapp.dev`). The page and the API are same-site, so
> SameSite=Lax still sends it, and no other subdomain receives it.
>
> **Rollback of Release A:** revert the PR. Nobody is signed out, because the client still uses
> the Bearer token. Leaving `VITE_API_URL` on the new host is fine either way: it is the same
> server.
>
> **Release B, for the brief that builds it:** `getToken()` and the ~40 places that read
> `npe_token` go (one helper); the fetch wrapper adds `X-Steward-CSRF` from the last response
> header and retries once on `csrf_token_invalid`; `deliverSessionCookie` drops `token` from the
> body when the request has an Origin header; support sessions return through the
> `steward_support` cookie (ending support clears only that one); the browser legs in `tests/`
> and `scripts/ops/` sign in with `ctx.addCookies` instead of `localStorage.npe_token`; boot
> deletes a leftover `npe_token`.

## Part 1 · The session token moves to an httpOnly cookie

### Why

Today the session is a 7-day JWT (`auth.js signToken`) kept in `localStorage.npe_token` and sent
as `Authorization: Bearer`. Any script that runs on www.stewardapp.dev can read it and take the
account (the SECURE-1 SVG hole was exactly this). SECURE-2's script CSP makes that much harder; an
httpOnly cookie makes the token unreadable to script at all.

### What moves

- **Server.** `/auth/login`, `/me/mfa/enable`, `/auth/register`, `/auth/register-org`,
  `/auth/invite/accept`, `/me/sessions/sign-out-others`, `/me/password` and every other route that
  hands back a `token` also set it as a cookie: `steward_session`, `HttpOnly; Secure;
  SameSite=Lax; Path=/`, `Max-Age` matching the JWT. `/auth/logout` clears it.
  `requireAuth` (`auth.js`) reads `Authorization: Bearer` first (API keys, tests, the mobile
  paths) and falls back to the cookie. The JWT itself, the session row (`user_sessions`, `sid`),
  `sessions_valid_after` and two-factor are unchanged.
- **Domains.** The app is on www.stewardapp.dev and the API on Railway's own domain, so a cookie set
  by the API is third-party to the page and Safari will drop it. The API needs a first-party name:
  `api.stewardapp.dev` (a CNAME to Railway), with the cookie on `Domain=stewardapp.dev`. CORS already allows credentials (server.js). **This is
  the one step that needs Jonathan** (DNS and Railway custom domain).
- **Client.** `client/src/api.js` and the roughly thirty other places that read
  `localStorage.npe_token` (grep `npe_token`: LoginPage, InvitePage, SignedUpPage, SecurityPanel,
  AdminDashboard, ReportBuilder, the volunteer pages, PortalEditor, OAuthCallback and others) send
  `credentials: "include"` and stop attaching the header. One helper replaces the scattered reads.
  The client keeps a non-secret "signed in as" marker for the shell to draw before `/me` answers.
- **Not moved.** The donor portal and donor accounts (their own tokens), API keys, webhooks, the
  internal 2-minute tokens (`signInternalToken`) and the 30-day trusted-browser token (already only
  a hash on the server) stay as they are.

### CSRF: the X-Steward-Org header doubles as the defence

A cookie is sent by the browser on its own, so another site could make a signed-in browser POST
to us. Two layers stop that:

1. **SameSite=Lax.** The cookie is not sent on a cross-site POST, PUT, PATCH or DELETE at all.
2. **The header.** HARDEN-1 already makes the SPA send `X-Steward-Org` on every authenticated
   write (`client/src/lib/orgBinding.js`, one wrapper on fetch), and `middleware/orgBound.js`
   checks it. Today a write with no header passes (API keys, webhooks, an old client). Under the
   cookie, the rule becomes: **a write authenticated by the cookie must carry `X-Steward-Org`, and
   it must match the session's org.** A custom header cannot be set cross-origin without a CORS
   preflight, and our CORS list refuses other origins, so a forged form or image cannot send it.
   Writes authenticated by a Bearer header (API keys, tests) are unchanged. One rule in one seam;
   no token to mint or rotate.

GETs change nothing (standing rule), so they need no CSRF check.

### What signs everyone out

- **Nothing, if it ships in two steps.** Release A: the server sets the cookie *and* returns the
  token as today, and accepts either. Every sign-in from then on has both. Release B (a week
  later, after the 7-day JWTs from before A have expired): the client stops reading `npe_token`
  and deletes it.
- **Everyone, once, if it ships in one step**, because existing sessions live only in
  `localStorage`. Acceptable but avoidable.
- Rotating `JWT_SECRET` at the same time would sign everyone out regardless; don't combine them.

### Rolling it back

Release A is the rollback point: the server still accepts Bearer, so reverting the client to
release A's build restores the old behaviour with no one signed out. After release B, a rollback
is "redeploy release A's client"; people signed in only by cookie keep working because the
server still reads the cookie. Removing the cookie path from the server is the last step, and only
if we abandon the move.

### Tests that would guard it

The tenant matrix and `tests/security.test.js` gain: a cookie-only write without `X-Steward-Org`
is refused; with a mismatched org it is refused; a cross-site form POST (no header) is refused;
`document.cookie` in the walk does not contain the session.

## Part 2 · Synced mailbox content sealed at rest

### What is stored today

A Gmail or Outlook read (`syncMailboxRun`, server.js) writes each matching message as an
`interactions` row with `type='email'`: the message body goes in `note`, and the subject, thread
key and provider in `metadata`. The mailbox tokens are already sealed
(`mailbox_connections`, `shared/secretBox.js`, AES-256-GCM, per-org `aad`). The message text is
not: anyone with read access to the database sees it in plain text.

### The plan

- Seal `note` (and `metadata.subject`) for synced mail with `secretBox.seal(text, { aad:
  "mail:" + orgId + ":" + interactionId })`, in a new column `note_sealed`, with `note` left as a
  short unsealed line ("Email with Ana Ruiz, 3 Oct") so lists, the timeline and search on
  people still work.
- One reader opens it: the profile's timeline and the conversation view call `open()` for rows
  the signed-in person may see. Nothing else reads the body (Atlas, the AI switch and
  `clientSafe` screening already run before the write and keep working on the plaintext in
  memory).
- Backfill existing rows in batches by a script Jonathan runs, idempotent, logging counts only.
- **What it costs.** Full-text search inside email bodies stops working (subjects too, if sealed).
  A lost `STEWARD_CREDENTIAL_KEY` makes every sealed body unreadable, the same as connections
  today; the key's backup becomes more important.
- **What it protects.** A database dump, a leaked backup or a read-only SQL session no longer
  shows mail content. It does not protect against a compromised running server, which holds the
  key.
- **Rollback.** Keep `note` writes in parallel for one release; un-sealing is the backfill run in
  reverse.

## Decision needed

Yes or no on each part. Part 1 also needs `api.stewardapp.dev` pointed at Railway (one line in
`NEEDS-JONATHAN.md` when he says yes).

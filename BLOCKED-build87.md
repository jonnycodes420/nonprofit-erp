# BLOCKED — BUILD-87

## P3-1 · Who receives the inbound mail, and the DNS that points at them

**Status: the whole inbound path is built, tested and SWITCHED OFF.** Nothing
about production changes until `INBOUND_EMAIL_ENABLED=1` is set, and with it
unset `POST /inbound-email` answers the same 404 as any unknown route.

**Why this stops here rather than guessing.** Choosing a provider to receive
donor correspondence is (a) a new subprocessor — a third party that would hold
the text of emails between a development officer and her donors — and (b) a
DNS change on a domain that already carries two live mail configurations. Both
are decisions about *what leaves the system*, and the build's own rule is to
stop rather than guess on exactly that. The code is written provider-agnostic
so that making the decision costs an adapter, not a rewrite.

### The candidates (neither is chosen)

1. **Resend inbound**, if it exists on this account. Steward already sends
   through Resend, so it is already a subprocessor and the data-handling
   disclosure would not grow by a name. Confirm the feature is actually
   available on the current plan before counting this as an option.
2. **A Postmark inbound webhook.** Postmark's inbound parsing is mature and
   posts a JSON payload with `To`, `From`, `Subject`, `TextBody`, `HtmlBody`
   and a separate envelope recipient — a near-direct fit for the normalized
   payload below. It would be a NEW subprocessor and must be named in
   `steward-data-handling.md` before it receives a single message.

### The DNS constraint, stated exactly

- `stewardapp.dev` (root) carries **Microsoft 365 MX records**. Do not touch
  them.
- `send.stewardapp.dev` carries **Resend** (the outbound sending domain).
  **The outbound sending domain must NOT change.** The nudge email's deliverability
  reputation was earned over months and is not to be risked for a logging
  feature.
- Therefore the inbound domain must be a **THIRD subdomain** — `log.stewardapp.dev`
  or similar — with its own MX pointing at whichever provider is chosen, touching
  neither existing MX record.

### What a human must do to switch this on

1. Decide the subprocessor (one of the two above, or another) and record the
   decision.
2. Name it in `steward-data-handling.md`, replacing the placeholder phrase
   "the inbound mail provider".
3. Add MX (and any provider verification records) on a new subdomain. Do not
   edit the root or `send.` records.
4. Set on the server: `INBOUND_EMAIL_ENABLED=1`,
   `INBOUND_EMAIL_DOMAIN=log.stewardapp.dev` (whatever the subdomain is), and
   `INBOUND_EMAIL_SECRET=<a long random string>`.
5. Configure the provider's inbound webhook to POST to `/inbound-email` with
   header `x-inbound-secret: <that string>`, mapping its payload to the shape
   below. **With the flag on and no secret set the route answers 503, on
   purpose**: an unauthenticated writer into donor records is worse than a
   feature that is off.

### The normalized payload the webhook accepts

```json
{ "to": "...", "cc": "...", "envelopeTo": "...",
  "from": "...", "subject": "...", "text": "...", "html": "...", "date": "..." }
```

`to`/`cc`/`envelopeTo`/`recipient`/`bcc` are all read for the logging address,
because a BCC is invisible in the headers and usually arrives only as an
envelope recipient. Everything else — slug extraction, donor matching, the
quoted-reply stripper, the 10,000-character cap — is pure and lives in
`shared/inboundEmail.js`.

### Not done, and deliberately

- **No DNS record was added, no provider account was created, no subprocessor
  is named as chosen.**
- Attachments are dropped rather than stored. Storing files that arrive over an
  unauthenticated mail path is a separate decision with a different blast
  radius, and it has not been made.

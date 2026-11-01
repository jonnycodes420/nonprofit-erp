## CONNECT-2 · Givebutter, Square and Zeffy ready for a first org; Xero and Constant Contact built (2026-10-11)

Built as three parallel parts (sources here, Constant Contact and Xero in their own worktrees), one
suite `tests/connect2-sources.test.js` running `tests/connect2/{sources,constantcontact,xero}.js`
against stand-ins built from each provider's published reference. Walk docs in `docs/connect-2/`.

- **Two money defects found by checking the docs, not the code.** Zeffy's API sends `amount` in
  CENTS; 89c's adapter read dollars, so every Zeffy gift would have landed 100x too large. And the
  BUILD-92 cross-source sentinel was a NUL byte passed as a SQL parameter: Postgres refuses it
  (22021), so every provider row WITHOUT an email failed the whole check and left an orphan donor.
- **One bad row never breaks the run.** `syncSource` catches per row; adapters hand back rows they
  refused for a row problem (`listSkip`); the run summary carries `skipped` by id with the reason,
  and the tile lists them.
- **Never twice.** The cross-source question now also matches a gift Steward's own Stripe recorded
  (no source, a payment id), and a payment imported earlier from the provider's own export (bare
  id, same cents) takes the API's key instead of a second gift. `sourcesRideTogether` refuses
  null ids, because null === null read as "one stack".
- **Email, then name.** A row with no email lands on the ONE person of that exact name who has no
  email of their own; two people of the name, or a different email, still makes a new record.
- **Ask me each time is real:** `needsFund` on each source, `POST /giving-sources/:id/fund`.
- **Square:** the location gate had no screen at all, so a real Square org imported nothing.
  `POST /giving-sources/:id/square-locations` reads Square's locations; the tile picks them. An
  OAuth Square token is renewed through the one seam (`accessTokenFor`, now exported).
- **Constant Contact:** token URL moved to authz.constantcontact.com; opt-outs paged; campaigns and
  per-person opens/clicks/opt-outs through `/tracking/*` sharing Mailchimp's writer; the push skips
  anybody the tool reported unsubscribed in the same run (sign_up_form can re-permission).
- **Xero:** `xeroSync.js`, one RECEIVE BankTransaction per gift on Sync, claimed first, an
  Idempotency-Key under Xero's 128-character limit, auto-sync off until every fund is mapped.

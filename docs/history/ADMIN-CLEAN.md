## ADMIN-CLEAN · The admin console and Metrics show only what's real (2026-10-11)

- **One kind per org** (`orgKind.js`): customer, prospect_trial, demo, internal_test, fixture. `orgs.org_kind` when
  somebody set it (in /admin or by the cleanup script), otherwise `inferKind` reads it from facts and says why: the
  demo flag or one of the two demo ids, a walk or verify name, every login a test address, a paid invoice, every
  login Jonathan's (a `+alias` of his address or `@stewardapp.dev`), a junk name, an active subscription.
- **MRR is what Stripe charges.** The billing webhook writes `orgs.billing_mrr_cents` from the subscription's items
  and one `platform_payments` row per paid invoice ($0 trial-start invoices are not payments). The old `PLAN_MRR`
  list-price table is gone; it is why Harborlight and CREO read as $998 of revenue. Churn also read `cancelled`
  while the webhook writes `canceled`, so real churn always showed 0.
- **Metrics and Overview count customers and prospect trials only**, every headline opens its rows
  (`rows.mrr`, `rows.paying`, ...) and foots, and one line says how many orgs were left out and of which kind.
  Paying customers and MRR by month come from paid invoices, against a plan line (default 8 by Dec 2026, then 5 net
  new a month through 2027; `POST /admin/metrics/target`, stored in `admin_settings`).
- **Archive** (`/admin/orgs/:id/archive`, undo `/unarchive`) hides an org from the list and Metrics. **Delete**
  refuses an org with a Stripe subscription, a paid invoice or a real donor (409 with the reason) and asks twice:
  the second time is the org's own name (`confirmName`).
- **Billing mail** is refused for a set kind of demo, internal_test or fixture (`mailPolicy.js` rule 5a), and the
  trial-ending sweep skips them.
- **`scripts/admin-clean.js`**: dry run prints ACTION, KIND, ORG ID, NAME (why); `--apply` writes each kind, archives
  and deletes (each delete in its own transaction, the guard re-read inside it; a delete that cannot finish rolls back
  and archives instead), one fin_audit_log row each. Duplicates are never merged: level twins print DECIDE with their
  logins, last sign-in and Stripe state until Jonathan names one with `--archive=`. It never writes the two demo orgs.
- Test: `tests/adminclean-metrics.test.js` (43). Against main's routes it fails 18, including the demo org's $499 and
  a subscribed org that DELETE removed.

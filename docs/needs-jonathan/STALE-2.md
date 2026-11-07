# STALE-2 · what needs Jonathan

- Run `node scripts/ops/stale2-event-line-orphans.js` against prod (a dry run: org ids and counts only), then with `--apply` if the counts look right. It removes "Registered for" / "Came to" lines whose guest is gone, one audit row per org; `--undo=<audit id>` puts an org's lines back. org_creo is skipped. Needs `--i-know-this-is-prod`.

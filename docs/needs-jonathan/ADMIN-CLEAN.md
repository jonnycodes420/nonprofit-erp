## 0-ADMIN-CLEAN · SORT THE 30 ORGS ON PROD (2026-10-11)

1. **Dry run** (after the ADMIN-CLEAN deploy, which adds the columns), from `~/nonprofit-erp` after `git pull`:
   `railway run -- node scripts/ci/admin-clean.js --i-know-this-is-prod`. It writes nothing. Read every line: ACTION, KIND, ORG ID, NAME (why).
2. **Say which CKRH org Sarah uses.** The DUPLICATES block lists both orgs' logins, last sign-in and Stripe state. Add
   `--archive=<the other id>`. If a line is wrong, `--keep=<id>` leaves that org exactly as it is.
3. **Apply:** `railway run -- node scripts/ci/admin-clean.js --i-know-this-is-prod --apply --archive=<id>`. A second dry run
   should show nothing left to delete. Any archive is undone with Restore in /admin.

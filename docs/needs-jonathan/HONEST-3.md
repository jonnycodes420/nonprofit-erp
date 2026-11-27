# HONEST-3 · waits on Jonathan

- Optional, prod write: `DATABASE_URL=… node scripts/ops/honest3-connection-alerts.js --prefs` (dry run) lists open quiet-connection tasks with no "nobody is emailed" note and existing orgs' first admins with "A connection stops working" off; `--apply [--prefs] --i-know-this-is-prod` writes them. Nothing changes at deploy without it.

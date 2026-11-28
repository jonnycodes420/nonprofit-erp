# HONEST-4 · waits on Jonathan

- Publish the Steward app in Zapier's directory (Developer Platform → the Steward integration `247112` → Publishing). It needs your Zapier sign-in; until then the app is invite-only, and the Connections pages list it as "Zapier: connect to 6,000+ apps" with what it triggers and does.
- Optional, prod write: `DATABASE_URL=… node scripts/ops/honest4-repair.js` (dry run) lists open quiet-connection tasks whose title counts days, and status-page checks that read "up" with no real connection behind them; `--apply --i-know-this-is-prod` fixes them. Nothing changes at deploy without it.

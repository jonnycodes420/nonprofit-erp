## GRANTS-FIX · LINK THE OLD UNLINKED GRANTS ON PROD (2026-11-04)

1. **Dry run** after the deploy, from `~/nonprofit-erp` after `git pull`: `railway run -- node scripts/ops/grants-link-funders.js` (writes nothing; lists per org "link to existing", "create funder", "left for a person", and each Awarded grant that "needs its award recorded").
2. **Apply** the links only: `railway run -- node scripts/ops/grants-link-funders.js --apply --i-know-this-is-prod`. One audit row per link; a second run changes nothing. The "left for a person" and "needs its award recorded" lines stay for the org to settle on screen.

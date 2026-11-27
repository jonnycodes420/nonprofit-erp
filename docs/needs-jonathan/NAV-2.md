## NAV-2 · after the Ship

- Keep the four on for orgs already using them (dry run first, then apply): `railway run --environment production --service web -- node scripts/ops/nav2-keep-in-use.js` then the same with `--apply --i-know-this-is-prod`. The org on the Top 100 must print `turn on majorgifts`.
- Re-seed prod's demo once, so Harborlight shows all four again (its menu is set in the seed; until then a prospect sees the shorter rail): `DATABASE_URL=<prod> BASE=https://nonprofit-erp-production.up.railway.app node scripts/ci/seed-demo.js --i-know-this-is-prod`.

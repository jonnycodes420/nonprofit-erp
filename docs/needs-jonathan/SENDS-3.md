## SENDS-3 · Clear the pledge reminder stamps the one overdue rule disagrees with (prod database credential)

- Dry run, every org: `DATABASE_URL=<prod> node scripts/ops/sends3-pledge-stamps.js` (read only; per org, how many stamped pledges have nothing past due).
- Then, per org it lists: `DATABASE_URL=<prod> node scripts/ops/sends3-pledge-stamps.js --org <org id>` to see each, and `... --org <org id> --apply --i-know-this-is-prod` to clear them (one audit row; nothing is sent).

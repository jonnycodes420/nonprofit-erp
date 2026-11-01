## 0-CLEAN-1 · RE-SEED THE PROD DEMO FOR DATA HEALTH, AND PICK AN NCOA PROVIDER (2026-10-03)

The seed now adds eight duplicate pairs (3 high, 3 medium, 2 low), fifteen messy addresses, four emails to
look at and four movers whose results are in `tests/fixtures/clean1/harborlight-ncoa-return.csv`:

    DATABASE_URL=<prod> BASE=https://nonprofit-erp-production.up.railway.app node scripts/ci/seed-demo.js --i-know-this-is-prod

NCOA: Steward prepares the file and reads the results; running the check needs an account with a licensed
provider (TrueNCOA $20 per file, Melissa $1.50 per 1,000 records with a $50 minimum, NCOAsource $45 up to
17,000 records; links in the CLEAN-1 PR). Signing up and paying is yours.

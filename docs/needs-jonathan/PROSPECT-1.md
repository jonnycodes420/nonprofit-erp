## 0-PROSPECT-1 · RE-SEED THE DEMO FOR ROOM TO GIVE; A SCREENING PROVIDER IS YOURS TO PICK (2026-10-03)

The seed changed: ten prospects (3 Strong, 4 Some, 3 Not yet known), two foundations with EINs
(271000101, 271000102, made up) and a matched-gift employer. Re-seed with the CLEAN-1 command above. The sample
screening file for the walk is `tests/fixtures/prospect1/harborlight-screening-return.csv` (six match, one does not).
On prod "Look up public filing" reads the IRS file (FIX-22: load it once with
`DATABASE_URL=<prod> node scripts/ci/load-irs-bmf.js --i-know-this-is-prod`, then monthly), so the two made-up
EINs come back "not in the IRS file"; to see a real filing on the walk, put a real foundation's EIN on one of them first. Choosing and paying a
screening provider (prices and links in the PROSPECT-1 PR) is yours; nothing is signed up.

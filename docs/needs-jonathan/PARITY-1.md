## 0-PARITY-1 · RE-SEED THE PROD DEMO FOR GROUPS, JOURNEYS AND A VIDEO DRAFT (2026-10-02)

The seed now adds three Groups (one by rule), a "joins a group" journey beside the first-gift one, one
video thank-you draft for Margaret Chen, and an annual goal for Home's goal bar; tags and highlights
are computed and appear without it. This session cannot read the production `DATABASE_URL`:

    DATABASE_URL=<prod> BASE=https://nonprofit-erp-production.up.railway.app node scripts/ci/seed-demo.js --i-know-this-is-prod

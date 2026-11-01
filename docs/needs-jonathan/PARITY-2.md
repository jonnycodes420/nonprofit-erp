## 0-PARITY-2 · RE-SEED THE PROD DEMO FOR THE PUBLIC PAGES AND THE AUCTION (2026-10-02)

The seed now adds descriptions and order to the three membership levels (a monthly Crew level is
seeded hidden), the Spring Paddle peer-to-peer campaign (two teams, eight fundraisers), times, pictures,
sponsor benefits and a gallery on the gala and the 5K, a twelve-item auction with bids, and the
QuickBooks mapping (no tokens). This session cannot read the production `DATABASE_URL`:

    DATABASE_URL=<prod> BASE=https://nonprofit-erp-production.up.railway.app node scripts/ci/seed-demo.js --i-know-this-is-prod

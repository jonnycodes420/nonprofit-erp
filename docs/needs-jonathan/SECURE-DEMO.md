# SECURE-DEMO · what needs Jonathan

- Pick a new demo password (12+ characters) and set it as `DEMO_ADMIN_PASSWORD` on Railway, production, service `nonprofit-erp`.
- Set the same value as the GitHub Actions secret `PROD_AI_SMOKE_PASSWORD` (Settings → Secrets and variables → Actions).
- Rotate prod: `git pull && BASE=https://nonprofit-erp-production.up.railway.app railway run --environment production --service nonprofit-erp -- node scripts/ci/seed-demo.js --password-only --i-know-this-is-prod`

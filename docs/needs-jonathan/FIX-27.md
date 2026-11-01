## 0-FIX-27 · RE-SEED THE PROD DEMO (2026-10-04)

- **Re-seed Harborlight** (`scripts/ci/seed-demo.js` with your prod flags): the seed now confirms the
  timezone (so sequences run and Communications says nothing about pausing) and gives 24 roster volunteers
  an approved application with their days (so the Availability filter has people to find).

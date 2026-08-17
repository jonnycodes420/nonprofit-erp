# BLOCKED — the real object-storage FAILURE drill (Jonathan, ~10 minutes)

The boundary audit (BUILD-58 Part 3, `docs/build58/boundaries/DIFFERENCES.md`
§7) found: the Tigris/S3 **happy path** is proven live (BUILD-51 verified real
put/get/delete against the Railway `steward-portal-assets` bucket), but the
**failure branch** — `s3Put` fails → fall back to the `portal_assets` DB table
+ Sentry `captureException` + `/health.themeAssets.dbFallbackRows` — has only
ever run against a *simulated* failure (unbound endpoint / bad creds), never a
real Tigris outage or a real mid-write 5xx. So we don't actually know the real
service degrades the way the code assumes.

## The drill (10 min) — pick ONE fault-injection
The point is to make the REAL bucket fail a write while the app is otherwise
healthy, then confirm the fallback fires and is VISIBLE.

**Option A — revoke-and-restore (cleanest):**
1. Railway → the `steward-portal-assets` bucket → rotate/reset its credentials
   but do NOT update the `PORTAL_ASSETS_S3_*` env on the service yet (so the
   running app holds now-invalid creds).
2. Upload a portal header/logo through Settings › Donor Portal on a test org.
3. Expect: the upload SUCCEEDS (the asset lands in the `portal_assets` DB
   table, not the bucket), a Sentry event fires, and
   `GET /health` → `themeAssets.dbFallbackRows` is non-zero (and
   `dbFallbackSinceBoot` incremented).
4. Restore the correct creds on the service, redeploy, confirm new uploads go
   back to the bucket and `dbFallbackRows` stops growing.

**Option B — point at an erroring endpoint:** temporarily set
`PORTAL_ASSETS_S3_ENDPOINT` to a host that returns 5xx, upload, observe the
same fallback, then restore.

## What to report back
- Did the upload SUCCEED despite the bucket write failing (no user-facing
  error, no 500)?
- Did `/health.themeAssets.dbFallbackRows` go non-zero, and did Sentry get the
  exception? (This is the SURFACING — a silent fallback is the failure mode.)
- What did the real Tigris error look like (status, body, SigV4 complaint)? If
  it differs from what `s3Put`'s catch assumes, that's a finding.

Belt-and-braces reminder (from BUILD-56 MANUAL-STEPS §6): Tigris bucket
**versioning** is still the separate manual console step — a fallback protects
against a failed write, versioning protects against a bad overwrite; they are
not substitutes.

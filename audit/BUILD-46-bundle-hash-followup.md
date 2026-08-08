# Follow-up (NOT tonight) — prod bundle hash changed on a backend-only push

The production client bundle hash changed on a backend-only push with unchanged client source — so either the build is non-reproducible or something in the client input did change; the bundle hash is our deploy-verification signal and must be trustworthy, so this needs to be run down (reproducible-build check + hash provenance) before we rely on it to confirm a deploy.

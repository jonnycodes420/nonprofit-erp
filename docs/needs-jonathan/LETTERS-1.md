# LETTERS-1 · needs Jonathan

- Run the campaign duplicates script for the pilot on prod (dry run first, read it, then apply with the pilot's org id): `railway run --environment production --service web -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/ops/letters1-campaign-duplicates.js --org <pilot org id>'`, then the same with `--apply --i-know-this-is-prod`. Each merge prints its Undo path.

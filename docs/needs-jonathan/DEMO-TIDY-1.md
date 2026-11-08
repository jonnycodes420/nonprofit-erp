# DEMO-TIDY-1 · what needs Jonathan

- Run `node scripts/ops/demo-tidy.js --org=org_creo --i-know-this-is-prod` against prod (a dry run: it prints every change with counts and the baselines, and writes nothing). If it reads right, run it again with `--apply`. It prints the run's audit id; `--undo=<that id>` puts every row back. If two people match "Marlowe", add `--marlowe=<id>`. Give Muse the baselines it prints at the end of `--apply`.

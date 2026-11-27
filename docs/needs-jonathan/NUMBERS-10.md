# NUMBERS-10 · needs Jonathan

- Staging's General Operating card reads "agree, to the cent" only after its 4 demo rows posted before the covered fee are fixed: rebuild staging (`docs/decisions/staging.md`, How to rebuild staging) or run `scripts/ops/numbers10-fee-rows.js --org org_b72demo` dry first, then with `--apply` (the script prints the full command). Until then the card names the $82.13 as covered fees left out.

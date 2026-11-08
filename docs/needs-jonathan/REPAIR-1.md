# REPAIR-1 · what needs Jonathan

- Finish the demo tidy on CREO: `node scripts/ops/demo-tidy.js --org=org_creo --i-know-this-is-prod` (dry run; it now lists steps 6 to 10 and the 16 missing plan payments), then the same with `--apply`. The payments join the 8 Nov run, so `--undo=<that run's id>` still takes them out. Give Muse the baselines it prints.
- Every other org: `node scripts/ops/repair1-all-orgs.js --i-know-this-is-prod` (dry run: org ids, counts and record ids), then `--apply`. It prints one `--undo=al_…` per org it changed.

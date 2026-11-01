## AUDIT-2 · Lost & Found becomes a rescue plan (2026-10-18)

The free audit used to list lapsed donors by calendar year, which a prospect's own system mostly tells them
already. It now judges each donor against their own rhythm with Drift's pure functions (`drift.js`
assessDrift, rhythmOf, unchanged) and sorts them in `shared/lostAndFoundRescue.js`: call this week (drifting,
no further than 1.75 times their own gap), call this month (further past, or a recurring gift, marked in the
file or a steady monthly rhythm, that stopped within a year), probably gone (past Drift's lapse line). Each
group is ranked and totalled by a year of giving (the 365 days ending with the donor's last gift); one-gift
donors are counted as not judged. The fact line is Drift's own reason, or "Monthly $50 since March 2024.
Stopped in July." for a stopped recurring gift. The worker bundles drift.js and orgTime.js through
`build.commonjsOptions.include` in client/vite.config.js and gives Drift an empty `process.env`
(`client/src/lib/lostAndFoundEnv.js`, imported first). `vite dev` does not convert root CommonJS, so the
audit only runs from a built dist. The old five sections are still computed for the benchmark payload and
retention, not shown. Guarded by §6 of `tests/lf1-no-donor-data-leaves.test.js` on
`tests/fixtures/lost-and-found-rescue.csv` (today pinned 2026-10-18).

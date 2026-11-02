# HOME-5 · Home doesn't open with a comparison (2026-11-01)

Justin's Place's Home opened with "Giving this fiscal year is $21,255 behind last year at this point." It ignored
$78,950 in pledges due by Dec 31, and it opened the morning on a problem. The brief first asked to count pledges
and reword the sentence; Jonathan changed the scope mid-build: take the pace sentence off Home for every org.
Home's header is the org, the greeting and the date. Fundraising and the Board keep the comparison.

- Removed: `paceLine` in `shared/homeLead.js`, `pace` on `GET /home/lead`, the `home-pace` paragraph in `Dashboard.jsx`.
- The Why/What doors (`doors`) still compute and still go through the truth check; Home renders them off (`doors={false}`).
- Then: no "behind" anywhere on Home. The one place it reached Home was the Major slipping move card
  (`insights.js`), now "$X to match last year". The Why/What doors were already off on Home and stay off.
- Pledges toward the year (item 1) and the reworded sentence (item 2) were not built.
- THE-PROCESS's quality-bar note was asked for, but no THE-PROCESS file exists in the repo; the rule is in
  `docs/decisions/home-and-reports.md`.

- After merge, main CI went red twice on fix39-campaigns "§words Sequences: no emoji — ⏸": the Pause / Resume button in `Communications.jsx` (from FIX-60) shows only when the shard holds an active sequence, which CI-2's shard layout now produces. Follow-up PR: the button says "Pause" / "Resume" in words.

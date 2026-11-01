# Scripts removed by ARCH-1 (1 Nov 2026)

These 113 scripts (16,695 lines) served one past build: a walk, a capture, a probe or a
drill, each run on the local scratch stack. MAP-1 marked them "one-time, ran already", and ARCH-1
checked each one for a live caller in code, CI, the hooks and package.json before deleting it (none
had one; the 18 files in `scripts/seed/` that MAP-1 also marked one-time are required by
`scripts/ci/seed-demo.js` and stayed).

Scripts that change data and whose prod run could not be proven from HISTORY or a decision
record were **not** deleted: they are in `scripts/once/` (see `scripts/README.md`).

To bring one back, from the repo root:

```
git show 1ef9b5f:<old path> > scripts/once/<name>   # 1ef9b5f = main before ARCH-1
```

Its relative `require`s then need one more `../`, because it sits one folder deeper.

| Old path | Lines |
|---|---:|
| `scripts/agent2/fixture.js` | 79 |
| `scripts/agent2/run30.js` | 139 |
| `scripts/agent3-walk.js` | 107 |
| `scripts/attribution-chips-capture.js` | 67 |
| `scripts/auto1-walk.js` | 111 |
| `scripts/build101-demo-seed.js` | 111 |
| `scripts/build102-walk.js` | 312 |
| `scripts/build12-ui-capture.js` | 114 |
| `scripts/build14-capture.js` | 73 |
| `scripts/build15-capture.js` | 70 |
| `scripts/build17-capture.js` | 67 |
| `scripts/build19-capture.js` | 63 |
| `scripts/build19-home-capture.js` | 44 |
| `scripts/build21-capture.js` | 59 |
| `scripts/build22-capture.js` | 71 |
| `scripts/build25-workflows-capture.js` | 131 |
| `scripts/build28-capture.js` | 44 |
| `scripts/build28-prepare-images.js` | 56 |
| `scripts/build34-capture.js` | 143 |
| `scripts/build35-capture.js` | 115 |
| `scripts/build36-bulkassign-capture.js` | 71 |
| `scripts/build36-invite-capture.js` | 33 |
| `scripts/build36-notify-capture.js` | 131 |
| `scripts/build40-mobile-capture.js` | 127 |
| `scripts/build41-capture.js` | 178 |
| `scripts/build45-portal-capture.js` | 102 |
| `scripts/build46-capture.js` | 108 |
| `scripts/build47-capture.js` | 136 |
| `scripts/build48-capture.js` | 275 |
| `scripts/build49-capture.js` | 122 |
| `scripts/build50-capture.js` | 399 |
| `scripts/build54-capture.js` | 229 |
| `scripts/build55-capture.js` | 196 |
| `scripts/build57-capture.js` | 175 |
| `scripts/build57-import-drill.js` | 329 |
| `scripts/build57-prod-capture.js` | 64 |
| `scripts/build59-capture.js` | 84 |
| `scripts/build61-capture.js` | 35 |
| `scripts/build61-prod-verify.js` | 131 |
| `scripts/build64-capture.js` | 147 |
| `scripts/build72-capture.js` | 209 |
| `scripts/build72-date-audit.js` | 258 |
| `scripts/build73-landing-capture.js` | 62 |
| `scripts/build78-capture.js` | 147 |
| `scripts/build78-migration-reconcile.js` | 100 |
| `scripts/build78-repro-crossorg-fieldid.js` | 56 |
| `scripts/build79-capture.js` | 168 |
| `scripts/build79-repro.js` | 170 |
| `scripts/build80-capture.js` | 193 |
| `scripts/build81-capture.js` | 323 |
| `scripts/build82-capture.js` | 206 |
| `scripts/build82-repro.js` | 104 |
| `scripts/build83-capture.js` | 212 |
| `scripts/build83-repro.js` | 141 |
| `scripts/build84-capture.js` | 307 |
| `scripts/build85-capture.js` | 156 |
| `scripts/build86-capture.js` | 126 |
| `scripts/build86-notes-fixture.js` | 73 |
| `scripts/build87-f1-walk.js` | 229 |
| `scripts/build87-f3-walk.js` | 279 |
| `scripts/build88a-walk.js` | 146 |
| `scripts/build88b-deposit-timing.js` | 161 |
| `scripts/build88b-walk.js` | 200 |
| `scripts/build88c-walk.js` | 169 |
| `scripts/build89-walk.js` | 313 |
| `scripts/build92-close-org-walk.js` | 202 |
| `scripts/check2-walk.js` | 94 |
| `scripts/clean1-orphan-report.js` | 113 |
| `scripts/creo-goals-capture.js` | 43 |
| `scripts/donor-profile-gating-capture.js` | 61 |
| `scripts/events1-walk.js` | 277 |
| `scripts/fin1-walk.js` | 265 |
| `scripts/finance-entity-routing-capture.js` | 93 |
| `scripts/finance-overview-capture.js` | 93 |
| `scripts/fix10-walk-org.js` | 116 |
| `scripts/fix11-audit-walk.js` | 171 |
| `scripts/fix11-bcc-walk.js` | 66 |
| `scripts/fix11-books-walk.js` | 145 |
| `scripts/fix11-import-walk.js` | 138 |
| `scripts/fix11-seating-walk.js` | 239 |
| `scripts/fix2-b-capture-exports.js` | 79 |
| `scripts/fix3-d-profile-capture.js` | 128 |
| `scripts/fix30-walk.js` | 144 |
| `scripts/fix34c-capture.js` | 83 |
| `scripts/fix34d-capture.js` | 101 |
| `scripts/fix34e-capture.js` | 103 |
| `scripts/fix4-walk.js` | 401 |
| `scripts/fix45-no-em-dash.js` | 106 |
| `scripts/fix5-walk.js` | 413 |
| `scripts/fix6-walk.js` | 265 |
| `scripts/fundraising2-walk-org.js` | 50 |
| `scripts/fundraising2-walk.js` | 52 |
| `scripts/goal-consistency-capture.js` | 62 |
| `scripts/import-stage-capture.js` | 78 |
| `scripts/import3-walk.js` | 125 |
| `scripts/invitation-capture.js` | 106 |
| `scripts/landing1-walk.js` | 207 |
| `scripts/landing5-capture.js` | 34 |
| `scripts/lf1-walk.js` | 228 |
| `scripts/load/mailbox-first-read.js` | 66 |
| `scripts/loadtest.js` | 202 |
| `scripts/nav1-walk.js` | 295 |
| `scripts/onramp-capture.js` | 157 |
| `scripts/preview-perf.js` | 27 |
| `scripts/profile1-capture.js` | 78 |
| `scripts/qboin-walk.js` | 138 |
| `scripts/seed-build46-network-demo.js` | 66 |
| `scripts/trans1-walk-org.js` | 69 |
| `scripts/voice1-walk.js` | 120 |
| `scripts/voice3-walk.js` | 165 |
| `scripts/voice4-walk.js` | 181 |
| `scripts/vol1-walk.js` | 343 |
| `scripts/vol2-walk.js` | 351 |

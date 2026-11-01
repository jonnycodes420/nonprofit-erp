## PARITY-3 · Match the leader's volunteer module (2026-10-02 to 10-03)

Six parts, five PRs: Part 6 (#110), Part 4 (#117), Part 1 (#118), Parts 2, 3 and 5 (this one).
- **The volunteer record is on the person**, not in a second app: hours, filters, CSV, qualifications,
  answers, notes internal or for the volunteer, Volunteer service on the timeline, a glance line.
- **A shift has roles**, and capacity and the waiting list are decided per role inside the same locked
  `signUp`. Footer numbers come from one function. Calendar, roster mode, bulk, conflicts.
- **Reminders stopped sending themselves.** VOL-2's sweep mailed confirmed volunteers for an org that
  turned it on (and FIX-14 listed it as a confirmed automatic send). The brief's rule is that nothing
  reaches a volunteer without a person pressing Send, so the sweep drafts, check-in drafts the
  thank-you, and To send sends in one tap through `sendMilestoneDraft`.
- **A recruitment page and applications**: rich text rebuilt from an allowlist (`shared/richText.js`),
  questions of four kinds, a waiver upload that never appears on a public page, Approve matching by
  email under the per-email lock so a donor who applies stays one record.
- **The Volunteers list is the donor list's filter** with volunteer rules (groups.js), so a Group saved
  from it is the same rows; the default Volunteers group's page says who has never given; WHY-1's
  "Which volunteers should we ask to give?" is a button on the list.
- **Speed (6b)**: a fresh database planned the giving-level aggregate once per gift. 31.8s cold to 0.29s
  after ANALYZE (now at the end of every import and the seed), and 2.04s even with no statistics.
- **What it cost**: PARITY-2 merged five times while #110 waited, and every merge conflicted on the
  regenerated `audit/route-inventory.json` (its timestamp and count lines always collide). Rebase,
  regenerate, merge the moment CI is green.
- **Found, not fixed (next brief)**: `/portal-assets/:id` serves every asset kind publicly to anyone
  with the id, including PARITY-1's conversation attachments (ids are 96-bit, never linked publicly).
  Check-in briefly dated hours on the shift's planned date in #117; fixed here to the org's today.

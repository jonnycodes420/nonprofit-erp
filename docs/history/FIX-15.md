## FIX-15 · the leftovers from FIX-14, GIVE-2 and CAMPAIGN-2 (2026-10-02)

- **Two tabs, two batteries.** Shard databases were `steward_shard_<n>` in every worktree, so a
  second session's battery dropped the first one's mid-run. run-all.sh now takes a tag from the
  worktree folder: databases `steward_<tag>_shard_<n>`, logs `/tmp/steward-suite-logs-<tag>`, and a
  port block claimed with an atomic `mkdir` lock (`/tmp/steward-portblock-<base>.lock`, stale when
  its pid is gone). The two in-process suites (tenant-matrix, fix11-audit-trail) take their port
  from the shard block. The one test, `fix15-two-worktrees`, runs two batteries at once beside a
  bystander database; giving both runs one prefix (`FIX15_PLANT=1`) turns it red.
- **The pre-push hook** starts its own server and database (`SHARD_SELF=1`) when nothing answers on
  `$BASE`, instead of failing to connect.
- **Honest "sent".** The Resend client answers a refusal with `{ error }` and does not throw, and
  about twenty places read only the throw. Fixed: the volunteer link, the your-page link (stamped
  and audited only when sent), pledge reminders (no step forward, no "sent" note on a refusal),
  digests (`provider_refused` instead of `sent`), two-step codes and the owner reset, support
  ticket mail (and `replyTo`, which was spelled `reply_to` and dropped), the waitlist offer,
  recurring proposals (a refused resend no longer spends the one resend), recurring notices
  (`donorNotified`), the receipt badge ("not emailed" in brass), the import invite, the test send,
  and "Email sent!" for a send that is only queued. The express giving link spread an unresolved
  Promise, so it went with no From at all.
- Left as they are, and why: a campaign whose every recipient failed still reads `sent` as a status,
  but its row shows the failed count beside it; onboarding emails and volunteer shift reminders are
  claimed before they send and are not retried. Next build's brief.
- **The morning meetings email** was checked against a local mail sink (a fixture org, one logged
  and one calendar meeting, both in the body). The real send to jonathan@stewardapp.dev needs the
  production Resend key, which this session was not permitted to read.

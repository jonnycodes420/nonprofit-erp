## MAILCHIMP-1 · One bad address can't break the Mailchimp connection (2026-10-08)

- **The failing call** was the push, `PUT /3.0/lists/{audience}/members/{md5}`. Mailchimp answered 400 "Please
  provide a valid email address" for one malformed or fake address in TEST STEWARD's messy file; `pushAudience`
  threw on it, `runEmailSync` recorded the whole run as an error, `last_synced_at` was never set and the card read
  BROKEN every day. The reads (opt-outs, campaigns, activity) ran BEFORE the push, so they wrote rows, but the run
  never counted as a read.
- **Direction:** Steward did add and update contacts in the mapped audience (`status_if_new: subscribed`, name,
  email, tags) once a mapping with groups was saved. Now reading is the default and adding is its own switch
  (`mapping.push === true`); a mapping saved before this build pushes nothing. `demo-file`-tagged records, demo orgs,
  sample rows and addresses `addressProblem` rejects (malformed, or RFC 2606/6761 reserved domains) are never pushed.
- **A 400/422 on one member is a refusal row** (`last_refused`, Mailchimp's own `detail`), not an error. BROKEN is
  only a run-level failure: revoked token, list gone, Mailchimp down.
- **Read-back:** opt-outs and campaign activity land only on people already in Steward; an unsubscribe writes
  `email_suppressions` and `do_not_email`. `last_updated_count` counts records a read actually changed.
- Test seam: `MAILCHIMP_API_BASE` (shard.sh points it at the calendar mock's port under `/mailchimp/3.0`).
  `mailchimp1-sync` went 10 red with the per-address catch removed. int3-optout's fixtures moved off `example.com`,
  which is now a reserved domain to the push.

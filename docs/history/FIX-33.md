## FIX-33 · Google connect loop, Outlook mail, a booked meeting changes the record (2026-10-07)

- **Google "Too many redirects":** prod's `APP_URL` was the Railway API host, and both OAuth forwarders
  (`/gmail/callback`, `/oauth/:provider/callback`) built the app URL from it, so they redirected to themselves.
  They now use `publicUrl.oauthLandingUrl`, the resolver that refuses a deployment host. Guard: oauth-state §8
  boots a child server with `APP_URL` = its own origin (red on main, green after).
- **Outlook "not read yet":** a run that threw, returned early or hung left no trace; `last_synced_at` was the only
  record and was written only at the very end. Every mail read, calendar read and push now writes a
  `mailbox_sync_runs` row; provider fetches time out at 20s; a provider that refuses every request is a FAILED read.
  The prod read that would have named the exact cause was refused by the session's permission check, so the cause
  on prod is unconfirmed; the next run on prod will name it on the card.
- **Sent mail:** Outlook was asked only for mail FROM a contact. Sent Items is now asked by recipient (`$search` "to:");
  Gmail's SENT label marks direction.
- **meetingEffects.js** is the one writer of what a booked meeting does: the Next step (taking over an open step and
  giving it back on cancel), prep and after tasks, timeline lines, journey steps within 3 days moved after it,
  `meeting_effects` as the receipt. Engagement counts a booking (3 points) until cancelled.
- **Part 3b:** a calendar event with no guest on file but a meeting word and a person's name in the title links that
  person; two possible people are kept as `candidate_ids` and asked about ("Add to a donor's record").
- **Watch:** `/health.mailboxSync` {connections, stale, checkedAt}; `npm run status` fails on stale > 0; a stale
  connection logs one `[mailbox-stale]` error line for the daily digest; a banner on Home.
- Sections 4 (profile contradictions) and 5 (import scorecard, `docs/fix-33/import-scorecard.md`) ran in parallel
  worktrees and merged in.

# COMMS-1 · Campaign email says how to turn it on, invites arrive, old sequence drafts cleaned up, every draft can be dismissed

Brief of 6 Nov 2026 (item 4 added mid-build by Jonathan). Report: `.claude/reports/COMMS-1.md` (main checkout).

## Why
- **Comm 2.** A campaign said "1,213 wait until Campaign emails are on" and nothing said where. The audience
  answer (`segment-preview`'s `audience.turnOn`) and Communications' overview (`campaignTurnOn`) now carry
  one sentence from `server/outreach/campaignTurnOn.js`, with the link to Settings → Automatic email for an
  admin (the only role that can flip it) and "Ask an admin" for anyone else. The brief said "Settings →
  Email"; the tab is called Automatic email, so the words say that. The setting's own sentence says sending
  stays manual and turning it on sends nothing. It already sent nothing on main: held mail is never released
  by the switch and the scheduler ignores it.
- **Set 5.** The invite email carried no `_stewardKind`, so mailPolicy read it as donor mail, and it fell back
  to Resend's sandbox sender `onboarding@resend.dev` when `DEMO_SMTP_FROM` was unset. The client then said
  "SMTP not configured" for any failure. Now `server/org/inviteMail.js` is the one sender for Invite and
  Resend: account kind `team_invite` with its org, from Steward's address, 20 a day per org, Resend at most
  once per 10 minutes, each send a row in `invite_sends`, and a Resend bounce webhook marks the row.
- **Leftover drafts.** `scripts/ops/comms1-old-sequence-drafts.js`, the import9 pattern: dry run by default,
  `--apply` archives (status `archived`, `archived_at/by`) with one audit row per org, `--undo=<audit id>`.
- **Item 4.** `server/drafts/dismiss.js`: `POST /drafts/dismiss`, `/drafts/restore`, `GET /drafts/dismissed`
  across milestone, Atlas (agent) and thank-you drafts. Archive, never delete; the Atlas line is discarded
  with its draft and waits again on restore. The client's × / Select / Dismissed (n) live in
  `client/src/components/DraftDismiss.jsx`; STALE-1 gained a `draft` kind so Home's waiting line, the bell
  and the banner re-read at once. The Undo toast is the shared one, which FIX-45 keeps up for a minute, not
  the brief's ten seconds.

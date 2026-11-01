## CLIENT-SAFE-1 · Riders' families never come in, and health details stay out (2026-10-19)

Allie Bramley at Justin's Place (equine therapy) worried that a breach would expose emails about riders' health.
INT-4 already never logged anyone not on file; the gap was families who are also donors, and health details in any
donor's email. An org setting, "We serve clients whose details are private" (Settings, Privacy; admins only; also on
the super-admin org page, where the audit row names Steward support via `req.audit.forOrg`), and a person flag,
"Client (never capture)", set on the profile rail, from the donor list, from a group or by an uploaded list that
matches existing people only (preview, then Undo). With it on, a client is never fetched from Gmail or Outlook (the
address pre-check reads From/To/Cc only), never logged from BCC, never a capture card, never a calendar meeting and
never a memo. Email already logged for a client can be removed in one step, kept 30 days for Undo, then emptied. Other
email runs VOICE-1's health screen plus a short model read before storing; with AI off only date, direction, people and
subject are kept. The program's own words ("our therapy program", "therapeutic riding") are taken out before the
screen so an equine therapy center's every thank-you is not held. Demo: a third demo org, Meadowbrook Riding Center
(director@meadowbrook.demo), 6 clients and 2 held details. The walk caught the flag's label drawn ink-on-ink on the
dark profile rail.

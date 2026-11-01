## FIX-12 · what HELP-1 turned up, and the loose ends (2026-10-01)

- **Recipes draft, they never send.** First-gift thank-you, failed-card note and the lapse
  re-engagement email now write to `milestone_drafts` (Communications → Drafts to review) with
  Send, Mark reviewed and Send all reviewed. Every saved recipe row migrated to `draft_email`, and a
  leftover `send_email` drafts too. Test: `fix12-recipe-drafts`.
- **One AI door.** `aiClient.js` holds the only Anthropic client and the only OpenAI URL, and asks the
  org's switch on every call. Before this, the score rationale, board summary, voice memo and
  column mapper ignored the switch. OpenAI added to the subprocessor list and DPA. Test: `fix12-ai-switch`.
- **The board report had never worked since the FIX-1 split** (`now` undefined, every call 500).
- **HELP-1's list:** Finance opens the deposit sheet; delete-donor copy is true; Stripe Connected
  is Stripe's `charges_enabled`, with a Finish setting up state on the same account; Connections'
  Set this up opens Integrations (a bare string was passed as the nav intent); grant delete confirms.
- **The audit log stores people by id.** Actor, person label and person fields are ids or
  `[person]`; names resolve on read and an erased donor reads "Erased person". Prod held 107 rows
  before this build, every one naming the staff member who acted by email address, none naming a donor.
- **One audit log, seven years.** `user_admin_audit` merged in with its original times and dropped.
  The org cascade is gone, closing an account keeps the audit rows, and the purge flag reaches only
  rows older than seven years.
- **Optional "Your meetings today" email** (off by default, own address only) and **after-meeting
  chips from the Agent engine** (quotes validated against the note; the simple reader when AI is off).
- **Automatic donor-facing sends still left** (for Jonathan to confirm, one by one): per-gift tax
  receipt (org opt-in, default off); dunning, card-expiring and recovered-card emails (default on);
  paid event ticket confirmation; recurring-change and portal self-service confirmations; portal
  magic link, donor-account emails, "your page" and fundraiser manage links (asked for by the
  donor); legacy and tracked sequences, pledge reminders (default on, Steward's default wording) and
  scheduled campaigns (staff-written, sent on schedule); the retry of failed lifecycle emails.
  (Added in FIX-14: volunteer shift reminders, org opt-in, confirmed by Jonathan on 2026-10-02.)

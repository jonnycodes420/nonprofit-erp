# Communications — capability audit (BUILD-06 Phase C, 2026-07-17)

The honest answer to "what does the email system actually do?" — written so a
demo can answer a buyer's "can it do X?" without overclaiming. Three states:
**works-verified** (exercised against a real local server + Postgres this
audit), **exists-unverified** (code-traced end to end, believed working, not
exercised tonight), **missing** (not built — see the ranked list at the end).

## Campaigns (one-off email blasts)

| Capability | State | Notes |
|---|---|---|
| Compose (rich text body, subject) | works-verified | Playwright-covered in prior sessions; send path exercised tonight |
| Merge tokens | works-verified | `{{first_name}}` `{{last_name}}` `{{donor_name}}` `{{org_name}}` `{{gift_amount}}` (latest gift) `{{total_giving}}` `{{year}}` — replaced per-recipient at send time |
| Audience segmentation — real predicate, not decoration | works-verified | Server-side filters at send: All (has email) / Major ≥$10k lifetime / Lapsed (stage) / By pipeline stage / By capacity tier / Manual donor pick. Segment JSON stored on the campaign, resolved fresh at send time |
| Segment size preview in the builder | works-verified (fixed tonight) | **Was broken for stage segments**: the client read a nonexistent `pipeline_stage` field, so "By stage" always previewed 0 recipients while the actual send (correctly reading `stage`) worked. Counts now match sends |
| Scheduled sends | works-verified (fixed tonight) | **Was decoration**: the builder accepted a schedule and set `status='scheduled'`, but no job existed — a scheduled campaign silently never sent. Now `processScheduledCampaigns()` (startup +20s, then every 5 min) fires due campaigns through the exact same send path as the manual button (extracted into `runCampaignSend()`); double-send guarded by a conditional status-claim UPDATE; a read_only (lapsed-subscription) org's scheduled campaign is moved back to draft, matching `checkWriteAccess` on the manual route. Verified live locally: scheduled → fired on the next tick → 6/6 recipients recorded → status `sent` |
| Per-recipient outcome record | works-verified | `campaign_recipients` row per recipient: sent_at, failure_reason (including `suppressed: <reason>`), opened_at |
| Open tracking | works-verified (fixed tonight) | 1×1 pixel → `/track/:recipientId/open.gif`. **Was over-counting**: `open_count` incremented on every pixel load while `opened_at` was once-only, so "open rate" (open_count ÷ recipients) could exceed 100%. Now counts unique opens only (verified: 3 pixel hits → open_count 1). Historical pre-fix counts may be inflated. Standard pixel caveats apply: image-blocking undercounts, Apple Mail privacy prefetch overcounts — treat open rate as directional, not exact |
| Open → donor intelligence | exists-unverified | First open logs an `email` interaction; 2+ opens of last 3 appends "High engagement" to donor notes, 0 of 3 appends a disengagement note |
| Click tracking | missing | No link rewriting at all |
| Suppression honored | works-verified | Every recipient checked against `email_suppressions` before send; skipped rows recorded with reason |
| Unsubscribe | exists-unverified | HMAC-signed no-login link in every footer + RFC 8058 `List-Unsubscribe`/`List-Unsubscribe-Post` headers (Gmail/Outlook native one-click). Org-scoped: unsubscribing from one org doesn't block another org's mail |
| Bounce/complaint handling | exists-unverified, **prod config unconfirmed** | `/resend/webhook` (Svix-signed) suppresses bounced/complained addresses globally (all orgs) and closes active sequence enrollments. Requires `RESEND_WEBHOOK_SECRET` on Railway + the webhook registered in Resend — could not be confirmed from this environment; if unset the route 503s and bounces are never recorded. **Check this before relying on it in a demo.** |
| Sending infrastructure | exists-unverified at volume | Resend HTTP API, sequential per-recipient loop. Fine at hundreds; a 25k-recipient blast is uncharted (and Resend rate limits would dominate). From-address comes from `DEMO_SMTP_FROM` (legacy name; it's the production from-address) |

## Sequences (multi-step drips)

| Capability | State | Notes |
|---|---|---|
| Builder (steps, delays, AI-drafted step copy) | exists-unverified | Subtab in Communications; steps stored in `sequence_steps` |
| Triggers — auto-enroll | exists-unverified | Hourly `autoEnroll()`: `lapsed_90`/`lapsed_180` (stage=lapsed + last gift older than N days), `new_donor` (exactly 1 gift, within 7 days). UNIQUE(sequence_id, donor_id) makes enrollment once-ever per donor per sequence |
| Trigger — `manual` | exists-unverified | Enroll dropdown on the donor profile (`POST /sequences/:id/enroll`) |
| Trigger — `onboarding` | exists-unverified | Signup drip (7 steps, days 0–28) from `FOUNDER_EMAIL`; stores user_id in donor_id; excluded from autoEnroll |
| Triggers — `milestone` / `at_risk` | exists-unverified | System-provisioned sequences. Deliberately **never auto-send**: the engine generates an AI draft into the `milestone_drafts` review queue (or a note-reminder with talking points for "write a personal note" moments) and completes the enrollment. Human approves/edits/dismisses |
| Trigger — `stage_change` | dead schema value | Exists in the DB enum and nowhere else: autoEnroll excludes it, no code enrolls on stage moves, and the builder UI doesn't offer it. Not a user-facing trap — just don't claim it works |
| Step sending | exists-unverified | Hourly `processSequences()`: due enrollments advance a step; tokens `{{donor_name}}`/`{{first_name}}`/`{{org_name}}`/`{{user_name}}`; unsubscribe footer + headers on every step; donor with no email skips the step (advances cadence); suppressed address closes the enrollment with matching status; each send logs an interaction |
| Milestone Drafts review queue | exists-unverified | Approve/edit/dismiss/send in Communications; send route re-checks suppression and logs an interaction. Feeds the Home "Needs Your Attention" queue |

## Suppression coverage map (every send path, audited tonight)

Checked before sending: **campaign sends · sequence steps · milestone-draft
sends · recurring-gift dunning (auto + manual resend) · recovery thank-you ·
pledge reminders (auto + manual resend) · gift receipts · year-end statements
· onboarding drip**. Not checked, deliberately: **Gmail 1:1 sends** (personal
correspondence from the staff member's own connected mailbox — not bulk mail;
marketing-unsubscribe semantics don't apply) and **fundraiser manage-link
email** (transactional; the recipient themselves just requested it).

## Honest gaps a buyer might hit

1. **No physical postal address in email footers.** CAN-SPAM requires one in
   commercial email; the footer has only the unsubscribe link. Org addresses
   already exist in `orgs.receipt_address` — threading them into
   `unsubscribeEmailFooterHtml` is a contained follow-up, deliberately not
   rushed at night across nine send paths. Flagged as the top compliance
   follow-up.
2. **Bounce webhook production config unconfirmed** (see table above).
3. Open rates are directional (pixel mechanics), and pre-2026-07-17 counts
   may be inflated by the repeat-count bug fixed tonight.

## Not built (ranked by how often buyers ask)

1. **Richer segmentation** — combining criteria (stage AND giving range AND
   custom field), geographic filters, saved segments. Today each campaign
   picks exactly one dimension.
2. **A/B testing** — no subject-line or content splits.
3. **Click tracking** — opens only; no per-link analytics.
4. **Template library / visual email builder** — rich text + tokens only; no
   reusable branded templates.
5. **Batch throttling / send-time optimization** — sequential immediate send.

## What was fixed in this audit (and how it was verified)

All three against real local server + Postgres (see commit): scheduled
campaigns actually sending (live tick test, 6/6 recipients, status `sent`);
unique open counting (3 hits → 1); stage-segment preview counts (field name
fix + build). No new features were built.

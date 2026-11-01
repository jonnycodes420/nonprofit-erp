## FIX-39 · Communications › Campaigns reads clean, and every email and page opens in the editor (2026-10-14)

Before: Campaigns showed the same campaigns in two tables (a "Sent" table that also listed one waiting
for approval), the tab said 10 for 2 rows (it counted the eight fundraising goals that share the
`campaigns` table), a raw `awaiting_approval`, `{{first_name}}` in subjects, numeric dates, an alarm-clock
emoji and unlabelled icon buttons. Now there is one table under All / Drafts / Scheduled / Sent, the tab
counts the rows under All, statuses come from `STATUS_WORDS` in `shared/campaignKind.js`, subjects are
filled with the preview sample, dates go through `displayDate`/`displayDateTime`, and Delete sits in More
behind a confirm. A sent campaign opens read-only with "Duplicate to edit". Part 8: "Edit in editor" is
the one label wherever an email template, a campaign, a draft from a template or a giving page shows;
Back returns to the caller (`safeBack`, `?back=`). Templates gained a draft (`email_templates.draft`):
when a live journey or one-person email reads one, Save keeps a draft and Publish makes it live, after
saying what it changes (`GET /email-templates/:id/usage`). Campaigns copy a template's blocks when made,
so they are not counted as users of it. Guards: `tests/fix39-campaigns.test.js`; POLISH-2's render leg
also fails on m/d/yyyy dates. The list of places with no editor yet is `docs/fix-39/edit-everywhere.md`.

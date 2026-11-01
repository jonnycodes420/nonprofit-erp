## GIVE-EDIT-1 · Every giving page can be edited from Fundraising, like the volunteer page (2026-10-13)

Before: a giving page's blocks were arranged in `/portal-editor?page=gp_…` (draft and publish), but its
headline, story, photo and goal lived in Settings and its form (amounts, frequency, thank-you) in the
Settings form editor, both saving straight to live. The org-wide form's amount ladders had no screen.
Now the one editor has a Details mode: the page's own fields wait in `giving_pages.draft_settings`, the
org form's ladders in `portal_settings.form_draft`, and Publish writes them with the blocks. Each publish
is a `giving_page_versions` row (who, when, snapshot); the first publish keeps what was live before as
version 1, and Restore is itself a version. The form is written on publish only when it changed, so a
headline edit never turns an original one-step form into the three-step one. Form config gained
`offerAnnual` and `showCoverFee`; the donate route now asks about a yearly gift on its own. Five templates
(`givingPageEdit.js`). Also: `/volunteer/join` writes to Pending applications, the Home next-step line
keeps names (`shared/stepCase.js`), and recordAssetPointerHistory now gets its actor from giving-page
routes. Seed: Harbor Run carries an unpublished draft.

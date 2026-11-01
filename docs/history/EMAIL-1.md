## EMAIL-1 · Beautiful emails, built like giving pages (2026-10-06)

Emails now use the giving pages' widget registry (a third surface, "email"), the one brand in
portal_settings, and a new media library (`media_items`, JPEG for inboxes). `renderEmail` produces
600px table HTML with inline styles, phone stacking, dark-mode support and a required footer; a send
with any problem is refused whole. Thirteen starters (shared/emailTemplateLibrary.js) become
`email_templates`; the editor previews desktop/phone/dark, sends a test to yourself (a demo org gets the
preview instead) and drafts words through the AI switch for approval. Templates start campaigns
(rendered per person at send, with a prefilled give link in the URL fragment), journey steps, review
drafts and Agent drafts. Campaigns gained `awaiting_approval`. The demo seed carries the brand, 16
photos, 3 sample videos, every template, a sent spring appeal with results, a year-end appeal waiting
for approval and a three-template journey. Test: `tests/email1-brand-render.test.js`, proven red two ways.
Email clients were not opened (no inbox accounts here); safety was checked by `lintEmailHtml` on every
template and by rendering desktop, phone and dark in Chromium.

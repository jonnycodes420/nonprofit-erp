# FIX-39 · Edit in editor, everywhere an email or a page appears

Written before building, from a read of the client on `main` (6216535), then updated with what was built.
"Edit in editor" is the one label. It opens that exact item in its editor: the email editor
(`EmailEditor` in `EmailTemplates.jsx`) for emails, and the shared page editor
(`/portal-editor`, VOL-PAGE-1 and GIVE-EDIT-1) for pages. Back returns to the screen it came from:
the email editor through `?template=<id>&back=<path>` on Communications, the page editor through
`&back=<path>` (only a path inside the app is accepted, `safeBack` in `client/src/lib/appUrls.js`).

## Where the button is now

| Place | What it showed before | Edit in editor now |
|---|---|---|
| Communications › Templates, each card | The whole card was a button reading "Open" | The card's button reads "Edit in editor" and opens the email editor (printed letters open their letter editor). Starters not yet saved still read "Start from this". |
| Communications › Templates, the editor | Save wrote the live template at once; no word on what used it | Says what uses it ("Used by 1 live journey (First year, in three emails)..."). When something live reads it, Save keeps a draft and Publish (with a confirm naming what changes) makes it the template. Discard draft throws the draft away. |
| Communications › Campaigns, each row | Icon buttons: a pencil, a circled plus and a red x, no words | "Edit in editor" on a campaign that has not gone out (opens the campaign's screen); "View" on a sent one (opens it read-only). Duplicate and Delete sit under More, and Delete asks first. |
| Communications › Campaigns, the campaign's own screen | A campaign built from a template said "Change its words in the template", with no way to get there; a sent campaign opened fully editable | "Edit in editor" opens its template in the email editor, and Back returns to the campaign. A sent campaign opens read-only with "Duplicate to edit". |
| Communications › Drafts to review | Send, Mark reviewed, Edit (inline), Start from a template, Dismiss | "Edit in editor" on a draft that was made from a template opens that template; Back returns to Drafts to review. A draft with no template keeps its inline Edit. |
| Journeys, each email step | A "Draft in your voice" select naming a template, with no way to open it | "Edit in editor" beside it whenever the step drafts from a template; Back returns to the journey. |
| Fundraising › Pages, each giving page card | "Edit the page" | "Edit in editor", opening `/portal-editor?page=<id>` with a Back to Fundraising |
| Fundraising › Pages, the volunteer page card | "Edit the page" | "Edit in editor", same |
| Fundraising › Pages, the donation form | "Edit the page" | "Edit in editor", opening `/portal-editor?form=org` with a Back |
| Settings › Giving pages, each row | "Build the page" | "Edit in editor", same editor, with a Back to Settings |
| The page editor's top-left link | "← Steward" to /dashboard, always | "← Back" to the screen that opened it; "← Steward" when opened with no `back` |

## What a change to a template reaches (checked, not assumed)

- A **journey** drafts from its template when each step opens (`journeyTemplateDraft` in routes/crm.js), so a
  live journey (switched on, or with people still in it) is counted, and a save to its template waits as a draft.
- A **campaign** copies the template's blocks into `campaigns.email_blocks` when it is made, and the send reads
  that copy. A scheduled campaign is therefore NOT changed by publishing its template, and is not counted.
- A **sequence step** stores a `template_id`, but no send reads it, so it is not counted.
- A **one-person email** (thank-you, birthday...) is what every new draft of its kind starts from, so it says so.
- The **receipt** is not an email template (its words are fields on the org), so nothing in this list names it.
- Nothing already sent changes, ever.

## No editor yet (the button is not shown; for a later build)

| Place | Why there is no button |
|---|---|
| Home › thank-you queue | The drafts are written from the org's voice samples, not from a template; there is nothing to open. |
| Donor profile, drafted emails | AI drafts beside the next step; no template and no saved draft to open. |
| Communications › Sequences, each step | The step's subject and body are edited inline; the UI never sets a template on a step. |
| Communications › Surveys, the survey email | The survey's email has no template or editor; it makes drafts in Drafts to review. |
| Agent drafts (Agent screen and the review modal) | They can start from a template, but the draft does not link back to one on screen. |
| Settings › Tax receipts | The receipt is a form of fields (and a PDF preview), not an email template. |
| The morning email | Only notification switches; it has no template. |
| Event pages | Edited in their own inline card (`EventPageEditor.jsx`), not the shared page editor. |
| Peer-to-peer pages | Fundraisers' pages are edited inline ("Edit their page"); no shared-editor page exists. |
| Membership page | "Open page" and "Copy page link" only; there is no page editor for it. |

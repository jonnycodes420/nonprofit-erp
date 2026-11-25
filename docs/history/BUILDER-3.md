# BUILDER-3 (2026-11-25) · Work on an email together, share it for review, set the house style once, take the HTML out

From Jonathan (24 Nov): the email builder must match the reference editor he sent, with people's faces in the top bar,
Share, Export and a Code element. Target look: mockup D. Reproduced first on staging (3c0e0b8, Harborlight, read
only): the template editor's bar had Desktop, Phone, Dark mode, Preview as, Send me a test, History and Save. It had
no faces, no Share, no Export, no Comment and no Styles tab. A save overwrote the whole email (no rev, no merge), and
most blocks had no id.

- **Who's here** (`server/mail/emailTogether.js`, `client/src/components/email-builder/together.jsx`).
  - There is no new service and no socket: a heartbeat every 3 s (`POST /email-templates/:id/presence`), the brief's
    fallback. Railway can carry a socket, but the web may run as more than one process with nothing to pass a
    heartbeat between them. A push channel later is Postgres LISTEN/NOTIFY (the database Steward already has) behind
    an SSE route: no new service, so nothing waits on Jonathan.
  - Each person's face (an initial) shows in the others' top bar, in a colour of their own: emerald shades and brass
    only. The block each has selected carries an outline in that colour in the others' email.
  - The table (`email_editor_presence`) is silent (`shared/changeTopics.cjs`), and a heartbeat writes no audit row
    (`req.audit.skip`): it is nobody's change.
- **Editing together** (`shared/emailMerge.js`).
  - Every block now has an `id`. A block saved before ids existed gets a place id (`p0`, `p1`, …), which everyone who
    opened that version agrees on; a new block gets a fresh one.
  - `email_templates.rev` moves by one with each save. A save names the rev it started from, and a save from an older
    rev is merged block by block with what is saved now, never laid over it.
  - The browser does the same merge when someone else saves: their change appears, yours stays, and each step of your
    Undo is rebased too (`useEmailBuilder.rebase`), so Undo takes back only your own changes.
  - The block a person is typing in is theirs until they move on or are idle 30 s. The others see "Natalie is editing
    this" and can't type in it, and a save that changes it keeps the holder's words and says so.
  - Every save still goes through `validateEmailBlocks`, the actor stamp and the one audit write.
- **Comments.**
  - "Comment on this part" sits beside the selected block, and the list is under More, Comments. A thread is pinned
    to one block.
  - An @mention picks people of the org only. It becomes a line in their bell (`/atlas/activity`, Dismiss), never an
    email.
  - Resolve hides a thread and lets its mentions go.
  - Comments are stored beside the blocks (`email_comments`), so no preview, export, send or reviewed email can
    carry one.
- **Share for review.**
  - A review link either opens for someone in the org (signed in, `/app/review/:id`) or is a private view-only link
    for an outside reviewer (`/review/:token`, only its SHA-256 kept).
  - It shows the email as the one previewed person sees it (only that person's merge values), or with sample values.
  - The outside link takes comments only if allowed; such a comment is stamped `system:email-review/<link>`.
  - It expires in 7 days and can be turned off at once.
  - A GET or HEAD on it writes nothing. The suite checks every row of the org and the audit log around one.
- **Export and Code.**
  - Export downloads or copies the email's HTML, for the previewed person or with sample values, with a sample
    unsubscribe line in the footer slot (the existing `/email-export`).
  - The Code element was admins' only in the editor alone; the server now refuses one from anyone else, on templates
    and on campaigns (`codeGuard`). Anyone may save an email that carries an admin's code unchanged, or take it out.
  - A code block with a script or an event handler is sanitised, named as a problem, and refused at send
    (`EMAIL_NOT_READY` in the campaign's preflight).
- **House style.**
  - A Styles tab in the left pane sets, for every email of the org: heading and body fonts (from
    `EMAIL_FONT_STACKS`), their sizes, the link colour (one of the brand's) and the button shape.
  - It is stored on `portal_settings.email_style` (an admin's) and read at render time (`shared/emailStyle.js`
    `styleForRender`), so every email shows it on its next open or send. No saved block is rewritten, and a block
    with its own size keeps it.
  - With no house style set, an email renders byte for byte as before (builder2a §3 holds every starter to main).
  - Dark preview was already in the bar (BUILDER-2B); it is labelled "Dark" now, beside Desktop and Phone.
- **The bar.** To keep to one line at 1440, History and the Comments list moved into a More menu (Escape or a click
  outside closes it), and Undo and Redo moved to the right of the path line.

Tests: `tests/builder3-together.test.js` (the build's one new suite: shared links, comments, the code block, two
editors; and a two-browser leg).
- On the branch: 53 passed.
- Red on main (3c0e0b8): 18 failed, among them a staff code block saving on a template and on a campaign, and the
  second of two saves from one version laying over the first.
- Planted and watched go red: a write in the review link's GET (§1 caught the one table), and the server merge left
  out (§4).

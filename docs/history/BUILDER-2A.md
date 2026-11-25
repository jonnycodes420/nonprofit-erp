## BUILDER-2A · The new email parts and saved blocks, built underneath the editor (2026-11-24)

Jonathan (24 Nov) asked for an email builder with the full breadth of the reference editor he sent (Chamaileon),
in Steward's brand, target mockup D. BUILDER-1 was rebuilding the editor screen at the same time, so this build
stayed out of every editor file and built what the screen will use, finished and tested: the renderer, the block
model and the server. BUILDER-2 wires it in.

- **Four blocks** (`shared/emailMoreBlocks.js`): Columns (2 or 3, each holding text, a photo or a button, stacked on
  phones by `.st-col`), Box (a container, one level, its children counted toward `MAX_BLOCKS`), Social (Brand's
  links, new column `portal_settings.social_links`, Steward's own icons) and Code (pasted HTML, cleaned by
  `shared/emailCodeSanitize.js`; anything taken out refuses a send; admins' only in the model).
- **Style fields** (`shared/emailBlockStyle.js`, `EMAIL_BLOCK_STYLE`): alignment, width (px or %), image height with
  its shape kept, padding, space above and below, border, corners, background (brand words only) and hide on phone
  or desktop. A styled block draws in a bare frame and is wrapped once; an unstyled one takes the old path. The
  proof that nothing written before moved: every starter renders to the same SHA-256 as on main (5666d11).
- **The renderer** became a recursive `draw(block, place, where, rows)` so a Box can draw its children; the
  frame (`IN`, `FW`, `HP`) replaced the fixed 600/536/32 inside the block switch. The validator became
  `validateOne` (id and style kept, never added); its output for every old input is the same as main's.
- **Saved blocks** (`email_saved_blocks`, `server/mail/savedBlocks.js`) and **ready-made sections**
  (`shared/emailReadyBlocks.js`): using either returns a copy with fresh `blk_` ids. Delete is the one Remove
  (`saved_block` kind) with Undo. Ready-made photos are Steward's stock photos, stored for the org only on use (a
  GET writes nothing).
- **Export** (`POST /email-export`): the email as HTML for a chosen person or sample values, with a sample
  unsubscribe line in the footer slot.
- The new blocks carry `menu: false` in the registry so today's editor menu does not offer blocks whose controls
  are not built yet; BUILDER-2 removes it.

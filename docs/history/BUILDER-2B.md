## BUILDER-2B · Drag and drop, columns, and blocks you save and reuse (2026-11-24)

BUILDER-1 (#514) made every email editor three panes; BUILDER-2A (#515) built Columns, Box, Social, Code, the style
schema, saved and ready-made blocks and export under it. This build wired them into BUILDER-1's screen.

- **Drag and drop** (`email-builder/frameDnD.js`, attached by EmailFrame): tiles and saved blocks use the browser's own
  drag from the left pane into the frame, with an emerald drop line. The ⠿ grip moves a block with pointer events: a
  native drag that starts inside the frame hung Playwright's real-mouse walk and is the least reliable path across
  browsers, so the grip does not use it. Alt+Up/Down moves the selected block except inside paragraphs of text.
  Every move, drop and insert is one `change`, so one undo step (`useEmailBuilder` `insert`/`insertBlocks`/`moveTo`).
- **The floating "+"** sits on the line between two blocks while the pointer is near it; its list (PlusMenu.jsx) is
  the Elements tiles (one list with the tab, `tilesFor`) and the saved and ready-made blocks.
- **The new blocks** are tiles; their Edit tab is `MoreSettings.jsx`. Code is offered only to an admin. A click on a
  row inside a Box selects the Box (its rows are marked `3.children.0`).
- **Save as a block** (SaveAsBlock.jsx) saves the selected part and, if chosen, the parts below it; the Blocks tab
  (BlocksTab.jsx) lists saved and ready-made blocks with a scaled picture, adds a copy on a click or a drop, renames,
  and deletes through the one Remove with Undo.
- **Copy and paste** across emails of one org through the copy and paste events (no clipboard permission needed).
- **Brand** gained Social links (the same PUT and Undo). The list of networks moved to `shared/socialNetworks.js` and
  is handed to BrandPanel by EmailTemplates: a lazy BrandPanel importing a module the Communications bundle also uses
  turned that bundle into a shared chunk and broke the prerender step (`PAGE_CHUNKS names Communications.jsx`).

## BUILDER-1 · The one editor becomes a real email builder (2026-11-24)

Jonathan tried the thank-you template editor himself on 24 Nov: "this template tab just does not look good
honestly", and "+ Field" did nothing when he picked a field. He chose mockup D (block builder) and asked for a
full email builder's functions in Steward's look.

**Reproduced first.** On staging (19cc9a6, org_stagewalk, Playwright): open the first-gift thank-you, don't click
into the email, + Field → First name. The email did not change; the only answer was "Click into the words in the
preview first…" in the far right column. Cause, as the brief read it: `insertChip` needs a caret saved by the
frame's `selectionchange`, and with none it returned false and only `setNote` ran. The second half (a field picked
AT a caret dropped by the redraw) did not reproduce: on a throwaway starter template the chip was there right after,
after the redraw and in the saved words (`{{first_name}}`).

**What was built.**
1. *A field always lands somewhere.* The Fields tab replaces "+ Field". At the caret when she is typing in the
   selected text; else at the end of the selected text block; else the first text block, written into the block's
   own words as `{{field}}`; a toast says where. The caret now moves after an inserted chip, so a second field
   follows the first.
2. *Three panes, mockup D.* `StewardEditor` gained `layout="builder"` (one shell, a second layout): a white top
   bar, the path line, a left pane (Elements, Blocks, Fields), the email on cream, a right pane (thumbnail, then
   Edit / Style or the email's own settings). Below 900 px the panes are sheets. `EmailEditor.jsx` went from 933
   lines to about 490; the parts are `client/src/components/email-builder/`.
3. *Click to select.* An emerald outline, a name tag and handles on the selected block; Escape or the cream clears
   it; the path line and right pane follow.
4. *Settings and Style.* `shared/emailBlockStyle.js`: a block's `style` and each type's own settings, clamped by
   the validator and drawn email-safe. `STYLE_CAPS` decides what the Style tab offers per type. An unstyled email
   renders byte for byte as before (checked against main). Her signature picture from LETTERS-1 is uploaded as a
   PNG (`/pictures/upload` with `as: "signature"`), because a data image never rides in an email.
5. *Elements and Fields.* A tile per block type `typesForSurface("email")` allows, plus List (a text block that
   starts as a list); tiles are `draggable` with `DRAG_TYPE` for BUILDER-2. The preview answer carries `fieldInfo`
   and the brand's swatches.
6. *Undo and Redo* back to the last save (`useEmailBuilder`), with Cmd/Ctrl-Z in the page and in the frame.

**Found on the way.** Adding a Video made every preview a 400 (the validator refused a video with no link), so
the email stopped redrawing; an empty video now saves and previews as a problem, and a send still refuses it. An
Event, Giving page or Video block with nothing chosen drew no row, so it could not be seen or clicked; a preview
now draws a box saying what to choose.

**Not here.** Drag and drop, columns, saved and ready-made blocks, pages moving to the builder (BUILDER-2 on).

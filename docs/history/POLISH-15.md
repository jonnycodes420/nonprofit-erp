# POLISH-15 · Controls that do nothing, and names that don't find people (27 Nov 2026)

**Why.** Jarvis's lead for Fri 27 Nov (staging walked overnight) and the prod check's note on search. Built in one
tab with five parallel worktrees (items 2, 3+6, 4, 5a, 5b), one PR.

1. **Search by full name, surname, or "surname f".** The whole phrase was matched as one string against the name,
   so "ravensmere f" or "Ravensmere Fenwick" found nobody; the surname alone ranked everyone who shares it by last
   gift and sent five (three on screen). Reproduced on staging with ⌘K (seven made-up "Quillhaven"s in
   org_stagewalk: three shown, "quillhaven t" no matches) and by read-only SQL on Harborlight (17 share one surname;
   the person was 13th). `personMatch.js` now also matches when every typed word starts a word of the name, in any
   order, and ranks whole-word matches (2) and "whole words, last one being typed" (4) above plain starts-with and
   contains. The top bar shows every whole-word match, up to 25. `search2-everything` grew a 1,218-person
   shared-surname fixture: four checks red on main, green now; p95 ~115 ms against main's ~144 ms locally, 70–120 ms
   for the new query on staging's data.
2. **The email builder in Safari.** The editing frame was sandboxed without `allow-scripts`, and WebKit runs no
   listener in such a page, not even the parent's: no select, no typing reaching the block list (Undo disabled), no
   grip drag, no "+". Chromium runs them, so every check passed. The frame now allows scripts and its page's first
   element is a `script-src 'none'` policy (`email-builder/frameDoc.js`); a planted `<script>` and `onerror` ran in
   both engines without the policy and in neither with it. Undo reloads the frame (the undone version could render
   the same as the frame held). Checks lists every `[blank]` up to 240 characters (it took one per field, up to 60):
   a saved email with a longer blank is now refused at send until it is filled. The editor registers with the leave
   guard, so a sidebar link asks. The giving page editor sorts suggested amounts when a box is left.
3. **Meeting time and calendar drag.** A click where Chrome draws its native time picker landed on the dialog's
   backdrop and closed it. The meeting dialogs use the in-page time box with a half-hour list; the first click
   outside while a picker field has focus only closes the picker (`lib/pickerFocus.js`). A quick drag finished before
   the grid listened for moves; it now listens on press, and 6 px of travel is a drag (`calendar/gridDrag.js`), with
   a dashed ghost and the existing Undo toast.
4. **Settings.** The time zone list says why it is locked (read-only account, not an admin, loading, saving). The
   journey Priority box stepped by 10, so 35 was "invalid" yet saved; it now reads 0–1000 from `journeyShape.js` and
   says so. /pricing's "How it works" links pointed at /pricing itself; there is now a `#how-it-works` section.
   Setup Step 5 did not reproduce, locally or on staging (Continue enabled before and after done; the $10,000 preset
   saved; Donors' Major lists the one person at that level): OPEN.
5. **Atlas and Imports.** What Atlas did gives a saved proposal "Undo all" (the existing `POST /atlas/:id/undo`) and
   each line its Undo while its 30-day window is open. Imports and the receipt say "Undo available until …" or
   "Undo window closed …" with the window's length. Statement imports names its last file and opens the import in
   view. Atlas folds a doubled word and drops a definition already said in one request (`server/atlas/noRepeat.js`,
   checked in `atlas6-grounded` §10). A Top 100 question while it is off says so and names Settings → Major gifts.
   Calendar Ask answers journey due dates (`server/ai/journeyDueAsk.js`).
6. **Small words.** QuickBooks Manage counts use `countLabel`. The main Next step names the gift whose thank-you task
   the sidebar shows (`server/insights/afterMove.js`); ONE-MOVE-1 had not covered it. The logo did not reproduce: a
   transparent PNG and a JPG uploaded on staging showed as themselves in Settings and the top bar: OPEN.

Outside the brief, for the next one: `EventPageEditor.jsx` uses the same sandbox shape (probably dead in Safari);
"Nobody is Monthly givers right now" in `server/atlas/populations.js`.

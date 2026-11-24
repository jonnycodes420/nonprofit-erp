# PERF-5 · For the fleet

**Surfaces changed:** the top bar's name chip and its menu (the What's new dot, and the What's new panel it opens).
Nothing on Home's screen changed; what changed is when the What's new list and its panel download (only when What's
new is clicked, no longer four seconds after Home draws). Settings → Imports → an import's Undo is unchanged in behaviour; only its test
budget changed.

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** Sign in, stay on Home. The name chip at top right shows a small gold dot if you have
   not opened the newest What's new entry on this browser. Click the chip: the menu shows "What's new ·" (with the dot
   mark). Click What's new: the panel lists the entries, newest first, and its first entry is the newest file in
   docs/changelog that is not hidden. Close it and reload: the dot is gone and stays gone.
2. **(Read only.)** Off the happy path: open the chip's menu and close it without opening What's new, then reload.
   The dot is still there (only opening What's new clears it). Open What's new twice in a row: the same list, no
   second loading state, nothing blank.
3. **(Read only.)** Open DevTools → Network → JS, reload Home and wait 10 seconds without touching anything. No file
   named `changelog-….js` or `WhatsNewPanel-….js` downloads. Open the name chip's menu: still none. Click What's
   new: both download then, once, and the panel shows the entries.
4. **(Needs a write: org_stagewalk.)** Settings → Import a CSV of 30 made-up people → finish → on the receipt press
   Undo. It says "Undone. 30 people this file created are in the trash, restorable for 30 days." within a few
   seconds. Press Undo again: it says the import was already undone.

**What could have broken nearby:** the public What's new page (/resources, reads the same files, unchanged), the
super-admin's changelog hide list on /ops (when the newest entry is hidden, no dot shows until a newer build, and
the panel lists only visible entries), the mobile
shell (the chip is hidden at 768 px and below; nothing should error there).

**Needs a write:** only check 4.

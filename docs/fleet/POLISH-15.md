# POLISH-15 · For the fleet

**Surfaces changed:** the top bar search (⌘K) and the Donors list's search box; Communications → Templates → the
email builder (the frame, grip drag, the "+" between blocks, Undo/Redo, Checks, leaving with unsaved changes);
Fundraising → the donation form editor's suggested amounts; Calendar → Add meeting and Reschedule (the Time box and
its list), the profile's Move it, the week grid's drag; Settings → Giving pages → Time Zone; Journeys → a journey's
Priority; /pricing (header, drawer and footer "How it works", the new section); Setup → Step 5's Continue ("Saving…");
the bell's What Atlas did; Settings → Imports (the intro, each row, the receipt); Settings → Connections →
Statement imports; Atlas answers (counts, Top 100 while off); Calendar → Ask; Settings → QuickBooks → Manage; a
profile's main Next step line.

**Clicks to try for the next three nights:**
1. **(Read only.)** ⌘K, type a surname several people share: every one of them is listed under People (up to 25),
   with no "See all" needed. Type "surname f" (the first letter of one of them): that person is first or second. Type
   "Surname Firstname": that person. Off the path: the surname with one extra letter on the end finds none of them.
2. **(Needs a write: org_stagewalk.)** Communications → Templates → open an email, in Safari if you can: click a
   paragraph (it outlines), type " hello", pause, Undo: " hello" goes. Type two bursts with a pause, Undo once (only
   the second goes), Redo (it returns). Grab a block's ⠿ and drag: a line shows where it lands. Rest the pointer
   between two blocks: a "+" appears.
3. **(Needs a write: org_stagewalk.)** Blocks tab → Event invite: Checks lists all three bracket blanks, the long one
   too. Click a sidebar link before saving: "Leave without saving?"; leave, come back: the block is gone.
4. **(Needs a write: org_stagewalk.)** Fundraising → donation form: change the third one-time amount to 999 and tab
   out: 25, 50, 250, 500, 999, and the same after reload.
5. **(Needs a write: org_stagewalk.)** Calendar → Add meeting → a person → ▾ beside Time → 11:00 AM: the field reads
   11:00 AM and the dialog stays open; Escape closes only the list. Week view: drag a meeting quickly about 1 cm: a
   dashed outline, it moves, a toast with Undo; Undo puts it back. A plain click opens its card and moves nothing.
6. **(Read only.)** /pricing: the header's and the footer's "How it works" scroll to the How it works section; a
   second click scrolls again.
7. **(Needs a write: org_stagewalk.)** Journeys → Birthday card → Priority 35: not flagged; the line under it reads
   "A whole number from 0 to 1000…". Type 1500: it becomes 1000, and saves as 1000.
8. **(Read only.)** Settings → Giving pages → Time Zone: an admin on an active account can choose any zone; locked,
   a sentence beside it says why.
9. **(Needs a write: org_stagewalk.)** Ask Atlas "I called <person> today. Remind me to call them next Tuesday.",
   Save, open the bell: "Saved 2 things." has "Undo all"; each line "Undo available until <date>". Undo all: every
   row reads undone. Press again after a reload: no Undo is offered.
10. **(Read only.)** Settings → Imports: the intro states each undo window; each row and the receipt say "Undo
    available until …", "Undo window closed …" or "Undone … (undo was open for 7 days from the import)".
11. **(Read only.)** Settings → Connections → Statement imports: "Last file: <name>, brought in <day>". Upload opens
    the import in view; choose a CSV: "Reading your file…" with a bar; close it: nothing changes.
12. **(Read only.)** Atlas: "How many people gave this year and how many gave last year?": the definition appears
    once. With Top 100 off: "Who is on my Top 100?" says it isn't turned on and names Settings → Major gifts.
    Calendar → Ask "When is the next journey step due?": the step, the person and the day (or "No journey step is
    due from … The next one is …").
13. **(Read only.)** A person with an older unthanked gift whose thank-you task is open and a newer unthanked gift:
    the main Next step and the sidebar name the same gift. QuickBooks Manage with one campaign: "1 campaign mapped".

**What could have broken nearby:** every list that searches people through `personMatch.js` (Donors list search,
Record a gift's From box, quick lookups); every dialog's click-outside and Escape (shared dialog code); volunteer
shift times (same time box); the calendar's all-day row; every email the builder edits (frame reloads on
Undo/Redo); sends of a saved email that holds a long `[blank]` (now refused until filled); Atlas's other answers
(the line writer is shared); Home's thank-you line and Atlas's next move (both read `afterMove`); the Connections
page's other cards.

**Needs a write:** 2, 3, 4, 5, 7 and 9 in org_stagewalk only. Never Harborlight.

**Still OPEN:** Setup Step 5 (Continue disabled after done; the $10,000 preset and Donors' Major) and the uploaded
logo as a green square: neither reproduced on staging on 27 Nov. If you see either again, note the exact screen,
file and browser.

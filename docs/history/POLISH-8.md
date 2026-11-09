# POLISH-8 · Dead buttons, missing controls and words that match the state (2026-11-09)

The lead report of 2026-11-09 listed twelve items. Each was reproduced first with real clicks on a production build: NODE_ENV=production, a separate worker, the built client behind local-preview. The fixture is `tests/lib/polish8Fixture.js`, and `tests/polish8.test.js` ran against main (red) before the fixes.

- **The email header is derived** (`shared/mailHeader.js`). Settings said "Steward sends nothing on its own until you turn it on here" while email was on and Journey and sequence steps was on. It now reads the switches: "Email is on. These send on their own: journey and sequence steps." or "Email is off. Nothing sends on its own."
- **"+ Link someone"** in the Household dialog toggled the picker, so with the picker already open from About it closed it. The picker also sat at the top of the dialog, out of sight above a household. The button now only opens the picker, and the picker sits right under it, focused.
- **Done tasks** have Delete (to the trash, with Undo) beside Reopen. The server lets a done linked task go to the trash too; a live next step still refuses.
- **Giving pages** have a Draft status. On Fundraising › Pages, a live page's menu offers Unpublish (a Draft page's offers Publish). A Draft page's link answers "This page isn't taking gifts right now", and it takes no gifts.
- **Board cards** wrap the name to two lines, with a tooltip. An erased person shows as "Former donor (erased)" (`shared/erasedLabel.js`). The label is computed on read; the stored name stays "Erased person".
- **The greeting** reads the org's hour, never the browser's: morning 5 to 12, afternoon 12 to 5, evening 5 to 10, and otherwise "Hi Mike".
- **Files**: the header and the tab count uploads only, and attachments are their own line. This reverses FLOWS-2's choice to count both, by the brief's rule.
- **Duplicate names** (`shared/dupeNames.js`): campaign rows, templates and the Reports filter show when each was made and its status. A Rename sits beside them (`server/outreach/rename.js`), which changes the name only.
- **The Sent chip** on Campaigns reads `reachedAnyone`, as the figures do since POLISH-7.
- **Goal tiles name their period** (`shared/periodWords.js`): Home's goal, Home's goal cards and the campaign thermometer.
- **Your moves**: Snooze, Set aside and Done take the move off the deck before the server answers (optimistic), and put it back if the server refuses. On main, Keep's count held its old number for 300 to 450 ms after the click.
- **"13 people with a next step"** was not reproduced. The count opened its list of 13 on main at 1440, with 3 and with 13 people. It stays in polish8 §2 as a guard.

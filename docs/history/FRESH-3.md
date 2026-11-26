# FRESH-3 · Finance, Volunteers and Events re-read after every write, and one tab's org stays its own

From Jarvis's lead, Thu 26 Nov (W-1112-Volunteers-01X, W-1126-*), and the fleet's own failure that night:
a shared browser profile flipping between two orgs for 25 minutes.

- **Finance was half-wired.** The main tiles heard money writes since FEEL-1; This month, Pledges,
  Recurring giving, Restricted and Month close read once on mount. Reproduced on staging c2e96c9:
  "Money in this month" stayed put after a gift add, edit, delete and pledge payment. Every Finance
  panel is now a named surface on FRESH-2's helper, and the census fails a money write that reaches
  none of them.
- **"Schedule conflicts stays 0" was the wrong week.** The card always counted the org's current week;
  the cards it sits above showed the week on screen. One list now makes both (server/volunteers/shownConflicts.js).
- **Mark as former in Recent changes was not reproduced** on staging or locally (POLISH-11's line and
  the audit row both appear). Left OPEN for the fleet's exact path.
- **Campaigns "No campaigns yet" was not reproduced.** Overview and the list read the same answer.
  The list now says "No campaigns yet" only when /fundraising/campaigns is empty too, names its filter,
  and never denies campaigns that are on file.
- **Tabs.** The token is one per browser; a switch re-issued it and signed the old one out, and a request
  already in flight with the old token got a 401 that cleared the new one: everyone signed in again.
  A tab now names its org and its person; the server honours the tab's org for the same person while
  she is a live member there (server/auth/tabOrg.js). Another person's sign-in is still refused 409.
- **Small ones.** An active volunteer re-applying is told so and listed; a written-off pledge says why it
  can't be deleted; an import's own gift line no longer holds its people back from Undo.

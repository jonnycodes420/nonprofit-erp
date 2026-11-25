# FRESH-2 · Every list and count re-reads after a save, everywhere, from one place

From Jarvis's mega sweep (Wed 25 Nov), root cause B: "Home Thread and the profile sidebar update
immediately, which proves the fresh data exists; list and count surfaces do not re-read."

- **Most of the sweep's list was already right on staging 87433bc.** Reproduced with real clicks in
  org_stagewalk before anything was fixed: hour delete, event delete, check-in, a touch from the
  profile, + Add on Team, and a question to Atlas all moved within a second. Two were stale:
  the profile's Notes summary line after a gift (prod's finding) and Communications → Overview →
  Recent sends after a campaign was deleted.
- **"Campaign list lags one step behind" was the Undo toast.** Timed on staging, the server and the
  Fundraising list were both fresh at 700 ms; the deleted campaign's name stayed on the page in
  "Deleted the … campaign. Undo", which a whole-page read takes as the list.
- **Why the two lagged.** The Notes line read the record Donors.jsx handed the profile, which only
  `selectDonor` ever re-read; the profile's own panels heard the change. Recent sends was read once
  on mount. Reading the code found two more of the same: the Volunteers hub heard only `volunteer`,
  never the `person` a delete says, and `usePeopleById` (Home's rail person view) never re-read.
- **One helper.** `lib/liveRead.js` sits on LIVE-2's channel. Every surface in the sweep uses it,
  named, with literal topics, so a static census can check each against what it shows.
- **A race in api.js.** A GET that left before a write and landed after it filled the 60-second
  keep with the old answer (the officer list is a kept read). It is handed over, never kept.
- **Atlas.** Questions read live. Only the follow-ups re-draw stored rows; they now say when a gift
  or a person changed after that answer.

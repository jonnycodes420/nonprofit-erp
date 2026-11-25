# FRESH-1 · Every count is right the moment something changes, and a Ship never breaks an open page

From Jarvis's power-use sweep (24 Nov, staging Harborlight and prod CREO Arts Demo).

- **Empty trash left the row and "1 person is in the trash".** The server's X-Steward-Changed was
  right for every write the fleet clicked (delete, Restore, Empty trash, a cash gift, an attendee:
  checked on staging and in the stale2 census). The Trash list itself never listened: only its own
  Restore re-read it. It and Empty trash's count now re-read on every person change.
  Delete from a profile and Restore with real clicks on staging updated the tab counts and
  "Trash (n)" within 1.5 s on the merge base, so those parts were not reproduced.
- **A Ship crashed an open page.** A page left open across a deploy asks for chunk files the new
  deploy no longer serves. `client/src/lib/chunkReload.js` reopens the page once at the same
  address ("Steward was just updated. Reopening…"), from Vite's `vite:preloadError`, an unhandled
  import, FIX-56's `retryImport` and every error boundary. A second failure inside a minute shows
  the error with Reload, so a broken deploy never loops. Proved by building, opening Donors,
  rebuilding with new hashes and clicking Record a gift (its date box is a chunk).
- **Notes or tags.** The engine already read it (groups.js requires textMatch.js; the brief's
  "required by nothing" was a grep miss) and staging's Directory, Team and Re-engage all narrowed.
  It now matches whole words (Postgres `\m…\M`, what she typed escaped) and the empty list says
  "Nobody's notes or tags mention 'zzzzqq'".
- **Export** names its file from the server (the org's today) and says "Exported 1,119 people in
  donors-2026-11-24.csv."
- **Active goals** added the cards' raised in floats and rounded once; each card rounds its own.
  The headline is now the sum of the cards' whole dollars, added in cents.
- **Left for the next brief:** the editors' preview frame (BUILDER-2B is in `EmailFrame.jsx`), the
  Team view's "Nobody owns a donor yet" under a filter that matches nobody, and item 4 (not
  reproduced on the merge base: a $0 person added as a Donor reads Contact).

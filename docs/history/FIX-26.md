## FIX-26 · Leftovers from FIX-25 and PARITY-4 (2026-10-04)

- **Two recipient counts.** The builder counted the segment in the browser from
  `/donors/summaries`, which carries no `person_types`, so every volunteer and event
  guest with an email counted as a donor (1,198 vs 1,158 on the demo: 36 volunteers,
  4 guests). The server's count stopped at "has an email" while the send then skipped
  suppressed people one at a time. The send never used the browser's list: it always
  resolved the segment on the server. Now `campaignAudience` (server.js) runs
  `donorMailDecision` for every person in the segment (`donorMailDecisions` in
  routes/email.js reads flags and the suppression list in two queries and feeds the
  same function), and the builder shows only that count, with "N left out" opening
  the reasons. `personOnly` lets the count name people while the org gate (demo, mail
  off) is said once. mail-suppression §5 pins shown count = messages created.
- **QR on iPhones.** `jsqr` (130.6 KB, 47.4 KB gzip, its own chunk) is the fallback
  when `BarcodeDetector` is missing or does not read QR; imported only when Scan is
  pressed. Walked in Chromium with the detector deleted and a fake camera showing a
  real signed ticket.
- **Phone.** One `GlobalSearch` in TopBar.jsx serves the desktop bar and a header icon
  on a phone (`MobileSearch`). The builder's columns stack (`.cb-body`), and the event
  header's ticket URL is one line with Copy link.

## FIX-45 · What Muse found on Harborlight, fixed before the board demo (2026-10-19)

Muse walked the 18 Oct builds on prod Harborlight. Fifteen items, worst first; built by the parent session (capture items) and four forks in their own worktrees.

- **Confirm hang (1.1).** The first gift after a re-seed baselined every group by rule one insert per member: 1,238 sequential statements inside the confirm request (88s at a simulated 65ms round trip). `baselineGroup` is one statement now, and `recordGift({ deferTriggers: true })` runs sequences, journeys and the after-change step straight after the answer (`later`). Confirm answers in 1.9s at 65ms per statement. capture1-zero-day §9 injects 20ms per statement and bounds the statements the answer waits on (70; 92 without the deferral).
- **Undo (1.2).** Toast 60s with See all; `GET /recent-changes` (trash rows, skipped cards, people added by hand); Skipped filter in To confirm; restored rows un-delete their photos.
- **Check image (1.3).** `/donors/:id/materials` lists each gift's `cheque_asset_id` as a read-only Files row.
- **Joint greeting (1.4).** `shared/greeting.js`, one rule for every draft that greets.
- **Profile zeros (1.5).** The record's own read starts first, retries, and the tab shows no count until it answers.
- **Ask comebacks (1.6).** `readoutAnswer` no longer claims every "came back" question; askCatalog reads the comeback phrasings as the gift-based count.
- **Batch line (2.1), memo fund (2.2).** The slip line counts logged checks; `fundFor` adds close words (boat, boathouse; not words close to the org's own name) and a strict `pick_fund` model step with a confidence, low highlighted.
- **Giving pages (2.3, 2.4), search (2.5), em dashes (2.6).** Cover at order 0, 16:9; Remove menu on page cards; local narrowing while the server answers; `polish2-voice` §dash guard + `scripts/fix45-no-em-dash.js`.
- **Housekeeping (3.1-3.3).** `mailPolicy.orgSendsSql` keeps demo orgs and sample people out of every send sweep; `seedOrgData` no longer adds a second General Operating (the reconcile1-checks flake); two auction items carry several photos. **The seed changed: prod Harborlight needs a re-seed.**

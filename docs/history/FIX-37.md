## FIX-37 · An import never floods the thank-you queue, and big files don't make her wait (2026-10-12)

LIVE-1 drafted a thank-you for every gift from the last 30 days in a CSV, which is right for a monthly file
and wrong for a move: a first import from Salesforce would have landed a few hundred drafts for gifts the old
system already thanked, and LIVE-1's own test file made 9,644. The import now asks whether those gifts were
thanked, defaulting to "yes" for a first import, a recognised export and anything over 50 (`importThanks.js`),
and "already thanked" starts no draft, journey or sequence. A first import's readout is "What your history
shows" without "new donors". The recent-gift work moved behind the screen (`import_recent_jobs` /
`import_recent_work`, `runRecentWork` in routes/crm.js): 5,000 recent gifts answered in 11.2s on main and 0.4s
after, locally. Found on the way: undo left behind people the file created when a journey had written a line
on their timeline. Suite: `fix37-import-thanks`.

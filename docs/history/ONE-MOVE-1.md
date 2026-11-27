## ONE-MOVE-1 · One next move per person, the same on every screen (2026-11-27)

Duet's stress test found Home asking a lapsing $10,000 donor for $50,000 while her profile said "No money ask".
Three engines decided a person's move and ask: the Insights deck (Home, the Activity banner), `engagement.suggestedAsk`
(the Giving tab, /threads rows) and `profileStatus.nextAction`'s ladder. Home led a unit with its largest move;
`nextMoveFor` led with the first card by rank, so the Planned card won on the profile. Now `nextMoveFor` uses Home's
lead rule, and `server/insights/personAsk.js` gives the Giving tab, its suggested ask and /threads that move's ask,
falling back to engagement's only when there is no move. The lapsing card said "ask for what they gave last" while
`oneAsk` asked the largest-gift rule; it now asks the last gift and names it.

A household's move showed on every member as if it were theirs ("thank Bravo for the $50 gift" on the member who gave
nothing); it is labelled a household move, and the after-move step names whose gift it was. A trashed member drives
nobody's move: the Insights fingerprint counts trashed people, and a stale answer's pledge or gift from a trashed person
is dropped at read. One person's gifts on one day now make one thank-you draft (`also_gift_ids`); every mark-sent door
thanks all of them and Undo restores each. Home's thank-you list said "opened" for a draft she had read; it says "read".
The timeline no longer lists a pledge twice; the Tasks badge drops a task once it is done; the Journeys panel re-reads;
`bulk-delete` is no longer read as a person's id. Left OPEN for the next brief: one status word (item 4) and the Trash
count after a restore (item 5).

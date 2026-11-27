# ONE-MOVE-1 · For the fleet

**Surfaces changed:**
- Home: Your moves and Keep. A lapsing donor's ask is now "Ask $X: what they gave last, on <day>."
- A person's profile:
  - Activity tab: the Next move banner. "Household move" with its sentence. "Household: thank <giver> for the $X gift on <day>."
  - Giving tab: the "Next:" line and "Suggested one-time ask" ("The same ask Home shows." or "No money ask").
  - The rail's step rows (their ask).
  - The timeline (a pledge once).
  - The tab badges: Tasks counts what is still to do.
  - The Journeys panel, which re-reads after a change.
- Thank-you drafts: one draft per person per day; Mark sent and Undo.
- Home's thank-you list: "read", never "opened".
- Drafts to review: the backlog sentence says how many drafts are for gifts dated before its window.

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Make up a person whose gifts are every six months, with two of $50,000 and the rest $10,000, the last one about fourteen months ago.
   - Home → Keep: their move is Lapsing, "Ask $10,000: what they gave last, on <that day>."
   - Open them. Activity's Next move shows the same move and the same ask. The Giving tab's Next line says $10,000, and "Suggested one-time ask" says the same words, with "The same ask Home shows."
   - Off the happy path: record a new $10,000 gift today. The move leaves Lapsing on every screen after one re-read, never on one screen only.
2. **(Needs a write.)** Make two made-up people, put them in one household, and record a $50 gift for the first.
   - Open the second person. The step reads "Household: thank <first person> for the $50 gift on <day>.", with "The gift is <first person>'s. It shows here because you are in one household."
   - Give the first person a $1,200 pledge, then move them to the trash. Re-open the second person: no "Open pledges to collect" and no thank-you step for the trashed person's gift.
   - Restore the first person from the trash: their steps come back.
3. **(Needs a write.)** Record two gifts for one made-up person on the same day ($40 and $60).
   - Drafts to review shows one draft, thanking for $100. Mark sent: both gifts read thanked.
   - Undo: both gifts are back to not thanked and the draft is waiting again. A second Undo has nothing to do.
4. **(Needs a write.)** On a profile, add a task and tick it done: the Tasks badge drops by one at once.
   - Add a pledge: the timeline shows it once, never as both "Pledge" and "Pledged $X".
   - Start the person on a journey from Journeys: their Journeys panel shows it without a reload.
5. **(Read only, Harborlight.)** Open three donors from Home's Your moves. Each profile's Next move and Giving tab ask match the Home card's ask word for word.

**What could have broken nearby:**
- Atlas's brief reads the same next move (`nextMoveOf`).
- The Top 100 and Major Gifts rows read `/threads`' ask.
- The Acknowledgments backlog and Home's "gifts not yet thanked" read `DRAFTED`, which now counts a gift folded into a same-day draft.
- Letters, the agent's queue and a task's Mark thanked all mark drafts sent through `also_gift_ids` too.
- The Donors list re-reads after bulk trash (`bulk-delete` is no longer taken for a person's id).

**Needs a write:** checks 1 to 4 run in org_stagewalk only. Check 5 is read-only.

**Still OPEN:**
- Item 4: the header badge "Lapsed" against the Stage column.
- Item 5's Trash count after a restore.
Both are for the next brief, so please keep reporting them.

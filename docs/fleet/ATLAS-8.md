# ATLAS-8 · For the fleet

**Surfaces changed:** Tell Steward (Atlas): the answer under "Who should I call tomorrow?", "List them" and "Tell me more" right after an answer, "How many LYBUNT donors do we have?" (and SYBUNT, "How many lapsed donors"), "How much is left on the goal?", "Who stopped their monthly gift?", "Brief me on <name>" / "Tell me about <name>", the header over an answer Atlas couldn't give, and a new first line when reading (AI) is off.

**Clicks to try for the next three nights** (Harborlight, read only, unless marked):
1. Tell Steward → type "Who should I call tomorrow?" → Send. Under the line, every person is drawn: name, "· $X at stake", their reason, and "Together: $Y at stake". Add the drawn amounts by hand: they equal $Y, and $Y is the figure in the sentence. No figure in the sentence belongs to a person not drawn.
2. Then "Tell me more" (the button) → type "List them" → Send. The same people come back, in the same order, with the same total. Off the happy path: after "What is our EIN?", type "Tell me more": Atlas says there is nothing more behind that answer (never a new lookup, never "I can't answer that").
3. "How many LYBUNT donors do we have?" The count equals Reports → LYBUNT (this fiscal year) row count, the line ends "LYBUNT: gave last fiscal year, nothing yet this one.", and Open list opens that many people. Repeat with SYBUNT against Reports → SYBUNT.
4. "How many lapsed donors do we have?" equals Donors → Lifecycle: Lapsed, and ends with the Lapsed definition.
5. "How much is left on the goal?" The three figures (Raised, The goal, Left) match Home's annual goal bar; Left = goal − raised to the cent.
6. "Who stopped their monthly gift?" The people drawn are Home's stopped cards; each card's date is the org's day.
7. Open a person with a meeting or a volunteer shift on their timeline → Tell Steward → "Brief me on <their name>". The brief names that meeting or shift (newest first), the About note and About facts (employer, birthday, tags), and the next step. Never "No conversation logged" over a record with a meeting or shift.
8. When the org's AI is off (staging), every answer starts with "My reading is off for this organization, so I answered from Steward's own counts only…", above the header.

**What could have broken nearby:** Ask (the why answers' sentence for two people now says "across both"), the Home "Calls to make" panel (same `why.js call`), Reports → LYBUNT / SYBUNT (read, not changed), the Atlas bell lines, Open list from any Atlas answer, the profile's Call script (reads the same About facts), and viewers' and portfolio users' Atlas (a portfolio user's Atlas refuses the org-wide LYBUNT and Home figures, as it does Ask).

**Needs a write:** none of the above. Open list (it makes a group) is a write: run step 3's Open list in org_stagewalk only.

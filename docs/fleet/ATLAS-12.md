# ATLAS-12 · For the fleet

**Surfaces changed:** the Atlas dialog's answers to population questions (lapsed, LYBUNT, SYBUNT, monthly givers), giving
questions that name a surname ("Which one?" with a Both button), goal questions ("how much is left", "are we on pace", and
"and the <campaign>?" after one), a reported call ("I called … remind me …", a proposal card), a question with a part Steward
can't know, "who stopped monthly", and every person brief (its opening sentences). Ask's planner prompt now says "this year" is
the fiscal year. No screen layout changed.

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk; Atlas writes a request row.)** Open Atlas and ask, one at a time: "How many lapsed donors do
   we have?", "Who has lapsed?", "How many LYBUNT donors do we have?", "How many donors haven't given since last year?", "How many
   SYBUNT donors?", "How many donors gave before but not this year?". Right: each LYBUNT phrasing gives Reports > LYBUNT's row
   count, each SYBUNT phrasing Reports > SYBUNT's, each lapsed phrasing the Donors list's Lapsed 12+ months count, each with its
   sentence. Off the path: "How many donors gave last calendar year but not this year?" gives Reports > LYBUNT with Calendar year
   picked, and says "Counted in calendar years, as you asked".
2. **(Needs a write.)** With two people sharing a surname (org_stagewalk has two "L1rrlrq"), ask "How much did L1rrlrq give?".
   Right: "Two people match: Ada L1rrlrq ($150) and Gwen L1rrlrq ($100). Which one?" with three buttons. Press Ada: Ada's lifetime
   only. Ask again and press Both: "Ada L1rrlrq and Gwen L1rrlrq have given $250 together …". Nothing is summed before Both.
3. **(Needs a write.)** "How much is left on the goal?", "How far are we from the goal?", "Are we on pace?". Right: Home's goal
   bar's figures in one line: raised of the goal, what is left, the pace sentence and days left (Harborlight: the Annual Fund bar;
   org_stagewalk has no goal bar, so it asks which running goal, one button each). Then "and the <another campaign>?": that
   campaign's line, never the AI-off refusal.
4. **(Needs a write.)** "I called Rufus Tallgrass today. He said he will give $5,000 in January. Remind me Jan 5". Right: a
   proposal with a call (the note is her words) and a follow-up for Jan 5, nothing written until Save; never "I can't predict".
   Off the path: Discard it, then check Rufus's timeline and Tasks: no call, no task. "How much will Rufus give next year?" still
   says it can't predict (with what he gave this fiscal year).
5. **(Needs a write.)** "How much will Rufus Tallgrass give next year and what's his favorite color?". Right: two answers, the
   second "Steward doesn't know Rufus Tallgrass's favorite color."
6. **(Needs a write.)** "Who stopped monthly?". Right: everyone on Home's Drifting list who gives about every month (org_stagewalk
   has Marguerite Fallowmere A12 and Ansel Brookhart A12), plus any failed card, canceled or overdue plan, with the definition.
7. **(Needs a write.)** "Brief me on Fenwick Holdings, Inc.", "Brief on Hester Vanderpool", "Prep me for my call with Hester
   Vanderpool". Right: each a brief that opens "<Name> is …", then the last conversation or "No conversation logged yet.", then
   the next move, then the facts. Never "I couldn't find" for someone on file.

**What could have broken nearby:** Ask's answers that mention "this year" (now told it is the fiscal year, as its code already
read it); Ask's lapsed count (same rule, now read from the registry); Home's goal bar and Fundraising's campaign cards (Atlas
reads them, nothing on them changed); the group ask ("add every new donor to …") still plans a group; the Atlas bell's waiting
questions (a giving question now waits with three buttons); "Tell me more" after a brief.

**Needs a write:** every click above writes an Atlas request row; run them in org_stagewalk, not Harborlight.

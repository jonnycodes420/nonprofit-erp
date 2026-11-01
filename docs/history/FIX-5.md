## FIX-5 — Journeys, premium and yours (2026-09-28)

Six items, and the theme is that a journey stops being one of five fixed
shapes and becomes a thing an organisation writes.

**1. You can make one.** There was no way to create a journey except pressing
a preset, so every org's journeys were the same five shapes with edited step
labels. "Create a journey" is the emerald action at the top of the page: name
it, pick any trigger and its conditions (amount, stage, tag and the audience
filters, now STORED WITH the journey rather than re-picked inside the apply
dialog every time), then build the steps. Presets stay as "Start from one of
these", and pressing one the org already has now asks "You already have New
donor, first year. Open it, or make a copy?" instead of minting a second row
with the same name. Harborlight's duplicate went with the re-seed.

**2. It opens on arrival.** The most recently edited journey, or the first
that is On. A page whose whole job is a chain should not open as a list of
shut rows.

**3. The chain is a grid now, and that is the whole fix.** It was absolutely
positioned nodes inside a `height: 138` box: a step label that wrapped
overflowed the box and the dark preview panel below rode up through the
names. It is now one CSS grid, one column per node, four rows shared by every
column (timing caption, node, name, date). The shared baselines are not
arranged, they are the same grid rows; a wrapped name grows the name row for
every column at once, so no date is ever pushed down past its neighbours. The
one line sits IN the node row, centred, with negative margins carrying it to
both edges of the card, so it passes through the node centres instead of
floating above them. Column widths still carry real time but are clamped to
0.85-1.6, which is the answer to "reflects real time only as far as it stays
legible". Done is filled ink, today is an emerald ring, upcoming is outlined,
the selected node is raised, and the motion is 180ms and off for anybody who
asked for no motion.

**The preview earns those words.** "Done" has to mean done, so the preview
now prefers somebody ACTUALLY in the journey and shows their real step
statuses. Only when nobody is in it does it fall back to the arithmetic on a
trigger date, and then the states are past / today / upcoming and the caption
says which it is showing.

**4. Nothing bleeds.** The card is three flow rows: chain, then editor and
preview side by side, then the actions. None of them is positioned, which is
why they cannot overlap. At 390 everything stacks and the chain is a list.

**5. Everything is editable in place.** Name, one-line description, trigger,
conditions, priority, On/Off; and per step: what happens, its type, its
timing (days, weeks or months after the trigger OR after the previous step),
its owner, an optional draft, and a note. Drag reorders and retimes,
duplicate a step, duplicate a whole journey, remove one with an undo that
puts the same row back.

**Timing is input; `offsetDays` is storage.** "Two weeks after the previous
step" is resolved left to right into the one number the engine computes dates
from, and the words are stored beside it only so the screen can show her back
what she chose. A second unit would have been a second source of truth for a
date.

**And saving an On journey tells the truth about who it reaches.** The
existing rule is that changing a journey does NOT rewrite the people already
in it, on purpose. So the confirm says exactly that, names the count, opens
the rows behind it, and offers the opt-in: "Save and move the 4 already in
it", which moves PENDING steps only. Open, done and skipped steps have
already happened to somebody and are not ours to rewrite.

**6. Major donor stopped being an error.** Choosing it POSTed, failed
validation and printed "Set the amount that counts as a big gift" in
terracotta: an error for not having answered a question nobody had asked. It
now opens with "A big gift for us is $____", prefilled from their own gifts
(the 90th percentile single gift, rounded to a figure a person would say out
loud) with the sentence that says where the number came from and the 200
gifts behind it one click away. Red on this screen is for a destructive
confirm and nothing else, and the walk measures that rather than trusting it.

**Two additions, asked for mid-build.**

Every demo person has their own name. The pool was 30 x 30 = 900 pairs for a
file of about 1,150 people, so the draw ran out and minted 205 people called
"Donor 1002 Ashgrove", in the donor list of the screen the product is sold
on. Uniqueness was enforced on the derived EMAIL and only inside the tail
generator, which meant the hand-written people, the eleven, the volunteers
(their own separate pool, overlapping the donor one on both sides) and the
staff could all collide with the generated file and nothing noticed. There is
one registry now, every person goes through it, the pool is 64 x 72, the
filler-name fallback is gone, and the seed ASSERTS uniqueness against the
database at the end rather than against the registry that built it. It caught
two real collisions on its first two runs ("Fenwick Ravensmere", then
"Henrietta Stonebridge", who the tail had already minted before the household
fixture asked for her). The one repeated name that stays is the merge
fixture: ONE person with TWO records, which is the point of it, and it is
named in the assertion rather than allowed as a count.

And the donor profile's rail said "Before you go" twice, once as the rail
section's heading and once inside the panel underneath it. A section has one
heading and it belongs to the section.

**What the walk caught that the suites could not.** `scripts/fix5-walk.js`
measures the geometry at 1440 and 390: 63 assertions. Two of them were wrong
before they were right. The line-through-the-centres check passed against a
planted defect because `Math.max()` of an empty list is `-Infinity` and every
node in the one-step journey the walk had itself created was the selected
one, so the filtered list was empty: a guard that answers a question it
cannot see. It now refuses to answer below two resting nodes, and it opens
the seven-step journey deliberately rather than measuring whatever opened.
The second was the same class: clicking a row header TOGGLES, so "open the
seven-step journey" shut the one that was already open and measured a chain
of nothing.

The money guard caught the other one. The rows behind the big-gift suggestion
formatted a real gift with `Math.round`, which would have shown $4,000.50 as
$4,001 in the rows behind a number. `sentenceMoney`, like everywhere else.

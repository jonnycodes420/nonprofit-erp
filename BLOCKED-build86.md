# BLOCKED — BUILD-86 C.1 (the palette)

Nothing here blocks the demo. This records the one part of C.1 that must not
be attempted the night before it, and what was done instead.

---

## The census asked for zero. It is 1,325.

> *"A token census: grep the client for hex colours and rgb() outside the token
> file; zero allowed."*

**Measured before touching anything: 1,404 hex literals across 49 files in
`client/src`, plus 124 `rgb()/rgba()`.** After C.1's green collapse: 1,325.

Getting to zero is not a colour change. It is roughly sixty distinct values
collapsing into four, and **which** of the four each one becomes is a design
decision per usage, not a mapping. `CLAUDE.md` already records this exact work:

> *"a full migration is a separate, deliberate, non-overnight pass (do not
> attempt as a risky repo-wide sed on the live app)."*

Tonight is the night before a 7:00 AM demo. A repo-wide sed across 49 files,
where every mistake is invisible until a screen renders, is precisely the risk
this build's own hard stop exists to prevent.

## What was done instead, and why it is not a weaker rule

**1. The parts of the rule that could be finished tonight are at ZERO and
asserted at zero** (`tests/palette-census.test.js`):

- **One action colour.** `#10b981` (the retired Tailwind emerald, 83 literals)
  and `#1a6b4a` (the second green, 135) are **gone from the authenticated app**,
  and `T.green`, `T.greenMid` and `T.greenDk` all point at emerald `#0d5c3a`.
  358 call sites now render one colour without one of them being edited.
  **Contrast improves in both directions**: `#10b981` carried white text at
  ~2.3:1 and now carries it at 8.6:1; `#1a6b4a` read on cream at ~4.6:1 and
  now reads at ~7.4:1.
- **No bright library red** anywhere on a live surface.
- **Overdue is brass, not red**, on the screen she opens every morning: the
  band header, the row rule, the row's reason line, and the failing-gift rows.

**2. Everything else RATCHETS.** The census records today's counts as ceilings
that may go **down and never up**. A build that adds a literal fails; a build
that removes ten lowers the ceiling permanently, and the suite prints a note
telling you to lower it when the gap opens.

A ratchet is not a softer rule than "zero". It is the same rule with a date on
it, and unlike a TODO it cannot be quietly lost.

## The two that need a decision, not just time

**Sage `#8FA896` (104 literals) cannot simply be deleted.** It is the secondary
text colour **on ink panels**, and the rule's replacement — warm grey
`#5A554F` — scores about **2.0:1 on ink**, a clear AA failure. The product has
a hard contrast guard (`tests/palette.test.js`) that would refuse it, correctly.

The fix that keeps both the four-colour rule and AA is to treat dark-surface
secondary text as **cream at reduced opacity** — cream is already "white's warm
shade, not a fifth colour" by the rule's own wording, so `rgba(240,237,230,.72)`
adds no colour and lands around 8.5:1. That is a real design call about how the
dark surfaces read, and it wants eyes on a screen rather than a sed at 11 PM.

**Terracotta is still the destructive colour and still `#b8593f`**, which
`tests/palette.test.js` locks by value with the note *"a treasurer needs red to
mean red"*. C.1 moved **status** off it. Removing the ramp entirely would mean
re-deciding every error wash and destructive outline in the product, which is
the same non-overnight pass.

---

**Recommendation:** finish the sweep in its own build, in three commits —
sage → cream-alpha on dark, terracotta → brass for the remaining status uses,
then the long tail of literals to tokens — each with the census ceiling lowered
in the same commit. Nothing about it is urgent, and all of it is safer with
daylight.

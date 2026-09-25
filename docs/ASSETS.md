# Artwork in this product, and where it came from

One row per piece of artwork Steward draws that somebody outside this repo
might have rights in. A row is **cleared** only when Jonathan has established
the licence himself and written his initials and the date in the Cleared
column. Nothing else clears a row: not a build, not an agent, not "it is
obviously fine".

Sibling to `client/src/assets/sources/SOURCES.md`, which covers other
companies' *logos* and is a stricter document — a logo is never traced,
approximated or redrawn under any circumstances. This file covers artwork
Steward draws itself, where the question is not "is this their mark" but
"whose picture was this before it was a path".

## The rows

| Asset | Where it lives | Origin | Licence | Cleared |
|---|---|---|---|---|
| Horse silhouette (welcome motif) | `WELCOME_MOTIFS.horse` in `client/src/components/shared.jsx` — one SVG path, `viewBox="0 0 298 193"` | **Traced from a reference bitmap Jonathan supplied.** Five hand-drawn attempts produced a sheep, a deer and three ponies; the honest answer was to stop drawing and trace the shape he actually wanted. Traced by a contour follower (Moore-neighbourhood border following + Douglas-Peucker) over the supplied bitmap. | **UNKNOWN — see below** | ☐ not cleared |

## The horse, stated plainly

**Nobody can currently answer where the reference came from.** The bitmap and
the tracing script lived in a scratchpad (`scratchpad/horse/ref.webp`,
`scratchpad/horse/trace.js`) and were never committed, so the file is gone and
cannot be inspected. The only record is the provenance comment above
`WELCOME_MOTIFS` and this row.

That leaves exactly one open question, and it has to be answered by the person
who supplied the file: **was that image his own, or did it come from a stock
library or a web search?**

- If it was his own, or public domain, this row gets his initials and closes.
- If it came from a stock library, the licence governs whether a **derivative
  traced outline** may be redistributed in a commercial product. Many stock
  licences permit exactly that; some forbid it; a few require attribution.
  Tracing does not make it new work — a silhouette traced from a photograph is
  a derivative of the photograph.

**The exposure today is not hypothetical.** The motif is drawn by
`orgs.welcome_motif`, and `horse` is set on `org_justinsplace`, which is a
REAL organisation, not a demo org. The greeting is armed and will draw the
herd the first time Allie signs in. BUILD-96 deliberately did not disable it —
her greeting is hers and this build was told not to touch her org — so the
gate is this document plus `BLOCKED.md`, and the answer is needed before she
signs in rather than after.

## What is NOT in this file, and why

Everything else Steward draws is geometry with no origin to trace: the
wordmark is type, the icons are paths written from nothing, the palette is
tokens, and the charts are computed. No photograph, illustration or font
beyond the two Google families loaded by URL (`DM Sans`, `DM Serif Display`)
is redistributed by this product.

If you add artwork that was traced, adapted, generated from a reference, or
downloaded from anywhere, **add a row here in the same commit** — and commit
the reference file alongside it, which is the step that was missed for the
horse and is why its row cannot be closed.

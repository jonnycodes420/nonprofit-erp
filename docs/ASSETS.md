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

## CKRH's logo — `client/src/assets/orgs/ckrh-logo.svg`

**Whose:** Central Kentucky Riding for Hope (Lexington, KY), a Steward customer.
**Where from:** downloaded from their own website,
`https://ckrh.org/wp-content/uploads/2024/01/CKRH-LOGO-01.svg`, on 2026-09-29.
The file is committed unmodified, which is the step the horse row records as
missing — it can be inspected and compared against the source at any time.

**Why it is here at all:** it is uploaded to `orgs.logo_data` for their own org
by `scripts/ckrh-provision.js`, so it appears on their own receipts, their own
giving pages and their own first-run greeting. Steward does not use it to
identify Steward, does not put it on marketing, and does not show it to any
other organisation. That is a customer displaying their own mark inside their
own account, which is what every logo-upload field in the product is for.

**Open:** nothing blocking. The one thing worth doing, when convenient, is
telling Sarah it is there — an organisation should know which of its files a
vendor holds. If CKRH ever asks for it to be removed, delete this file and this
row and clear `orgs.logo_data` for their org; nothing else references it.

## Marketing photographs on Home (LANDING-5, 2026-10-05)

Every photograph on Home is a free Unsplash photo under the Unsplash License
(commercial use allowed, no attribution required, no Unsplash+ photos). They
were downloaded for LANDING-2; the full list of every marketing photo, with
its slot, is `docs/landing/photo-credits.md`. The credit is the photographer
named on each linked Unsplash page (the names were not recorded at download,
and Unsplash refuses automated lookups, so the link is the record). The
product crops beside them are Steward's own screens of the Harborlight demo
org (`client/public/marketing/product/inset-*.webp`).

| Asset | Where it is on Home | Source | Licence | Cleared |
|---|---|---|---|---|
| `desk-phone.webp` | Hero, large | https://unsplash.com/photos/BXLy_lXu5j0 | Unsplash License | ☐ |
| `volunteers-boxes.webp` | Hero, small | https://unsplash.com/photos/jgm-LddkD88 | Unsplash License | ☐ |
| `phone-laughing.webp` | Pillar 1, Never lose a single believer | https://unsplash.com/photos/L9U5UUScnHY | Unsplash License | ☐ |
| `laptop-delighted.webp` | Pillar 2, Technology that knows its place | https://unsplash.com/photos/-zf6Y2mq0SQ | Unsplash License | ☐ |
| `table-papers.webp` | Pillar 3, One home for everyone who believes | https://unsplash.com/photos/155XFb3xHpY | Unsplash License | ☐ |
| `reading-letter.webp` | Pillar 4, Numbers you can stand behind | https://unsplash.com/photos/DVvY7-TSzTo | Unsplash License | ☐ |
| `trainer-laptop.webp` | Pillar 5, You don't have to tear anything down | https://unsplash.com/photos/WX0scXYukVo | Unsplash License | ☐ |
| `video-call.webp` | How it works | https://unsplash.com/photos/pccGXVm8XVM | Unsplash License | ☐ |
| `laptop-coffee.webp` | Lost & Found | https://unsplash.com/photos/ITTqjS3UpoY | Unsplash License | ☐ |

Pillar 6 shows the founder's own portrait (`client/public/landing/jonathan-atkinson.png`), never a stock photo.

## What is NOT in this file, and why

Everything else Steward draws is geometry with no origin to trace: the
wordmark is type, the icons are paths written from nothing, the palette is
tokens, and the charts are computed. No illustration or font beyond the two
Google families loaded by URL (`DM Sans`, `DM Serif Display`) is redistributed
by this product; the marketing photographs are listed above and in
`docs/landing/photo-credits.md`.

If you add artwork that was traced, adapted, generated from a reference, or
downloaded from anywhere, **add a row here in the same commit** — and commit
the reference file alongside it, which is the step that was missed for the
horse and is why its row cannot be closed.

# Source logos and brand clearance

One row per company whose name Steward puts in front of a person. A row is
**cleared** only when Jonathan has read that company's own brand terms himself
and written his initials and the date in the Cleared column. Nothing else
clears a row: not a build, not an agent, not "it is obviously fine".

This file is the third of the three conditions in `shared/publicSources.js`.
A source appears in the PUBLIC row on the landing page only when its adapter is
merged and green, **and** it has been walked on a real account on prod, **and**
its row here is cleared. All three, every time.

## The rule about the files themselves

Logos are the official files, unmodified, downloaded from the company's own
brand page. Never drawn in code, never traced, never recoloured, never
re-typeset, never an SVG path somebody approximated. If the official file is
not in this directory, the tile shows the company's name in type, which is a
perfectly good tile and is what every one of them does today.

**No logo file has been fetched.** This directory holds this document and
nothing else. Every tile currently renders in type.

## The rows

| Source | Adapter | Walked on a real account | Brand page to read | Logo file | Cleared (initials + date) |
|---|---|---|---|---|---|
| PayPal | merged, green | **no — connects and reads zero** | PayPal Logo Center, reached from paypal.com → Business → Brand/Logo Center | none | no |
| Zeffy | merged, green | no | Zeffy's press/brand page, reached from zeffy.com footer | none | no |
| Stripe | merged, green | no | stripe.com newsroom → brand assets | none | no |
| Givebutter | merged, green | no | givebutter.com press/brand kit | none | no |
| Square | merged, green | no | squareup.com press/brand assets | none | no |
| Cash App | n/a — statement upload | n/a | cash.app press page | none | no |
| Venmo | n/a — statement upload | n/a | venmo.com brand guidelines | none | no |
| QuickBooks (Intuit) | **not built — see NEEDS-JONATHAN.md §2** | no | Intuit trademark and brand guidelines, via intuit.com legal | none | no |

**The brand-page locations above are descriptions of where to look, not fetched
and verified URLs.** No page was opened in the build that wrote this file, and
writing a link that has not been loaded would be inventing a citation. When a
row is skimmed, replace its description with the real URL and the date it was
read, in the same edit that fills in the Cleared column.

## Notes per row

**PayPal** is the closest to clearing and is still short by two. The connection
authenticates and returns nothing. That is not evidence the mapping is right;
it is the absence of evidence either way. The walk is one dollar from a
personal account to the business account, then Check now a few hours later, and
the row shows once at $1.00 gross with the fee beside it.

**Cash App and Venmo** need clearance for their names and marks like anybody
else, but they are not allowlisted and never will be, because they are in the
statement-upload group. A tile that says "once a month, drop the statement in"
claims no relationship with the company at all, so there is nothing in it that
could turn out to be false. They are pinned out of the direct group by the
registry's own `mode` and by a guard in `publicSourceRow` that throws.

**QuickBooks (Intuit)** has the strictest terms of the seven and is the one to
read most carefully. "Works with QuickBooks" is allowed only in the exact forms
Intuit's guidelines permit, and there is no QuickBooks adapter yet in any case:
BUILD-91 91f stopped for want of the development keys.

## Turning logos on, once rows are cleared

1. Put the official, unmodified files in this directory beside this file.
2. Fill in this table: the real URL, the date read, the filename, the initials.
3. Register the files in `SOURCE_LOGOS` in `client/src/components/Settings.jsx`
   and flip `SOURCE_LOGOS_ENABLED` to true — that one flag drives the in-app
   page.
4. Pass the same map as `logos` to `publicSourceRow` in
   `client/src/pages/Landing.jsx` — that drives the public row.
5. Add the source's key to `PUBLIC_SOURCE_ALLOWLIST` in
   `shared/publicSources.js` **only if it has also been walked on a real
   account**. A cleared logo is one condition of three, not a green light.

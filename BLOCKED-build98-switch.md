# BLOCKED — BUILD-98 (switch)

Decisions this build could not make for itself. The brief names `BLOCKED-build98.md`;
the BUILD-98 label was already used by the photos build (8feaf60), so this file
carries the `-switch` suffix the build's other files carry.

---

## Part 1 · soft credits, tributes, matching gifts

### 1.1 · There is no Bloomerang preset to extend yet
The brief says "the NPSP and Bloomerang presets map them". The NPSP preset
(`shared/npspPreset.js`) now maps NPSP's tribute and matching-gift fields.
**No Bloomerang preset exists** in the repo; building one is Part 7 (migration
presets, each with a vendor fixture and an answer key). Until then a Bloomerang
export is read by the ordinary mapper, whose auto-detection now recognises the
column names Bloomerang's documentation uses ("Tribute", "Tribute Type",
"Soft Credit"). Recorded as **documented-not-walked**.

### 1.2 · NPSP soft credits need a report nobody exports by default
NPSP keeps soft credits on **Opportunity Contact Roles**, not on the
Opportunity. A plain Opportunity report does not carry them. The preset maps
"Soft Credit Contact", which is what a report that adds the role's contact
shows. **Decision for Jonathan, with the first real NPSP file:** does Justin's
Place's export include contact roles? If not, soft credits need a second file
(or a third sheet), and Part 7's NPSP migration checklist should say to run it.

### 1.3 · A tribute notice is a draft, never a send
The in-memory notice to a family is written, queued (`GET /tribute-notices`)
and marked sent by a person. Steward does not email it. Sending it would be
donor-facing mail to someone who is not a donor, on the worst week of their
life, and BUILD-75 C.2 says a human commits that. If the notice should also be
sendable from Steward, that is a deliberate product decision, not a default.

### 1.4 · The family is never told the amount
The notice module is handed no amount, so it cannot state one. That is the
convention every tribute programme follows. If an org wants the amount on the
notice (some do, for a named-fund memorial), that is an opt-in per org, not a
change to the default.

### 1.5 · The workbook importer is not wired yet
The one-file CSV/transaction importer carries soft credit, tribute and
matching employer columns. The multi-sheet **workbook** importer
(`STANDARD_GIFT_FIELDS`, BUILD-82) already has a "Soft credit to" field that
routes soft-credit ROWS into relationship links; it does not yet read tribute or
matching-employer columns. Part 7's presets are where that lands.

---

## Part 2 · acknowledgments and letters

### 2.1 · Steward prints; it does not post or email the letter
The batch is a PDF and a set of labels. Emailing an acknowledgment from the
same screen would be donor-facing mail from a template, and BUILD-75 C.2 says a
human commits that — the 88b thank-you queue remains the one-at-a-time email
path. If Jonathan wants "email the batch", it is a campaign-shaped send with its
own mail kind and its own decision.

### 2.2 · The window position is the #10 double-window standard, not measured
`ACK.WINDOW` is set from the common #10 window spec (4½ × 1⅛ in, ⅞ in from the
left, 2 in down once folded). **Print one on the org's actual envelopes before
the first real batch** — window envelopes vary by a few sixteenths, and moving
the block is one constant.

### 2.3 · Labels are Avery 5160 only
The 30-up 1 × 2⅝ in sheet is the one most offices stock. Other sizes are a
geometry table each, added when someone asks.

---

## Part 3 · reports people can build

### 3.1 · The weekly email carries the first twenty rows in the body
A scheduled report is internal staff mail to its owner. It carries up to twenty
rows inline and links to the rest. For a report about donors that is donor
data in an inbox; if an org wants the email to say only "your report is ready"
with no rows, that is a per-report setting to add, not a default to guess.

### 3.2 · Standard reports are fiscal-year by default
LYBUNT, SYBUNT, retention and gifts-by-month run on the org's fiscal year (the
July-1 rule, or the org's own fiscal start month). A calendar-year variant is a
saved copy away; say if the twelve should default to calendar instead.

### 3.3 · Scheduling is weekly only
The brief says "schedule as a weekly email". Monthly is one more period key and
one more line in `SCHEDULES`, added when somebody asks for it.

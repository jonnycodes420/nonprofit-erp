# BUILD-101 — Memberships

**Repo:** `nonprofit-erp` (Steward). Runs after BUILD-98 Part 2 (letters and receipts) and Part 4 (the quid-pro-quo split on `recordGift`). Own worktree, own port, branch `build-101`, CI-gated pushes. Queued behind BUILD-98 (Parts 7 and 8) in the same tab; branch from main after 98 merges.

**What this build is.** Memberships the way an arts center, a museum or a zoo actually runs them: levels with a price and benefits, a join date and an expiry, renewals that come around every year, and a member who is not the same thing as a donor even when the same person is both. Bloomerang's Membership Management in Steward's terms. Nothing here sends a renewal notice by itself; Steward drafts it and a human sends it.

**Standing rules.** Every write carries an actor. Every number on screen has a sentence. A membership payment is money and goes through `recordGift`, never a second insert. A benefit has a fair-market value the ORG states; Steward never estimates it. Agents draft, a human signs anything that reaches a person or touches money. Thirty minutes a part, commit green, move on with a note. Affected suites per commit; the full battery is the gate and nothing is called done before it runs. Tenant battery before Parts 1, 2 and 4.

---

## 1. Levels and memberships

A level belongs to an org: name, price, term (12 months, calendar year, or lifetime), benefits as a list of lines, the fair-market value of those benefits, and whether it is individual or household. FMV greater than price is refused at the route and by a CHECK constraint, the BUILD-98 event-level rule. A membership is one person (or one household) on one level: joined, starts, expires, status (Active, Grace, Lapsed, Cancelled), how it was paid, and the payment gift it came from. One active membership per person per org, enforced by a partial unique index, not an if-statement.

A payment for a membership is a gift through `recordGift` with `quidProQuoValue` set to the level's FMV, so the existing receipt states the deductible split with no new renderer. Membership money and donation money are the same ledger rows; the split is a fact on the gift, never a second total.

Memberships show on the person's record beside giving, and on a Members screen under Fundraising: counts by level and status, sortable by expiry.

**One test.** A $100 membership with $25 FMV writes one gift of $100, a deductible of $75 on the receipt, and one active membership; a second active membership for the same person is refused by the database; org A cannot read org B's members.

## 2. Renewals that come around

Expiry drives everything. A membership inside the org's renewal window (default 30 days) opens ONE Thread on the owner, "Renew Maya's Family membership, expires 14 March", with a renewal note already drafted in the org's voice on `threads.draft_note` (the 88b pattern). Past expiry the membership moves to Grace for the org's grace period (default 30 days), then Lapsed. A renewal payment from any door (manual, online, deposit sheet) extends from the old expiry, not from today, so paying early never costs a member time. Deceased, do-not-contact and do-not-solicit get no renewal Thread.

Home gets one line only when non-zero: "Six memberships expire this month."

**One test.** A membership expiring in 20 days opens exactly one Thread with a drafted note; running the sweep twice opens nothing new; an early renewal extends from the old expiry; a lapsed member never appears in the lapsed-donor list and vice versa.

## 3. Lapsed members are their own list

A lapsed member and a lapsed donor are different people with different asks. Members screen gets its own Lapsed tab: who, which level, when it lapsed, lifetime membership years. It never feeds Drift, LYBUNT or SYBUNT, and those never feed it. A person who lapsed as a member but still gives is shown as both, honestly.

**One test.** A member who lapsed but gave a gift last month appears in lapsed members and not in LYBUNT; Drift's computation is byte-identical with and without the membership rows.

## 4. Selling it online

The public giving page gains a membership mode, `?membership=<levelId>`, the same shape as the BUILD-98 `?event=` ticket mode. The SERVER prices it from the level (the page's amount is ignored), one-time or auto-renewing through the existing recurring subscription path, and the webhook re-reads the level before writing the gift and the membership. Auto-renew memberships ride the existing dunning and card-expiry machinery unchanged.

**One test.** A tampered amount on the page still charges the level price; the webhook writes one gift and one membership; a redelivered webhook writes nothing new; an auto-renew membership that fails its card enters the existing recovery cadence.

## 5. Directory, card and reports

A members directory (printable, CSV through the one `sendReportCsv`) and a member card PDF (name, level, expiry, org letterhead) on the same pdfkit pattern as receipts. Saved reports (98 Part 3) gain: members by level, expiring next 60 days, lapsed members, new vs renewed by month, membership revenue beside donation revenue (two lines, never summed into one "revenue").

**One test.** The five reports reconcile to a hand count on the fixture in cents; the card PDF is one page; the directory CSV carries the injection guard.

## 6. Import

Presets on the mapper, never a second importer: a plain spreadsheet (name, email, level, joined, expires), Salesforce NPSP membership fields on Opportunity, Bloomerang memberships, Little Green Light. Levels named in the file are matched to the org's levels case-insensitively; an unknown level is held for a human, never created with a guessed price. Imported memberships are history: they never open a renewal Thread for a date already past, and they never post to the ledger.

**One test.** A 50-row fixture imports 50 memberships on 4 levels, opens renewal Threads only for the ones inside the window, holds the two rows with an unknown level by line number, and posts nothing.

---

## HOW THIS BUILD ENDS

Full battery green (the only accepted red is giving-page-builder, and only if proven to be the :4173 preview again), tenant battery, landing verifier, prod smoke, CI green, both SHAs, "prod is N behind main." On the demo org: three levels, a dozen members across Active, Grace and Lapsed, one renewal Thread with a drafted note, one online membership through the test webhook, and the members-by-level report reconciling. Report each part with commit and minutes.

## FOR JONATHAN

- Renewal window (30 days) and grace period (30 days) are org settings. Change the defaults if a prospect says otherwise.
- FMV per level is the org's number. An org that leaves it at $0 gets receipts that call the whole membership deductible, and the level screen says so in a sentence.
- Nothing about memberships goes on the marketing page until one real org has run a renewal through it.

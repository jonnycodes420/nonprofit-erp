# BUILD-98 — Worth switching from Bloomerang

*(Committed verbatim as it was handed over on 23 September 2026. The BUILD-98
label had already been used for "a face is attached to the person" (8feaf60),
so this build's files carry a `-switch` suffix. BUILD-96's brief was never
committed and is lost; this one is.)*

**Repo:** `nonprofit-erp` (Steward). Written 23 September 2026. Runs after BUILD-97 Part 1 (one real file, reconciled by hand). Nothing below is worth building on top of an import that has never met a real export; parity with broken numbers is a demo, not a product.

**The decision this build records.** Steward is a full donor CRM. The buyer is every nonprofit, including the ones already on Bloomerang, Little Green Light, DonorPerfect, Neon or Salesforce. The promise is "switch to Steward and lose nothing you use, gain the follow-up and the agent." Not "stack Steward on top." Every part below closes a gap a Bloomerang user would name in the first ten minutes of a demo, ordered by how often they'd name it.

**What Steward already has and Bloomerang does too.** People and households, gifts, pledges with instalments, recurring with failed-card recovery, funds, custom fields, import with a mapper and dedupe, timeline, tasks, email campaigns from the org's domain, sequences, giving pages with a builder, receipts, bookkeeper export, giving-source reads (PayPal, Zeffy, Stripe, Givebutter, Square), photos, people types, board dashboard, multiple users and roles, tenant isolation with a battery. **What Steward has that Bloomerang doesn't:** Drift in the donor's own pattern, the Thread, cheque photos and reading, the instructable agent (97 Part 3), no per-record price tiers.

---

## RULES

Same as 97. Thirty minutes a part, then commit green and move on with a note. Tenant battery before anything touching money or org data. Full battery once per part, untouched. Push, CI by name, both SHAs, "prod is N behind main." `BLOCKED-build98.md` for decisions. Every number on screen has a sentence (97 Part 2 stands). No AI writes to a donor without the 97 Part 3 signature.

Parts are ordered by demo frequency. Do them in order unless a signed customer needs one sooner.

---

## 1. Soft credits, tributes and matching gifts

The first thing a Bloomerang user checks. A gift can carry: **soft credits** to one or more people (the DAF recommender, the spouse, the board member who asked), each with a percentage or amount, so lifetime totals can be shown hard or hard-plus-soft; **in honour of / in memory of** with the honouree as a person record (or free text) and a notify-someone address for the acknowledgment; **matching gift** linkage, an employer organisation record, and the expected match as a pledge that auto-applies when the match arrives. Import mapper gains all three as column targets; the NPSP and Bloomerang presets map them. Reports and the bookkeeper export show hard credit only unless asked.

**One test.** A $1,000 gift via Schwab Charitable soft-credited 100% to Margaret: Schwab's lifetime is $1,000 hard, Margaret's is $0 hard and $1,000 with soft, the ledger posts once. An in-memory gift produces an acknowledgment draft addressed to the family. A matched gift closes its pledge in cents.

## 2. Acknowledgments and letters that print

Bloomerang's acknowledgment letter with merge fields, printed or emailed, and the "unacknowledged gifts" view. Steward has the drafted thank-you queue (88b). Add: letter templates with the org's letterhead, merge fields, a print-ready PDF for a batch (one PDF, one page per donor, windowed-envelope address block), mailing labels, and a year-end giving statement per donor for the tax year with the IRS language and the org's EIN once entered. Every gift carries acknowledged-by, when and how. The queue shows unacknowledged gifts older than N days with N per org.

**One test.** Twenty unacknowledged gifts produce one PDF of twenty pages with correct merge fields and addresses; marking sent stamps each gift; a year-end statement for one donor foots to their gifts in cents.

## 3. Reports people can build

Bloomerang's report builder is the feature people say they'll miss. Build one: pick an entity (people, gifts, pledges, recurring, interactions), pick columns, filter with and/or groups on any field including custom fields and funds, group and total, save with a name, share to the org, schedule as a weekly email, export CSV and PDF. Ship with twelve saved reports that answer the questions every ED asks: LYBUNT, SYBUNT, first-time donors this year, donors by fund, top 50 lifetime, monthly givers and status, pledges outstanding, gifts by month vs last year, retention by cohort, lapsed over 24 months, acknowledgment backlog, board giving. Every saved report reads from the same functions the screens do, so a report never disagrees with Home.

**One test.** LYBUNT on the fixture matches a hand count; a report with two nested filter groups returns the expected rows; a scheduled report emails once and its links change nothing on GET.

## 4. Events

Not a ticketing system. Enough that an org running a gala or a barn open house doesn't need Eventbrite for the donor side: an event record with date, venue, capacity, ticket levels and sponsorship levels; registration through the giving-page builder (a ticket is a gift with a fair-market-value split, which the receipt must show); guest lists with attended/no-show; table assignments; sponsor recognition; post-event attendance on each person's timeline. Carnegie-style arts orgs with real ticketing are still out of scope; say so in the doc.

**One test.** A $150 ticket with $60 FMV receipts $90 deductible; a sponsor at $2,500 gets a pledge and a recognition line; attendance lands on twelve timelines.

## 5. Volunteers and hours

People types already exist. Add hours: a volunteer shift record, hours logged by the volunteer coordinator or by the volunteer through a link, totals on the profile and in reports, and volunteer-to-donor conversion as a saved report. Import from Wranglr and VolunteerHub exports as presets. Not scheduling; Wranglr does that and Steward reads it.

**One test.** Fifty hours across ten shifts total correctly; a volunteer who gives shows both roles on one record.

## 6. Integrations a switcher expects

QuickBooks Online two-way (91f read, 91g post, gated on Jonathan's walk). Mailchimp and Constant Contact as read-only audience sync for orgs that keep them. Zapier (a triggers-and-actions app: new gift, new person, stage change, task due; create person, create gift, add note). A public REST API with per-org keys, read scopes first. DonorSearch or iWave wealth screening as a paid add-on later; a placeholder field set now so the import doesn't lose their columns. NCOA address updating via a vendor once a year, per org, opt-in.

**One test per integration.** Each proven on a real account before it appears on the marketing page (BUILD-91 rule).

## 7. Migration that makes switching cheap

The reason people stay on Bloomerang is the file. Presets for Bloomerang, Little Green Light, DonorPerfect, Neon, Salesforce NPSP, Kindful, Network for Good, Givebutter and Zeffy exports, each with a fixture from the vendor's documented export and an answer key. A migration checklist per vendor (which reports to run, in what order, what to expect to lose). A "migration walk" service Jonathan does on a call, timed and recorded, with the goal of under two hours from export to reconciled. The import summary's reconciliation sentence is the customer's proof: "3,412 gifts, $1,204,118.22, matches your old system to the cent."

**One test.** Each preset's fixture reconciles to its answer key in cents and rows.

## 8. The things that are boring and decide the deal

Help centre with searchable articles and short videos per screen. In-app chat to Jonathan. Onboarding that ends with a reconciled import, not a checklist. Two-factor login. Data export of everything, any time, one button. SOC 2 Type 1 scoped and priced (attorney and auditor), because the first $2M org's board will ask. Uptime page. A published security page that says what is and isn't true (the Terms §7 honesty, on a web page). Mobile: the app works on a phone for logging a conversation, looking someone up, and the Home list; a native app is not in this build.

**One test.** Two-factor enforced for admins; full export contains every table for one org and nothing from another (tenant battery).

---

## PRICING, RECORDED

Bloomerang prices by record count and starts around $125 a month for the smallest tier, climbing with records and modules. Steward's advantage is one price with no record tiers, and the agent. Core $249 and Team $499 stand; founding $199. Do not price under Bloomerang; price against Bloomerang plus their email tool plus the hours the follow-up engine returns.

## HOW THIS BUILD ENDS

Each part ships on its own. The build is done when a Bloomerang user can run the twelve saved reports, print a batch of acknowledgments, record a DAF gift with a soft credit, run a gala's donor side, and migrate their file in under two hours with the reconciliation sentence green. Then the marketing page gets its first comparison table, every line of which is proven.

## FOR JONATHAN

- Sit in one Bloomerang demo and one Little Green Light demo as a prospect. Write down every feature they show in the first twenty minutes. That list is the check against this doc.
- Ask Allie, Sarah, Laura and Jeanette one question at each meeting: "What would you miss?" Their answers reorder these parts.
- Pick the migration walk timer. If a real file takes more than two hours, that number is the product's problem, not the customer's.

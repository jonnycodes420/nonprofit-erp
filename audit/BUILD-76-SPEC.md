# BUILD-76 — SPECIFICATION (written in BUILD-75 Phase D; DO NOT BUILD BEFORE ITS OWN BUILD)

Three product decisions, specified now so BUILD-76 starts from decisions
rather than debates. Each section ends with its verification story, because
a build without one turns into three weeks. Nothing here was implemented in
BUILD-75, deliberately: bundling product surface into a correctness build
would have left both without a coherent story.

---

## D.1 — Custom fields, grown up

**Why this is the largest competitive gap.** Nonprofit data is weirder than
any fixed schema anticipates: soft credits, gifts in memory of, matching-gift
employers, board affiliation, tribute notification addresses, "do not solicit
but keep on the newsletter." An organization that cannot store a field it
needs does not complain — it declines the product, and you never learn why.

**What already exists (build ON it, not beside it):** `custom_fields` /
`custom_field_values` on DONORS only — text/number/date/dropdown/checkbox,
per-org labels, ordering, `show_in_directory`, values on the profile, one
column per field in CSV exports, importable via the mapping UI. That skeleton
is sound. What's missing is scope, typing depth, and read-side reach.

### Scope of the build

1. **Entity coverage.** Custom fields extend from donors to **gifts** and
   **grants** (the two entities pilots have actually asked about). Table
   design: add `custom_fields.entity TEXT DEFAULT 'donor'`
   (`donor|gift|grant`) and a polymorphic `custom_field_values.entity_id`
   (migrating `donor_id` data in place; keep the column as an alias until
   BUILD-77 to avoid a big-bang rename). Events/volunteers/board stay out —
   deprioritized surfaces get no new machinery.
2. **Two new types, no more:** `donor_ref` (a link to another donor — this is
   how soft credit, "in memory of," and tribute-notification-recipient are
   stored WITHOUT inventing three features) and `multi_select` (tags with a
   controlled vocabulary — "do not solicit but keep on the newsletter" is two
   checkboxes today and a data-integrity hole; a controlled multi-select is
   honest). NO formula fields, NO computed fields, NO per-field permissions —
   each is a rules-engine in disguise.
3. **Where they surface:** the entity's profile (exists for donors; gifts get
   a fields section in the gift editor, grants in GrantProfile), the
   Directory column opt-in (exists), **Directory/report FILTERING on
   dropdown/multi_select/checkbox fields server-side** (the current
   "client-side within the loaded page" compromise documented in BUILD-06
   ends here — this is the single biggest usability payoff), and both CSV
   export families (donor export exists; gift/grant exports gain columns).
4. **Import/export round-trip:** every custom field is a mappable import
   column for its entity (donor side exists); an export→reimport must be a
   no-op (the state-diff discipline — that exact manifest is the acceptance
   test).
5. **The reconciliation invariant interaction — the one sharp edge.** A
   `donor_ref` field (soft credit) must NEVER touch money math: hard credit
   stays the gift's donor, `total_giving` stays each donor's own sum, and no
   custom field participates in any SUM anywhere. Soft-credit DISPLAY reads
   through the field at render time, exactly like the household model
   (derived, never stored). Pin it the same way BUILD-14 pinned households:
   org totals byte-identical with and without soft-credit fields populated.

### Verification story
`tests/custom-fields2.test.js`: type matrix round-trip per entity; the
donor_ref cycle (A soft-credits B; B's displayed soft credit changes, ZERO
money totals change — asserted against the household invariant machinery);
server-side filter correctness vs client-side ground truth; export→reimport
no-op via a state-diff manifest; org isolation (a donor_ref may only point
inside the org — the tenant matrix's resolver gains the new params).

---

## D.2 — Logging as a byproduct (THE CENTRAL RISK, not a nice-to-have)

**The design rule, stated once:** never ask someone to log something for the
system. Make the log a byproduct of getting the thing they already wanted.
Every donor CRM in history dies here — logging is a chore performed for the
system's benefit, so it doesn't happen, so the data rots, so the reports
lie, so nobody trusts them. Bloomerang has the same disease. This decides
whether the turnover pitch ("if your director leaves, everything she knew is
written down") is TRUE or marketing.

### The three loops to build (and only these)

1. **The call-done loop.** Marking a call/meeting task done asks — inline,
   in the same click's confirmation, never a new screen — for ONE line about
   what happened ("She's in for the gala; wants the impact report first").
   Skippable in one keypress; the skip is recorded so the nudge can notice
   chronic skipping without nagging per-instance. The line lands as the
   interaction (type from the task, actor from C.1) and the day view shows
   "you called her three weeks ago" precisely because of it — **the loop
   pays them back the same week, which is the entire mechanism.**
2. **The email loop is already free** — Gmail sync logs sent/received mail
   with zero effort. Surface it as proof: the donor profile's "last touch"
   line should visibly include synced email, so officers SEE the system
   logging for them before they're asked to type anything.
3. **The gift-thanks loop.** The "Send personal thank-you" task, when
   marked done, asks the same one line ("left voicemail" / "spoke — she
   asked about the scholarship fund"). Same inline pattern, same payback.

**Explicitly NOT in scope:** a notes screen, a "log activity" button
redesign, voice memos (shelved, stays shelved), any AI summarization of the
one line. The one line IS the product.

### Verification story
Behavioral: completing a call task with a line → one interaction row, right
type, right actor, visible in the day view's recency math the same request.
Skip → no row + skip recorded. The measure that matters is a FUNNEL metric,
not a test: `interactions per completed call-task` — instrument it into
`metric_snapshots` (key `log_capture_rate`) so BUILD-77 can see whether the
loop actually works with the pilot, per the name-the-anxiety pattern.

---

## D.3 — Three canned automations (NOT a rules builder)

Exactly three, each answering the question every ED asks. All three run on
the existing workflows engine (data-shaped recipes, idempotent runs,
disabled by default) — no new engine, and C.2's line holds: each automation
CREATES A TASK / SENDS AN INTERNAL ALERT; none emails a donor.

1. **A donor goes quiet past their own pattern.** Not a fixed N-day rule:
   compute each donor's own median gift interval (12+ months of history, 3+
   gifts) and flag at 1.5× their median with a task for their officer:
   "Margaret usually gives every 90 days; it's been 140." The fixed-window
   lapse machinery (LAPSE_DAYS=365) stays untouched — this is the earlier,
   personal signal. Recipe key `quiet_past_pattern`; sweep on the existing
   5-min tick, capped, deduped per (donor, last_gift_date) like auto-lapse.
2. **A gift lands above a threshold.** `major_gift_alert` already exists —
   the D.3 work is TUNING, not building: per-org threshold surfaced in the
   recipe config UI with an honest default derived from the org's own data
   (95th percentile of last year's gifts, shown as the suggestion), plus the
   alert copy carrying the donor's context (lifetime, last gift, owner).
3. **A pledge payment comes due.** `pledges` + partial-payment math exist;
   the recipe (`pledge_due_soon`) creates a task for the donor's owner N days
   (config, default 14) before `due_date` when the remaining balance > 0,
   deduped per (pledge, due_date).

**Explicitly NOT in scope:** a visual rules builder (still the deliberately
deferred stage on this schema), donor-facing sends of any kind, more than
these three.

### Verification story
Extend `tests/workflows-e2e.test.js`: each recipe fires on a genuine live
transition and NOT on import/backfill (the BUILD-25 guarantee extends to all
three — the quiet-past-pattern sweep gets the same created_at guard as
auto-lapse); idempotency under parallel re-fire; the pattern math against
hand-computed medians; C.2 pinned — none of the three carries a donor-facing
send action, asserted at the source level.

---

## Sequencing note for BUILD-76

D.2 first (it's the product's central risk and touches the fewest tables),
D.3 second (small, rides existing machinery), D.1 last (the schema
migration deserves the most careful verification and benefits from the
other two being stable). Phase 0 of BUILD-76: reproduce, not fix — measure
the CURRENT log-capture rate on the pilot org before shipping the loop that
is supposed to move it.

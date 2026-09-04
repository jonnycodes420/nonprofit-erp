# BUILD-78 — Custom fields, and the column axis of the invariant

Working record. Spec: the BUILD-78 brief (pasted; supersedes audit/BUILD-76-SPEC.md
D.1 where they disagree). Production at start: backend d7a3376, frontend 5ea6bf2 —
a benign split-brain (d7a3376 added only audit/BUILD-77-FINDINGS.md and a PNG, no
code), so the surfaces are functionally identical.

## PART 0 — RECONCILIATION WITH audit/BUILD-76-SPEC.md D.1

The BUILD-78 spec was written without reading the committed D.1 scope. Read
side-by-side 2026-09-04. Every disagreement recorded here rather than silently
resolved; the newer spec wins each one.

1. **Storage model — the big one.** D.1 said "build ON the existing skeleton":
   `custom_fields` defs + `custom_field_values` EAV, extended with a polymorphic
   `entity_id`. BUILD-78 §1.1 explicitly REJECTS the EAV table ("every donor read
   becomes a join… the classic answer and the wrong one at this size") and
   specifies a `custom_fields` JSONB column on the donor row and the gift row plus
   a `custom_field_defs` authority table. The skeleton D.1 wanted to extend is the
   thing BUILD-78 replaces. Existing EAV data is migrated in place (defs get
   generated immutable keys; values fold into the JSONB column); the old tables
   stop being read by any code path.
2. **Entity scope.** D.1: donor + gift + **grant**. BUILD-78: donor and gift,
   "decided". Grants are out; the `entity` column keeps the door open without
   building the surface.
3. **`donor_ref` is out.** D.1's marquee type (soft credit / in-memory-of /
   tribute-notification as donor links) is not in the BUILD-78 closed set of
   eight. The fixture pins the replacement posture: `Soft Credit To` stores as
   TEXT, creates no donors, touches no drift. D.1's sharp edge ("a donor_ref must
   never touch money math") survives in spirit — no custom field participates in
   any SUM anywhere — but the link type itself waits for a build that wants it.
4. **`multi_select` is in** — the one D.1 addition BUILD-78 keeps, with a
   declared delimiter at mapping time and per-part option matching.
5. **Server-side filtering is out.** D.1 called Directory/report filtering on
   select/checkbox fields "the single biggest usability payoff"; BUILD-78 §5.4
   explicitly defers all filtering/sorting/segmenting/reporting, with reasoning
   (a store gap loses customers silently; a sort gap generates a conversation).
   The existing client-side FilterBar filtering (BUILD-06 compromise) is left
   working as-is — removing a shipped surface is not in scope either — but gains
   nothing new.
6. **Hard delete is banned.** The existing DELETE /custom-fields/:id (which also
   deletes every stored value) is replaced by archive/restore. No delete path
   ships in this build.
7. **New in BUILD-78, absent from D.1:** the immutable `key` (the label was the
   de-facto identifier in the old export — export headers were labels and the
   JSON export keyed values BY LABEL), `long_text` and `money` types, the
   40/100/2,000 limits, the ask-gate non-extensibility rule (Part 2), the column
   axis of the reconciliation invariant (Part 3), proposal-never-auto-creation in
   the mapper, and the archive model.
8. **`required` and `show_in_directory`** exist on the old defs table; BUILD-78's
   definition table has neither. `show_in_directory` is carried over (the
   Directory column opt-in is a shipped surface). `required` is dropped from the
   new model: a required custom field would make every import that lacks the
   column refuse every row, which is a footgun nobody asked for; the old column
   is simply not migrated. Recorded here as a decision, not an accident.
9. **Officer-versus-officer visibility** (BUILD-76 Part 5) stays open. Custom
   fields inherit whatever that decision turns out to be; no per-officer
   visibility rule is invented here.
10. **D.1's export→reimport no-op acceptance test** survives as Part 6's round
    trip, strengthened: matched by key (never label), money to the cent, dates
    as civil dates, both axes of the invariant balancing on the re-import.

## PART 0 — FAILS-FIRST REPRODUCTIONS

- **Cross-org field_id reference (spec Part 7, "the subtle one"):**
  scripts/build78-repro-crossorg-fieldid.js, red run captured in
  audit/build78-verify-first-red.txt. Org A's admin POSTed org B's field id
  onto org A's own donor: **200 {"ok":true} and the row was written** with
  org_id=A, field_id=B's. The read-back join filters on cf.org_id=A, so the
  landed value is invisible even to the org that wrote it — a write that
  succeeds and can never be read. The BUILD-78 write seam must reject this
  with no row written; the matrix asserts it.
- The exclusion-shaped-column trap (Part 2) has no pre-fix reproduction to
  capture: custom-field destinations do not exist yet, so there is nothing to
  wrongly offer. The assertions land with the mapper and fail the build if a
  Part 2 family header is ever offered as one.

(Findings for Parts 1+ accrue below as the build proceeds.)

## PART 1 — THE DATA MODEL (shipped)

- **One implementation of the type rules**: `client/src/lib/customFieldShape.js`
  (ESM, pure) is shared byte-for-byte by the client, the server seam
  (`customFields.js` — dynamic import, CJS↔ESM) and the suites. Money coerces
  to integer CENTS in exactly one place: the server seam, through money.js
  `toCents`. The client module returns dollars; only the seam converts.
- **Coercion decisions recorded per 1.3**: number/money use `normalizeMoney`
  (BUILD-73 separators; the "n/a"-family reads as blank, not an error — a
  deliberate carry of the BUILD-77 Part 3 blank-vs-unparseable distinction);
  date uses `normalizeDate` (nine formats, calendar-validated, no fallback);
  checkbox truthy {y,yes,true,t,1,x,checked} / falsy {n,no,false,f,0,unchecked},
  anything else an error; select/multi-select match options after trim+case-fold
  and store the canonical option string.
- **The 40-field cap counts LIVE fields.** Archiving frees a slot; restore is
  never blocked by the cap (restore must always work — a restore that can fail
  makes archive a delete with extra steps). Decision, recorded.
- **Select options are add-only** on edit: removing (or renaming) an option
  would orphan every stored value holding it. An honest option migration is
  future work; the error says why.
- **Migration preserves, never refuses**: legacy EAV values that coerce
  cleanly land typed; ones that do not are stored as the raw string
  (`keptRaw` counted). The refusal rule is for NEW writes, not for data the
  org already owns. Flag-guarded at boot (`schema_flags.b78_cf_jsonb_migration`);
  failure is loud, does not mark the flag, and retries next boot.
- **`show_in_directory` is carried on the new defs table but no client surface
  reads it today** (the BUILD-76 D.1 claim that a Directory column opt-in
  "exists" was aspirational — nothing in client/src reads the column). Carried
  so nothing is lost; not wired further, per 5.4's display-only scope.
- **The Part 7 "fails by design" red never fired**: the tenant matrix resolves
  new route params from the LIVE router walk plus the segment map, and
  `custom-fields` was already a mapped segment — so the six new routes were
  cross-probed automatically on the first run (43/43). That is the generated
  machinery doing exactly what B.4 built it for; noted here because the spec
  predicted a red that the generator made unnecessary. route-inventory.json
  regenerated and committed.
- Legacy EAV reassignment kept inside donor merge (harmless no-op post-
  migration) PLUS the JSONB fold: secondary's keys fill in, primary wins
  conflicts — donor-merge.test.js §now asserts the JSONB behavior.
- tests/custom-fields.test.js (58, in run-all): the type matrix through the
  seam, limits as clear messages, key/type immutability, archive/restore by
  count AND value, no delete route, the Part 0 cross-org red now green, the
  migration, and Part 9 events with actor identities.

## PARTS 2 + 3 + 4 + 8 — THE MAPPER, THE COLUMN AXIS, THE FIXTURE (shipped)

- **The ask gate is not extensible, asserted as a family**: `classifyExclusionHeader`
  + `detectExclusionColumn` (customFieldShape.js) route Deceased?/DNS/DNC/
  Do Not Mail/Solicit/Contact/Email/Deceased Date/opt-out — plus the
  smart-apostrophe "Don't …" family — to the core flags. A column with that
  shape is status `flag` in the plan and is never offered as a custom
  destination; the golden §1 fails if any family member ever is. The
  BUILD-77 vendor-mailing non-match is pinned again at the header level.
- **An unrecognized non-blank value in a flag column refuses the row** — the
  checkbox rule ("maybe" is a question for a human, not a no) applied to the
  flag family. Recorded as a decision: refusal with a line number beats a
  guessed false on a Deceased? column.
- **The column axis**: `countPhysicalColumns` takes the count ONCE at parse
  entry (raw header line + orphan overflow cells — Papa's `__parsed_extra`);
  the disposition ledger is a separate structure built from the user's
  per-column decisions; `/donors/import-combined` refuses the write (409
  `columns_unreconciled`) when they disagree. **The red was made real**:
  golden §3 removes one column from the ledger, asserts 409 and zero rows
  written; captured in audit/build78-column-red.txt.
- **Proposal, never auto-creation**: `buildMapperPlan` (pure, Node-tested)
  resolves saved mapping by FIELD ID → current-label match → evidence-based
  proposal; nothing is created until the user's accept makes doImport POST
  the field (actor + `created during import of <file>` source). BUILD-77's
  bulk acknowledge checkbox is superseded on the transaction path by
  per-column decisions; aggregate/wide shapes keep the BUILD-58/77 column
  report (decision recorded: the fixture path is transaction-shaped, and the
  other two shapes gain custom-field mapping in a later build, not by
  accident).
- **The mixed column refuses rows**: a custom value that fails its type
  refuses the whole row with its line number, pre-write client-side and
  again at the seam server-side; the failure count is on the proposal card
  BEFORE the write. Refused rows join the BUILD-77 downloadable CSV.
- **Soft Credit To is guessed select by the evidence** (4 distinct names over
  ~75 values is statistically select-shaped); the golden decisions override
  the type to text — the override path is the assert. Stores as text,
  creates no donors, touches no drift.
- **Fixture**: tests/fixtures/build78/steward-messy-cf.csv, seed 20260905,
  1,548 rows, WINDOWS-1252 BYTES (smart quotes as real 0x91–0x94 — Node's
  latin1 truncates them, mapped explicitly), 22 physical columns
  (8 core · 8 custom · Deceased? · 2 discards · blank header · 2 orphan
  overflow cells), name collisions on purpose. Answer key independent
  (gen-answer-key.mjs — TextDecoder + spec rules re-implemented). B77's
  steward-messy-2500.csv untouched.
- **Idempotence by prevention, proven twice**: re-import resolves every
  custom column to custom-existing (zero proposals, zero creations), and
  after renaming EVERY label the id-keyed saved mappings still resolve all
  eight. Matched donors take fill-missing merges only.
- **Re-learned in red**: the first golden run flagged "Wendy Reyes" on the
  today view — three donors share that name and only one is deceased. The
  assert was matching by name; the ask gate was right. Fixed to identity,
  which is precisely the B77 Guillory lesson.
- **Cross-run donor dedup stays email-only** (the BUILD-72 trade), so the
  golden's idempotence asserts are scoped: fields/keys/values absolute,
  donor rows per-email.
- tests/import-messy-cf.test.js: 110 asserts, in run-all.

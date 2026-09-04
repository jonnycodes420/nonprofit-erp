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

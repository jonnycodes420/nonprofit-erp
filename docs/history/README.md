# Steward — build history

One file per brief, named for the brief: `docs/history/<BRIEF>.md` (for example `FIX-60.md`).
A build **adds its own file and never edits another brief's**. Before ARCH-1 (1 Nov 2026) this was
one file, `docs/HISTORY.md`, that every build wrote at the top of: the most-changed file in the
repo (161 briefs) and the cause of 53 merge collisions.

- A new entry: `docs/history/<BRIEF>.md`, starting `## <BRIEF> · <title> (<YYYY-MM-DD>)`.
- The index, newest first, is generated on demand: `node scripts/ci/history-index.js`.
- Entries from before ARCH-1 were split out of the old file verbatim. A brief that had several
  entries keeps them in one file, newest first. An entry with no brief name is named
  `<date>-<words>.md`. The undated status snapshots from the old CLAUDE.md are in
  `_status-snapshots-2026-07.md`.

Nothing here is an instruction. The standing rules are in CLAUDE.md, `docs/architecture/ARCHITECTURE.md`
and `docs/decisions/`. Read an entry when you want the story behind a rule.

---

The introduction of the old file, kept because many entries cite it:

Every dated build entry from the old CLAUDE.md, verbatim, newest first (CHORE-1, 2026-09-25).
Nothing here is an instruction. The standing rules were copied out into CLAUDE.md and
`docs/decisions/`. Read an entry here when you want the story behind a rule.

The note that headed the old CLAUDE.md, kept because the entries below still cite `BLOCKED-*.md` files:


> **`BLOCKED-*.md` NO LONGER EXISTS (2026-09-25).** All 53 of those files were
> deleted and replaced by **one** `NEEDS-JONATHAN.md` at the repo root, which
> holds ONLY what physically requires him — a credential, a password, a real
> customer's file or token, a payment, or a legal signature — one line each with
> the exact click or paste. **Everything else was decided**, and each decision is
> recorded in the commit that made it.
>
> The dated build entries further down still cite the old filenames. They are a
> historical log and have deliberately not been rewritten; read any
> `BLOCKED-…md` reference below as "see NEEDS-JONATHAN.md, or the item was
> decided". Do not create a new `BLOCKED-*.md`: decide it, or put it in
> `NEEDS-JONATHAN.md` if it genuinely cannot be decided without him.

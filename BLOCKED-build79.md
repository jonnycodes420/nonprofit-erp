# BLOCKED — BUILD-79

## The fixture key is not on this machine
The spec says "Fixture and key are in the project at
`claude/messy-2500-v2-fixture-key.md`. Generator is `gen-messy-v2.py`, seed
20260905." The CSV was found at `~/Downloads/steward-messy-2500-v2.csv` (now
committed to `tests/fixtures/build79/`), but neither the key file nor the
generator exists anywhere on this machine — "the project" is the Cowork project,
and those documents were never downloaded. Worked around by deriving the ground
truth from the file itself + the spec's stated facts (2,500 records, TOTAL
$2,035,978.52, header line 4, six CP1252 names). **Jonathan: drop
`messy-2500-v2-fixture-key.md` (and ideally `gen-messy-v2.py`) into
`tests/fixtures/build79/` so Part 8's assertions can bind to the authored key
instead of the derived one.** The CP1252 name count in particular needs the key:
the file has 4 lines carrying raw CP1252 bytes; the spec says 6 names — the key
presumably counts names, not lines.

## Prod's exact auto-map choice is inferred, not replayed
The prod mapping came from `/ai/column-map` (Claude Haiku; no local key, and a
live AI call would be nondeterministic in CI). The repro applies the mapping the
spec records prod chose (First Name → first, Spouse → last, Phone → email,
Frequency → last gift) through the same selects; it reproduces every number of
the prod run exactly, which is strong evidence the inference is right.

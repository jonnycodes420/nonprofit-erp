# BUILD-20 (remaining parts) — verification (2026-07-18)

Verified live against a local scratch server + scratch Postgres 16, client
built with `VITE_API_URL=http://localhost:5601`, `vite preview` on :4174,
logged in as a **Core-tier org** (`org_mv_core`, plan `seed`, seeded via
`moves.test.js` + a handful of staged donors) so the Team-gated surfaces render
their locked state with the org's OWN data.

## Part 1 — no emoji
- `node tests/no-emoji.test.js` → **2 passed, 0 failed** (grep-guard scans
  tracked product source + templates; zero forbidden-emoji codepoints).
- Client `vite build` green after the purge.
- Spot-checked live UI: nav, Home, Reports, Pipeline — all glyphs are the
  monochrome icon set (◈ ♦ ◫ • → ✓), no color emoji anywhere.

## Part 3 — grouped sidebar (screenshot: Home)
Live sidebar reads, top→bottom: **Home** (ungrouped) · **PEOPLE** (Donors ·
Pipeline · Tasks) · **FUNDRAISING** (Fundraising · Grants · Communications ·
Workflows) · **INSIGHT** (Reports · Finance) · **Settings** (pinned bottom).
Subtle uppercase section labels on the BUILD-12 palette. Pipeline is a
top-level item **within People** (not nested under Donors). All routes work.

## Part 4 — Givebutter-style locked previews (screenshots: Pipeline, Solicitations)
- **Sidebar lock indicator:** the Pipeline nav row shows a small SVG padlock
  for the Core user — visible, not removed.
- **Locked Pipeline:** clicking Pipeline renders the REAL board (the org's own
  prospects — "Thomas Yang", "The Delacroix Foundation", stage columns, Move
  buttons, forecast stats) dimmed/blurred behind frosted glass, with a
  "TEAM PLAN · Manage a major-gifts pipeline · Unlock with Team — See plans →"
  overlay. The board is non-interactive (pointer-events:none) so no write is
  reachable from the preview.
- **Locked Reports → Solicitations:** the report body dims behind the same
  glass with a "TEAM PLAN · Oversight for a staffed office · Unlock with Team"
  overlay; Download CSV is disabled.

### Guardrail (BUILD-19 gate intact) — server-verified
- `moves.test.js` **45/45**: Core board returns `locked:true` **with the org's
  own columns populated** (new preview behavior), while every WRITE
  (`POST /pipeline/:donorId/move`, `/donors/:id/opportunities`) stays
  `requirePlan('team')` → 403 for Core and 402 for a read_only Team org.
- `reports-cadence.test.js` **32/32**: Core `GET /reports/solicitations`
  returns **200 + `locked:true`** (own data) but the **CSV export stays 403**
  plan_required — you can look, you can't pull the artifact out.
- `home.test.js` **25/25** — no regression.

## Home portfolio tweak (folded in, already shipped in BUILD-19 7a5bbe6)
Confirmed live on the Core Home: **My Portfolio** panel leads (renders above
the Donor Retention Rate card + the first-touch/stewardship Signals chips) and
opens **expanded by default** (the six-stat row is visible on load, no click).
Core Home reads sensibly (portfolio counts + gifts from the org's own data).

## Source guards
- `node tests/locked-features.test.js` → **34 passed** (LockedFeature wrapper,
  Pipeline wraps the real board, server Core-preview + writes-403, Reports
  dims real body, sidebar grouping + lock indicator).
- `node tests/pipeline-gating.test.js` → **20 passed** (BUILD-19 gate + the
  updated LockedFeature assertion).

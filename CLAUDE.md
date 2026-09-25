# Steward — Nonprofit ERP SaaS

Every session reads this file on every turn. Keep it short: **200 lines at most**, enforced by
`tests/claude-md.test.js`. Rules for one area live in `docs/decisions/`. The story of how
each rule was learned lives in `docs/HISTORY.md`.

## What Steward is

A retention and stewardship CRM for small nonprofits. It notices patterns in donor data and
drafts or suggests the next move, and a human always reviews and sends. It started as an
11-tab ERP. Events, Volunteers, Board, Tasks and Finance are hidden from the nav, not deleted.

- Frontend: React 18 + Vite, deployed on Vercel. Backend: Node + Express (`server.js`,
  `db.js`, `routes/`, `shared/`), deployed on Railway. Database: PostgreSQL.
- Email through Resend. Donations through Stripe Connect Express. Platform billing is a
  separate Stripe client. AI through the Anthropic SDK, for narrow tasks only (no chat).
- App: https://www.stewardapp.dev · API: https://nonprofit-erp-production.up.railway.app
- Repo: github.com/jonnycodes420/nonprofit-erp · demo login admin@creoarts.org (org_creo)
- What is live: `GET /health` → `buildSha` (backend) and `<meta name="build-sha">` on
  www.stewardapp.dev (frontend). Never guess from route probes.
- Only what physically needs Jonathan (a credential, a payment, a signature, a real
  customer's file) goes in `NEEDS-JONATHAN.md`, one line each. Decide everything else.
  Never create a `BLOCKED-*.md`.

## Standing rules

- **The line that is never crossed: agents read, draft and propose. A human signs anything
  that moves money or reaches a donor.** For donor mail the rule is exactly this and no
  further: _she wrote every word, she turned it on, and each send is hers._ The transactional
  exceptions (receipts, dunning, recurring confirmations) don't grow without a human decision.
- **The actor on every write.** Every insert into an actor table stamps `created_by` /
  `created_by_name`: a user id, or a `system:<path>` identity. Never null on a new write.
- **One gift path.** A gift is written by `recordGift` (server.js). The bulk writers that
  predate it (the two import routes, sample data, one webhook branch) are the only
  exceptions. Add no new ones.
- **One person record.** Donors, organisations and non-donor people are rows in `donors`
  (`person_types`), with one timeline. Never fork a second table or profile for a kind of person.
- **Every number has a sentence.** A number on a screen, report or PDF comes with the one
  sentence that defines it. When two surfaces show the same number, it's computed once.
- **A GET never changes state.** Every link in an email must survive GET and HEAD with zero
  writes. A change of state takes a POST from a page the person sees.
- **Four colours reach a screen:** ink `#0F1A12`, white `#FFFFFF` (cream `#F0EDE6` is its
  shade), emerald `#0D5C3A` (the one action colour), brass `#C9A84C`. Overdue is brass,
  not red. Red is only for a destructive confirm.
- **The TDZ rule.** A module-scope or component-scope `const` is declared above every line
  that reads it. Shared consts go in one block under the imports. Run `scripts/tdz-scan.js`.
- **A guard must be proven able to fail.** State what would make it fail, then plant that
  defect and watch it go red before you trust the green.
- **Nothing is done until the full battery is green**, with no silent skips (grep the suite
  logs for SKIP). A red run during edits tells you nothing. Finish, then run.
- **Never email a prospect, and never create calendar events.** Tests send to the local
  Resend sink. Addresses in `mailBlock.js` are never mailed, from
  any org, and only Jonathan edits that list.
- **Never write to org_creo.** It's the demo org, and its legal identity is fabricated. A real
  CREO onboards as a fresh org, never by renaming org_creo.
- **Separate database per worktree.** Each worktree gets its own database on the scratch
  Postgres (:5544) and its own port block. Never share a database or a suite-log folder with
  another session. Pass `SUITE_LOG_DIR=/tmp/steward-suite-logs-<tag>`.
- **Speed comes out of the paperwork, never out of the evidence.** Keep test families small,
  take screenshots only when a walk found a defect, run independent parts in parallel
  worktrees, and run prod smoke once per push.
- **The two-strikes rule for this file.** A new line goes into CLAUDE.md only when the same
  mistake has happened twice. Anything else goes into the decisions file for its area, or
  into `docs/HISTORY.md`. A new build's entry goes at the top of HISTORY.md, not here.

## How to run things

- **Scratch Postgres + boot recipe:** `tests/README.md` (setup) and the header of
  `tests/run-all.sh` (the full server env, including `CORS_ORIGIN=http://localhost:4173`,
  which the browser legs need). Create your worktree's own database first:
  `createdb -h localhost -p 5544 -U steward steward_<tag>`, then boot with
  `DATABASE_URL=postgresql://steward@localhost:5544/steward_<tag>` and the env from the header.
  The first boot builds the schema and demo seed.
- **Client dist for the browser legs:** `bash scripts/build-local-dist.sh`, then
  `API=http://localhost:5601 PORT=4173 node scripts/local-preview.js`. Never a bare
  `npx vite build`, because it skips the brand guard. Rebuild after any client edit.
- **The battery:** `SUITE_LOG_DIR=/tmp/steward-suite-logs-<tag> bash tests/run-all.sh`
  (= `npm test`). One battery at a time on this machine: check `pgrep -f run-all.sh` first.
- **The tenant battery:** `node tests/tenant-matrix.test.js` (boots server.js in-process on
  :5697) and `node tests/tenant-isolation.test.js`. After adding a route, re-run
  `node scripts/build75-route-inventory.js` in the same commit.
- **TDZ scan:** `node scripts/tdz-scan.js [file|dir]`. Self-references exit 1. `--all` adds
  the noisy reads-above list.
- **Deploys go through GitHub Actions only.** Pushing to main runs CI (`.github/workflows/ci.yml`),
  and green tests deploy Railway and Vercel with a SHA-verified health poll. Git auto-deploy is
  off on both sides, and it stays off. Read CI after every push. Break-glass steps are in
  `docs/decisions/tests-and-ci.md`.
- **Prod smoke:** `node scripts/status.js` (= `npm run status`), once, after the push that
  deploys.
- **Git:** work on a branch in your own worktree. Never push a branch that sits on another
  session's unpushed commits. Merge to main only on Jonathan's word.

## Where to look

Read the decisions file before you touch its area. Each one opens with "Read this when you
touch …", then the rules, then the reference sections moved from the old CLAUDE.md.

- `docs/decisions/money-and-gifts.md` — gifts, `recordGift`, funds, attribution, ledger, soft credits, cheques, giving sources.
- `docs/decisions/imports.md` — file import, shape detection, the mapper, money/date parsing, dedupe, exports.
- `docs/decisions/mail-and-notifications.md` — every send: Resend, `donorMailDecision`, the mail block, appeals, sequences, notifications.
- `docs/decisions/recurring-and-stripe.md` — Stripe Connect, the donation webhook, recurring gifts, dunning, card expiry.
- `docs/decisions/receipts-and-tax.md` — receipts, acknowledgments, letters, year-end statements, the legal entity.
- `docs/decisions/agent-and-ai.md` — what a model or automation may do, the Anthropic gate, workflows, system actors.
- `docs/decisions/design-system.md` — colours, tokens, modals, mobile, vocabulary, empty states, org branding.
- `docs/decisions/portal-and-donor-network.md` — the donor portal, white-label surfaces, /giving, the directory, donor accounts.
- `docs/decisions/grants.md` — funders, deadlines, documents, restricted money, grant reports and import.
- `docs/decisions/major-gifts.md` — the pipeline, stage vs status, moves, portfolios and assignment, wealth score.
- `docs/decisions/memberships.md` — memberships, levels and renewals.
- `docs/decisions/forms.md` — giving pages, the builder and widget registry, peer-to-peer, form configs.
- `docs/decisions/tests-and-ci.md` — the battery, browser legs, tenant matrix, guards, pre-push, CI, deploys, TDZ, the speed rule.
- `docs/decisions/architecture.md` — stack, env vars, project layout, tabs, components, org scoping, the actor stamp, API keys, export, scale.
- `docs/decisions/home-and-reports.md` — Home, the Dashboard, the Thread, Drift, tasks, goals, report definitions, board reports.
- `docs/decisions/people-and-records.md` — the person record: donors, orgs, non-donors, households, merge, deletion, profile, volunteers, events.
- `docs/decisions/accounts-and-billing.md` — sign-in, signup, onboarding, invites, roles, super admin, Settings, platform billing.
- `docs/HISTORY.md` — every dated build entry, verbatim, newest first. It holds the why, not instructions.
- `NEEDS-JONATHAN.md` — the only list of things waiting on Jonathan.
- `tests/README.md` — the scratch stack, the browser-leg environment, and the individual suites.

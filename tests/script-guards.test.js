// Script prod-write guard (BUILD-55 Part 1, 2026-08-15). Pure Node; the last
// section (FIX-23) reads the scratch database and re-seeds the demo twice.
// Run: node tests/script-guards.test.js
//
// Pins the load-bearing rule born from the 2026-08-15 incident (a bare
// seed-build50-demo run silently overwrote prod org_creo's theme banner;
// the replaced asset was reference-count pruned — no undo, recovery only
// happened because the bytes had been incidentally saved during diagnosis):
//
//   1. Every script that can WRITE to a remote host resolves its target
//      through scripts/lib/prodGuard.js — loopback default, and a
//      non-loopback target requires --i-know-this-is-prod IN ADDITION to
//      an explicit BASE=/DATABASE_URL=. A typo'd BASE is never enough.
//   2. Every scripts/*.js file must be CLASSIFIED below. A new script that
//      isn't classified fails this suite — future scripts must decide,
//      deliberately, whether they can write and how they're guarded.
//
// If you are here because you added a script: put it in the right list.
// If it writes through BASE → use prodGuard.writerBase() and add it to
// GUARDED_WRITERS. Direct DB writes → prodGuard.writerDbUrl().

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
// ARCH-1: scripts live in scripts/ops (Jonathan runs them), scripts/ci (CI, the
// battery, a hook or a test runs them) and scripts/once (one-time; deleted
// after they have run on prod and Jonathan says so). Nothing is in the root.
const SCRIPT_DIRS = ["ops", "ci", "once"];
const where = {};
for (const d of SCRIPT_DIRS) for (const f of fs.readdirSync(path.join(root, "scripts", d)).filter(f => f.endsWith(".js"))) where[f.replace(/\.js$/, "")] = d;
const fileOf = f => path.join(root, "scripts", where[f] || ".", f + ".js");
const read = f => fs.readFileSync(fileOf(f), "utf8");

// ── The classification (every scripts/*.js must appear in exactly one list) ──

// Writes data (API or DB) — must resolve its target through prodGuard.
const GUARDED_WRITERS = [
  // STAGE-1 — rebuilds STAGING's data. writerBase with --staging, which refuses unless the
  // target's /health says env "staging" (prod's says "production").
  "staging-seed",
  // FIX-58 item 6 — moves theme files that fell back to Postgres into S3. A dry
  // run by default; --apply resolves its database through writerDbUrl(), so a
  // remote one also needs --i-know-this-is-prod. Jonathan runs it.
  "move-theme-assets-to-s3",
  // SECURE-3 — seals synced mail stored before sealing (bodies and attachments)
  // and rewraps rows under a rotated key. Dry run by default; --apply writes
  // through writerDbUrl. Jonathan runs it; never at deploy.
  "seal-synced-mail",
  // DEPLOY-1: gives back queue jobs whose lease ran out and stops the ones no
  // worker can run. Dry run by default; --apply writes through writerDbUrl.
  // Jonathan runs it; never at deploy.
  "queue-requeue",
  // The demo seed (BUILD-72 Part 5; FIX-1 §11 renamed it seed-demo). Loopback
  // default via writerBase; any database name outside the scratch allowlist
  // fails closed EXCEPT the one deliberate production path (prod db + prod
  // BASE + --i-know-this-is-prod, BUILD-76 follow-up — puts the Harborlight
  // demo fiction on prod, touching only the demo org's rows); kb_*/kingdom
  // refuse unconditionally, and the identity check (server's reported
  // database == the one being written) always applies.
  "seed-demo",
  // FIX-30: puts back the postal states the Agent overwrote with "runs".
  // Dry run by default; --apply/--undo write through writerDbUrl.
  "repair-runs-state",
  // NUMBERS-1: moves gifts credited outside their campaign's dates to no campaign.
  // Dry run by default; --apply writes through writerDbUrl, one audit row per gift.
  "numbers1-campaign-window",
  // IMPORT-8: turns email back on for people an import blocked because of a
  // note. Dry run by default; --apply writes through writerDbUrl, one audit row each.
  "import8-note-optouts",
  // IMPORT-9: puts back in the trash the people an undone import had brought
  // back. Dry run by default; --apply/--undo write through writerDbUrl, one audit row per org.
  "import9-undo-leftovers",
  // INTEGRITY-1: restores people an import's undo trashed though they were here
  // before it, and revokes repeated pending invites. Dry run by default;
  // --apply/--undo write through writerDbUrl, one audit row per org.
  "integrity1-find-vanished",
  "integrity1-duplicate-invites",
  // INTEGRITY-2: moves links left on people in the trash onto their trash rows;
  // lists the rest. Dry run by default; --apply/--undo write through writerDbUrl, one audit row per org.
  "integrity2-trash-residue",
  // STATUS-1: puts stored donor_rhythm rows on the one rhythm. Dry run by
  // default; --apply writes through writerDbUrl (derived rows, no journeys).
  "status1-rhythm-recompute",
  // HARDEN-2: closes the deletion records of people already back, one org
  // (--org required). Dry run by default; --apply writes through writerDbUrl.
  "close-stale-deletions",
  // ADMIN-CLEAN: sorts every org into its kind, archives and deletes junk.
  // Dry run by default; --apply writes through writerDbUrl.
  "admin-clean",
  // NUMBERS-3: recomputes stored first and last gifts to the one rule.
  // Dry run by default; --apply writes through writerDbUrl. org_creo skipped.
  "numbers3-recompute-totals",
  // TRUST-1: turns off the at-risk and milestone sequences Steward made and
  // left on. Dry run by default; --apply writes through writerDbUrl.
  "trust1-turn-off-steward-sequences",
  // SENDS-1: pauses sequences that are Active with an empty step or no trigger.
  // Dry run by default; --apply writes through writerDbUrl, one audit row per org.
  "sends1-off-audit",
  // COMMS-1: archives the unsent drafts of turned-off sequences, older than 7 days.
  // Dry run by default; --apply/--undo write through writerDbUrl, one audit row per org. org_creo skipped.
  "comms1-old-sequence-drafts",
  // STALE-2: deletes event timeline lines whose guest is gone (not in the trash).
  // Dry run by default; --apply/--undo write through writerDbUrl, one audit row per org. org_creo skipped.
  "stale2-event-line-orphans",
  // FLOWS-3: gives event guests typed in with no record a person (matched, or a new "guest").
  // Dry run by default; --apply/--undo write through writerDbUrl, one audit row per org. org_creo skipped.
  "flows3-typed-guests",
  // DEMO-TIDY-1/2: tidies a demo or internal_test org (refuses every other org_kind; Jonathan runs it on org_creo).
  // Dry run by default; --apply/--undo write through writerDbUrl, one audit row per change and one per run.
  "demo-tidy",
  // REPAIR-1: demo-tidy's steps 8 to 10 (thank-you tasks, attendance lines, pledge flags) on every
  // org but org_creo and org_b72demo. Dry run by default; --apply/--undo write through writerDbUrl, one audit row per org.
  "repair1-all-orgs",
  // GRANTS-FIX: links grants that carry only a typed funder name. Dry run by
  // default; --apply writes through writerDbUrl, links only, one audit row each.
  "grants-link-funders",
  // GIFTS-1: one payment gift per grant for its typed Received less its recorded
  // payments, through recordGift. Dry run by default; --apply writes through writerDbUrl.
  "gifts1-grant-received",
  // MONEY-4: records the award (a pledge on the funder) for grants at an award stage with
  // no award row, and turns typed Received into its first payment. Dry run by default;
  // --apply writes through writerDbUrl, through the app's own pledge and gift writers.
  "money4-grant-awards",
  // MOPUP-1: removes the old whole-award income rows (source='grant', no
  // gift_id). Dry run by default; --apply writes through writerDbUrl, one audit row per org.
  "mopup1-award-stamps",
  // TRUTH-3: stores unsent drafts with figure keys. Dry run by default; --apply
  // writes through writerDbUrl, one audit row per org; --undo puts words back.
  "truth3-rerender-drafts",
  "backfill-campaign-attribution",                    "dedupe-finance-gift-stamps",
   "fix-build54-demo-photos",
  "fix-demo-finance-ledger",  "load-irs-ein-registry",
  // FIX-22: fills irs_bmf (the IRS EO BMF) straight into the database.
  "load-irs-bmf",
  "migrate-build51-theme-assets", "migrate-build51b-impact-photos",
  "migrate-plans-core-team", "restore-asset", "seed-build45-asks",
  "seed-build45-portal-demo",
  // CKRH-1 — provisions ONE REAL CUSTOMER's org (Central Kentucky Riding for
  // Hope). It writes no donors and no sample data, but it creates an org, a
  // login and three funds, so it is a writer and is guarded like one: creating
  // a real customer's account off a mistyped BASE is precisely the accident
  // this guard exists to prevent.
  "ckrh-provision",
  // BUILD-86 Part B — the demo org's own words.
  "seed-build86-vocabulary",
  "seed-build50-demo", "seed-build54-demo", "seed-creo-goals",
  "seed-fundraising-demo",
   "build59-install-demo-images",
  // BUILD-88a A.1 — the gift de-duplicator. DELETES rows, so it is a writer:
  // dry run by default, --apply to act, and the guard is the only way it can
  // reach a remote database.
  "build88a-dedupe-gifts",
];

// Writes data but HARD-REFUSES any non-loopback target outright (stricter
// than the guard — these are load/e2e fixtures that must never see prod).
const SELF_REFUSING = [
  // FUNDRAISING-2 — the Fundraising walk org (real-shaped files) and its screenshots, on the LOCAL stack.
      // SWEEP-2 — the Donors, Data health and imports walk org (real-shaped files), on the LOCAL stack.
  "sweep2-walk-org",
  // BUILD-75 B.1 — the route-inventory walker. BOOTS server.js (schema init
  // runs), so it hard-refuses any non-loopback DATABASE_URL outright.
  "build75-route-inventory", "seed-loadtest",
  // SPLIT-1 — the route diff boots server.js twice the same way, and refuses the same way.
  "route-diff",  "build58-stripe-drill",
  // BUILD-76 — the drift-vs-real-Stripe drill: same rig as build58's (scratch
  // server on :5621 + `stripe listen`), refuses any non-loopback BASE.
  "build76-drift-drill",
  // BUILD-99 (major gifts) Part 4 — the prospect-brief drill. Calls the REAL
  // model with rows taken off a real org through the real route (a hand-built
  // fixture would be drilling the drill, not the product), and writes nothing of
  // its own. Refuses a non-loopback BASE and refuses to run with NODE_ENV
  // production; the one row it causes is the agent_run the route itself logs.
  "build99-brief-drill",
  // BUILD-99 (major gifts) — the end-of-build walk. Writes through the real
  // routes on a loopback stack, so it refuses a non-loopback BASE outright;
  // there is no read-only mode for a walk whose point is that the writes land.
  "build99-walk",
  // BUILD-89 — the demo file. WRITES 1,000 donors and their giving through the
  // API; loopback by default, and a non-loopback BASE needs
  // --i-know-this-is-prod, because seeding the demo org IS a prod write.
  "build89-demo-seed",
  // FIX-55 — the import walk and the preview timings. Each seeds its own org on
  // the LOCAL stack and refuses a non-loopback API or database outright.
  "import-walk"];

// Loopback is HARDCODED (no BASE env at all) — cannot reach a remote host.
const LOOPBACK_HARDCODED = [
];

// Read-only against whatever BASE points at (may default to prod): their only
// write-shaped call is POST /auth/login. Verified below, not just trusted.
const PROD_READONLY = [
  // ASKS-1: lists sheet imports that kept an auction sheet's columns as custom fields; SELECTs only, no --apply.
  "asks1-auction-sheets-readonly",
  // FLOWS-4: counts stale "Missed you" drafts, tasks on archived events, hours and meeting notes saved twice; SELECTs only, no --apply.
  "flows4-volunteer-rows",
  // FLOWS-3: counts people in Draft/Paused journeys and early dated first steps; SELECTs only, no --apply.
  "flows3-journey-starts",
  // PLEDGES-3: lists old pledge flags, drifted receipts and grants awarded with no award row; SELECTs only, no --apply.
  "pledges3-old-rows",
  // MONEY-4: lists orgs whose giving-page EIN copy differed from Settings; SELECTs only, no --apply.
  "money4-ein-copies",
  // ATLAS-5: lists reminders saved on the late weekday and notes saved short; SELECTs only, no --apply.
  "atlas5-old-rows",
  // MAIL-1: what each org's mail would do, in a READ ONLY transaction, counts and org names only.
  "mail-preflight",
  // NUMBERS-1: checks an org's numbers against its gifts; SELECTs only, counts-only with --counts.
  "check-numbers",
         "check-webhook-subscriptions",
  // INT-PROD-1: one PayPal token POST, then GET-only Transaction Search; counts and totals only.
  "verify-paypal",
  "consistency-audit",    // BUILD-73 Part 4 — the landing page was rebuilt, and FIVE scripts that
  // policed the old one were consolidated into this one:
  //   landing-funnel-verify · landing-hero-verify · landing-crispness-prod
  //   landing-image-verify  · landing-motion-verify
  // Their honesty gates (no fabricated proof, the FEP attribution, no
  // competitor cited as authority, no "keep 100%" overclaim), their CLS and
  // no-auto-popup checks, and their measured-contrast checks all live here.
  // What did NOT survive is the raster-vs-DOM product-shot policing: the
  // rebuilt page has no product screenshots, so that subject is gone rather
  // than unwatched. See audit/BUILD-73-FINDINGS.md.
  "landing-prod-verify",
  // BUILD-78 — the independent EAV→JSONB migration reconciliation. Connects to
  // the DB directly and issues ONLY SELECTs (no INSERT/UPDATE/DELETE, no write
  // HTTP); safe to run read-only against prod to certify zero-loss from the
  // SURVIVING legacy tables, which the migration never drops.
     "screenshot-matrix", "topbar-verify", "status",
  // BUILD-72 Step A — the cents measurement. READ-ONLY by construction: it
  // opens a READ ONLY transaction, issues only SELECTs, and ROLLBACKs. It
  // verifies identity (product + database) before the connection is used.
  "build72-cents-audit",
  // BUILD-73 Part 1 — the production cents audit. Same construction as its
  // BUILD-72 predecessor (READ ONLY transaction, SELECTs only, ROLLBACK,
  // identity verified before use), plus a read-only Stripe cross-check
  // (paymentIntents.retrieve) that turns bucket-1 candidates into proven drift.
  "build73-cents-audit",
  // BUILD-75 Phase 0 — the receipt-numbering + digest-dedup audits. Same
  // construction as the cents audits (SELECTs only, identity verified via
  // /health + current_database() before the connection is used for anything,
  // --i-know-this-is-prod required for a remote target). Never writes.
  "build75-phase0-audit",
  // BUILD-73 Part 2 — a pure SOURCE scan (reads server.js/db.js off disk and
  // finds any money value rounded to a whole dollar). No server, no database,
  // no network. Run BY tests/money-cents.test.js so the enumeration cannot drift.
  "build73-money-audit",
  // BUILD-97 Part 2 — the numeric census. A pure SOURCE scan: reads the
  // client's active surfaces off disk and counts the places a number is drawn
  // for a person to read. No server, no database, no network. Run BY
  // tests/build97-numbers.test.js so the enumeration cannot drift away from
  // audit/BUILD-97-NUMBER-CENSUS.md.
  "build97-number-census",
  // BUILD-96 Part 6 — the TDZ scan. A pure SOURCE scan: reads client/src and
  // shared off disk and reports `const`/`let`/`class` read before its own
  // declaration. No server, no database, no network. Exits 1 on a
  // self-reference (always a bug); the noisier read-above-declaration shape is
  // behind --all because it needs human triage.
  "tdz-scan",
  // FIX-3 C — is there a real person in the demo? READ ONLY transaction,
  // SELECTs only, ROLLBACK; a remote DATABASE_URL needs --i-know-this-is-prod
  // and the /health identity match. Prints the offending rows, exits 1.
  "demo-real-people-check",
];

// Browser-driving captures: default loopback; any writes ride the logged-in
// app UI (Playwright), not script-issued fetches. Loopback default asserted.
const LOOPBACK_CAPTURES = [
                               ];

// Out of scope for BASE/DB guarding, each for a stated reason.
const EXEMPT = {
  "history-index": "ARCH-1 — prints the index of docs/history/ from the files there. Reads only; no BASE, no DB, no network, no writes",
  "needs-jonathan": "ARCH-1 — prints what waits on Jonathan from docs/needs-jonathan/. Reads only; no BASE, no DB, no network, no writes",
  "arch-check": "ARCH-1 — the architecture ratchet. Reads the tracked tree (git ls-files) and its own baselines in docs/architecture/baseline/; --update rewrites only those baselines. No BASE, no DB, no network",
  "prod-ai-smoke": "HARDEN-1 — signs in to the prod demo and POSTs ONLY to /ask/preview and /agent/preview, both declared read-only in auditTrail.READ_ONLY_POSTS (nothing saved); checked below",
  "error-digest": "HARDEN-1 — reads Railway log lines (stdin or a file) and writes one markdown file under docs/errors/; no BASE, no DB, no app write",
  "local-preview": "serves client/dist and proxies vercel.json's rewrites to a LOOPBACK-ONLY API; refuses any non-loopback API and writes nothing",
  "create-billing-products": "writes to STRIPE, not the app; has its own refuse-live-without---live guard",
  "stripe-live-prices": "writes to STRIPE, not the app (PRICING-1 bands); refuses a live key without --live and --live with a test key",
  "build95-cheque-drill": "BUILD-95 — the cheque-reading boundary drill: reads local image files, calls the Anthropic API directly and prints what came back. No BASE, no DATABASE_URL, no Steward server, no app write of any kind; it refuses to run under NODE_ENV=production",
  "capture1-make-fixtures": "CAPTURE-1: draws the fake check, slip and letter fixtures with sharp and pdfkit into tests/fixtures/capture1/; no BASE, no DATABASE_URL, no network, no app write",
  "audit-gate": "BUILD-75 B.6 — runs `npm audit --json` on the local package and compares against audit/npm-audit-allowlist.json; no BASE, no DB, no app writes",
  "semgrep-sql-check": "REDTEAM-2 — reads a Semgrep JSON file and scripts/ci/semgrep-sql-open.txt and compares them; no BASE, no DB, no network, no writes",
  // ── CHORE-2 — the sharded battery's four helpers. None of them has a BASE,
  // a DATABASE_URL or any notion of an app: they read a suite list, a plan, a
  // set of shard results and a timings file, and write files under audit/ and
  // a temp directory. The thing that DOES touch a database is tests/shard.sh,
  // which is a test file rather than a script, and it only ever creates and
  // drops `steward_shard_<n>` on the loopback scratch Postgres.
  "shard-plan": "CHORE-2 — pure scheduling: reads .generated/suite-timings.json and a list of suite NAMES, writes a plan JSON. No BASE, no DB, no network",
  "shard-report": "CHORE-2 — reads the shard result files a local run wrote and prints one summary; its only write is .generated/suite-timings.json. No BASE, no DB, no network",
  "shard-combine": "CHORE-2 — CI-side: reads the shard artifacts and audit/suite-counts.json and decides whether the battery passed. Its only writes are that baseline file and (CI-2) .generated/suite-timings.json. No BASE, no DB, no app calls",
  "dist-for-shard": "CI-2 — copies a local client/dist and rewrites its loopback API origin to another shard's loopback API; both origins must be loopback and it writes only under .generated/. No BASE, no DB, no network",
  "dist-fresh": "FIX-60 item 6 — says whether client/dist was built from HEAD (and the uncommitted client edits) for a given loopback API; its only writes are the stamp file in client/dist and, with --rebuild, scripts/ops/build-local-dist.sh (loopback-only). No BASE, no DB, no network",
  "builder-access-check": "SECURE-3 item 5 — reads this process's environment variable NAMES (a value only to see whether it is a postgres URL to a remote host, never printed) and two config files in the home folder for a login's presence. No BASE, no DB, no network, no writes; checked below",
  "restore-drill": "SECURE-3 item 4 — Jonathan's restore drill. Boots server.js (so the copy's schema is migrated) against RESTORE_DATABASE_URL only after its own refusals: a non-loopback target needs --i-am-jonathan, a --project starting steward-restore-, a Supabase host whose ref is not prod's, and never a .env or a Railway shell; dry run by default. Its refusals are driven below",
  "board-import-walk": "DEVBOARD-1 — reads a local walk report (markdown) and, with --write, rewrites ops/board.json in the checkout. No BASE, no DB, no network",
  "board": "DEVBOARD-1 — adds, assigns or closes items in ops/board.json (dry run unless --write), reading a local build report for close. No BASE, no DB, no network",
  "deploy-turnstile": "FLAKE-1 — before a deploy job deploys, waits for older push-to-main runs' deploy job of the same name (GitHub Actions API, read-only) and compares this commit with the live one (git, and the live site's public build stamp). No BASE, no DB, no app call, no secret; writes only $GITHUB_OUTPUT and the step summary",
  "staging-walk": "STAGE-1 — the CI walk of STAGING: signs in, records one gift and one import (then undoes it) in the walk org. Refuses to write anything unless the target's /health says env \"staging\"; prod's says \"production\"",
  "deploy-lane": "STAGE-1 — reads the merged PR's labels and description from the GitHub API and writes a job output (staging or hotfix). No BASE, no DB, no app call",
  "vercel-staging-config": "STAGE-1 — writes vercel.staging.json in the checkout from vercel.json with prod's API host replaced. No BASE, no DB, no network",
  "wait-live": "STAGE-1 — polls a copy's public /health and build-sha meta until it serves a commit. Read-only, no secret",
  "tree-already-passed": "CHORE-2 — asks the GitHub Actions API whether this exact git TREE already passed, and writes two job outputs. Read-only against GitHub, no BASE, no DB, no app writes; every failure mode falls back to running the battery",
};

// ── 1. Every script file is classified ──────────────────────────────────────
const all = Object.keys(where);
ok(!fs.readdirSync(path.join(root, "scripts")).some(f => f.endsWith(".js")), "no script sits in the scripts/ root (ARCH-1: ops, ci or once)");
const classified = new Set([...GUARDED_WRITERS, ...SELF_REFUSING, ...LOOPBACK_HARDCODED, ...PROD_READONLY, ...LOOPBACK_CAPTURES, ...Object.keys(EXEMPT)]);
for (const s of all) {
  ok(classified.has(s), `scripts/${s}.js is not classified in tests/script-guards.test.js — decide whether it writes and guard it`);
}
for (const s of classified) {
  ok(all.includes(s), `classified script scripts/${s}.js no longer exists — remove it from the list`);
}

// ── 2. Guarded writers actually use the guard, with no bypass ───────────────
for (const s of GUARDED_WRITERS) {
  const src = read(s);
  ok(/prodGuard"?\)\.?\s*(;|\n)|writerBase\(|writerDbUrl\(/.test(src) && /writerBase\(|writerDbUrl\(/.test(src),
    `${s} must resolve its target via prodGuard.writerBase()/writerDbUrl()`);
  ok(!/process\.env\.BASE\s*\|\|/.test(src),
    `${s} still reads process.env.BASE directly — the guard must be the only BASE resolution`);
  const def = src.match(/writerBase\("([^"]+)"/);
  if (def) ok(/^https?:\/\/(localhost|127\.0\.0\.1)/.test(def[1]), `${s} writerBase default must be loopback (got ${def[1]})`);
}

// ── 3. Self-refusing scripts keep their hard refusal ────────────────────────
for (const s of SELF_REFUSING) {
  const src = read(s);
  ok(/localhost\|127\\\.0\\\.0\\\.1|Refus/i.test(src), `${s} must hard-refuse non-loopback targets`);
}

// ── 4. Hardcoded-loopback scripts stay that way ─────────────────────────────
for (const s of LOOPBACK_HARDCODED) {
  const src = read(s);
  ok(!/process\.env\.BASE/.test(src), `${s} must not grow a BASE env override without moving to GUARDED_WRITERS`);
  ok(/"http:\/\/(localhost|127\.0\.0\.1)/.test(src), `${s} must target loopback`);
}

// ── 5. Prod-readonly scripts are actually read-only ─────────────────────────
for (const s of PROD_READONLY) {
  const src = read(s);
  ok(!/method:\s*["']（?(PUT|PATCH|DELETE)/i.test(src) && !/method:\s*["'](PUT|PATCH|DELETE)/.test(src),
    `${s} is classified read-only but issues a ${ (src.match(/method:\s*["'](PUT|PATCH|DELETE)/)||[])[1] || "write" } — move it to GUARDED_WRITERS`);
  for (const m of src.matchAll(/method:\s*["']POST["']/g)) {
    const ctx = src.slice(Math.max(0, m.index - 300), m.index + 100);
    ok(/auth\/login|\/login/.test(ctx), `${s} POSTs to something other than /auth/login — move it to GUARDED_WRITERS`);
  }
  ok(!/INSERT INTO|UPDATE .* SET|DELETE FROM/.test(src), `${s} contains direct SQL writes`);
}

// HARDEN-1 · the prod AI smoke posts to sign-in and the two read-only previews, nothing else.
{
  const src = read("prod-ai-smoke");
  const posts = [...src.matchAll(/post\(`\$\{backend\}(\/[^`]+)`/g)].map(m => m[1]);
  ok(posts.length === 3 && posts.every(p => ["/auth/login", "/ask/preview", "/agent/preview"].includes(p)),
    `prod-ai-smoke posts only to /auth/login and the two read-only previews (found ${posts.join(", ")})`);
  const AT = require(path.join(root, "auditTrail.js"));
  ok(["/ask/preview", "/agent/preview"].every(p => AT.READ_ONLY_POSTS.some(re => re.test(p))), "both previews are declared read-only in auditTrail.READ_ONLY_POSTS");
}

// ── 6. Loopback captures default to loopback ────────────────────────────────
for (const s of LOOPBACK_CAPTURES) {
  const src = read(s);
  const m = src.match(/const (?:BASE|API)\s*=\s*process\.env\.BASE \|\| "([^"]+)"/);
  if (m) ok(/localhost|127\.0\.0\.1/.test(m[1]), `${s} defaults BASE to ${m[1]} — captures must default to the local stack`);
  ok(!/method:\s*["'](PUT|PATCH|DELETE)["']/.test(src),
    `${s} issues script-level write fetches — move it to GUARDED_WRITERS`);
}

// ── 7. The EXEMPT reasons still hold ────────────────────────────────────────
{
  const cbp = read("create-billing-products");
  ok(/--live/.test(cbp) && /sk_live|live/i.test(cbp), "create-billing-products keeps its refuse-live-without---live guard");
  const slp = read("stripe-live-prices");
  ok(/--live/.test(slp) && /sk_live|rk_live/.test(slp) && /STRIPE_BILLING_SECRET_KEY/.test(slp),
     "stripe-live-prices refuses live without --live and reads only the billing key");
}

// ── 8. prodGuard semantics (in-process, injected env/argv, no exits) ────────
const guard = require(path.join(root, "scripts", "lib", "prodGuard.js"));
// 8a — a writer script can never ship a non-loopback default again
let threw = false;
try { guard.writerBase("https://nonprofit-erp-production.up.railway.app", { env: {}, argv: [], noExit: true }); } catch { threw = true; }
ok(threw, "writerBase throws on a non-loopback DEFAULT");
// 8b — loopback default, no env → loopback
ok(guard.writerBase("http://localhost:5601", { env: {}, argv: [], noExit: true }) === "http://localhost:5601", "writerBase resolves the loopback default");
// 8c — explicit remote BASE alone is NOT enough
threw = false;
try { guard.writerBase("http://localhost:5601", { env: { BASE: "https://nonprofit-erp-production.up.railway.app" }, argv: [], noExit: true }); } catch (e) { threw = e.code === "prod_confirm_required"; }
ok(threw, "remote BASE without --i-know-this-is-prod is REFUSED (the typo-in-BASE layer)");
// 8d — remote BASE + the flag proceeds
ok(guard.writerBase("http://localhost:5601", { env: { BASE: "https://example.org" }, argv: ["--i-know-this-is-prod"], noExit: true }) === "https://example.org",
  "remote BASE + confirm flag proceeds");
// 8e — loopback via env never needs the flag
ok(guard.writerBase("http://localhost:5601", { env: { BASE: "http://127.0.0.1:5999" }, argv: [], noExit: true }) === "http://127.0.0.1:5999", "loopback env BASE needs no flag");
// 8f — DB twin
threw = false;
try { guard.writerDbUrl({ env: { DATABASE_URL: "postgresql://u@db.example.com/prod" }, argv: [], noExit: true }); } catch (e) { threw = e.code === "prod_confirm_required"; }
ok(threw, "remote DATABASE_URL without the flag is REFUSED");
ok(guard.writerDbUrl({ env: { DATABASE_URL: "postgresql://steward@localhost:5544/steward_loadtest" }, argv: [], noExit: true }).includes("localhost"), "loopback DATABASE_URL passes");
// 8g — logOverwrite writes a recovery snapshot for remote targets only
const os = require("os");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pg-guard-"));
const fLocal = guard.logOverwrite("t-local", { a: 1 }, { base: "http://localhost:5601", dir: tmp });
ok(fLocal === null, "logOverwrite writes no file for loopback targets");
const fRemote = guard.logOverwrite("t-remote", { theme: "banner" }, { base: "https://example.org", dir: tmp });
ok(!!fRemote && fs.existsSync(fRemote), "logOverwrite saves a pre-write snapshot for remote targets");
if (fRemote) ok(JSON.parse(fs.readFileSync(fRemote, "utf8")).current.theme === "banner", "snapshot contains the pre-write state");
fs.rmSync(tmp, { recursive: true, force: true });

// ── INCIDENT 2026-09-22 — A SEEDED ORG MUST NOT BE ABLE TO SEND ────────────
// A demo org sent real pledge reminders to real mailboxes that evening. Every
// PERSISTENT seed (a `seed-*.js` — the ones whose orgs are meant to outlive a
// test run) must therefore create its orgs with mail off and marked as
// fiction, so the org-level gate in server.js refuses them.
//
// Scoped to seed-*.js deliberately. The capture/walk/drill scripts are already
// hard-refused from any non-loopback target by the assertions above, so their
// orgs only ever exist in a scratch database with no real Resend key — a
// different guarantee, and a stronger one.
for (const f of all.filter(n => /^seed-/.test(n)).map(n => n + ".js")) {
  const src = read(f.replace(/\.js$/, ""));
  if (!/INSERT INTO orgs/.test(src)) continue;
  ok(/is_demo_org/.test(src), `${f} must create its orgs with is_demo_org (a seeded org is fiction)`);
  ok(/emails_enabled/.test(src), `${f} must create its orgs with emails_enabled=false (a seeded org mails nobody)`);
}

// -- BUILD-97 Part 0 -- NO SOURCE FILE MAY CONTAIN A RAW NUL BYTE ----------
// `shared/importShape.js` carried two literal NUL bytes, typed as a join
// separator. One consequence, and it is not cosmetic: `grep` classifies a file
// containing a NUL as BINARY and SILENTLY SKIPS IT. The largest mapper module
// in the repo -- 4,180 lines, 60+ exported functions -- was invisible to every
// tree-wide search anyone had ever run over it, including safety sweeps.
//
// That is the same mechanism, exactly, that let `steward-messy-2500-v2.csv`
// (440 real mailbox addresses) survive a scan that reported the tree clean on
// 22 September. The incident write-up's one lesson was "for a safety sweep,
// read the bytes; do not trust grep -r". This guard reads the BYTES.
//
// PROVEN ABLE TO FAIL: the check is run against a synthetic buffer containing
// a NUL below, and must report it. A guard that has never been shown failing
// is a guard nobody knows the shape of.
const hasNul = buf => buf.includes(0x00);
ok(hasNul(Buffer.from([0x61, 0x00, 0x62])), "the NUL check itself detects a NUL (proven able to fail)");
ok(!hasNul(Buffer.from('const SEP = "\\u0000";', "utf8")), "...and an ESCAPED NUL in source is not a raw NUL");

const SRC_EXT = /\.(js|jsx|mjs|cjs|json|md|sh|yml|yaml|css|html)$/;
const SKIP_DIR = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next"]);
const nulFiles = [];
(function walkForNul(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      walkForNul(path.join(dir, entry.name));
    } else if (SRC_EXT.test(entry.name)) {
      const full = path.join(dir, entry.name);
      if (hasNul(fs.readFileSync(full))) nulFiles.push(path.relative(root, full));
    }
  }
})(root);
ok(nulFiles.length === 0,
   "no source file contains a raw NUL byte (grep reads such a file as binary and skips it): " + nulFiles.join(", "));

// ── FIX-44 · NO PAID AI SUITE ON A TIMER ───────────────────────────────────
// The real-AI run (scripts/nightly-ai/, the ANTHROPIC_EVAL_KEY secret) costs
// about $2 a run, and Jonathan starts it by hand. Red if nightly-ai.yml grows a
// schedule or a push trigger back, loses workflow_dispatch, or if any workflow
// that runs on a schedule or a push reaches the paid suite. The prod AI smoke
// (scripts/ci/prod-ai-smoke.js, one Ask and one Agent plan after a deploy) stays.
{
  const wfDir = path.join(root, ".github", "workflows");
  const wfs = fs.readdirSync(wfDir).filter(f => /\.ya?ml$/.test(f));
  const onBlock = src => { const m = src.match(/^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m); return m ? m[1] : ""; };
  const nightly = fs.readFileSync(path.join(wfDir, "nightly-ai.yml"), "utf8");
  const non = onBlock(nightly);
  ok(/^\s+workflow_dispatch:/m.test(non), "nightly-ai.yml can still be started by hand (workflow_dispatch)");
  ok(!/^\s+(schedule|push|pull_request|workflow_run):/m.test(non), "nightly-ai.yml has no schedule, push, pull_request or workflow_run trigger");
  ok(/CAP_USD: "2"/.test(nightly), "the hand-started run keeps its $2 cap");
  for (const f of wfs) {
    const src = fs.readFileSync(path.join(wfDir, f), "utf8");
    const automatic = /^\s+(schedule|push|pull_request|workflow_run):/m.test(onBlock(src));
    const paid = /scripts\/nightly-ai\/run\.js|ANTHROPIC_EVAL_KEY|uses: \.\/\.github\/workflows\/nightly-ai/.test(src);
    ok(!(automatic && paid), `${f} runs on its own and reaches the paid AI suite`);
  }
  // The error digest is one issue per day on the workflow's own token: no
  // branch, no pull request, no permission beyond reading code and writing issues.
  const dg = fs.readFileSync(path.join(wfDir, "error-digest.yml"), "utf8");
  const perms = (dg.match(/^permissions:\s*\n((?:[ \t]+.*\n)*)/m) || ["", ""])[1];
  ok(/issues: write/.test(perms) && !/contents: write|pull-requests/.test(perms), "the error digest asks only for issues write (and reads the code)");
  ok(!/gh pr |git push|git commit/.test(dg) && /gh issue create/.test(dg) && /gh issue edit/.test(dg), "the error digest opens or edits an issue, and never a branch or a pull request");
  const ci = fs.readFileSync(path.join(wfDir, "ci.yml"), "utf8");
  ok(/node scripts\/ci\/prod-ai-smoke\.js/.test(ci), "the post-deploy prod AI smoke still runs in ci.yml");
}

// ── SECURE-3 item 5 · BUILDERS CAN'T REACH PROD ──────────────────────────
// The battery's own environment holds no Railway token, no Supabase secret and
// no postgres URL to a remote host (scripts/ci/builder-access-check.js). This
// runs in the test job in CI and in every local battery; the deploy jobs,
// which do hold RAILWAY_TOKEN, never run the battery, and the test job is
// given no secret at all (checked on ci.yml below). The machine's own Railway
// login and the railway MCP are WARNINGS until Jonathan flips
// MACHINE_LOGIN_FATAL (docs/security/builder-access.md).
// PROVEN ABLE TO FAIL: each failure is planted in a child's environment (or a
// fake home folder) and must go red, naming the variable and never its value.
{
  const { execFileSync } = require("child_process");
  const BAC = path.join(root, "scripts", "ci", "builder-access-check.js");
  const { check, MACHINE_LOGIN_FATAL } = require(BAC);
  const run = env => {
    try { return { code: 0, out: execFileSync("node", [BAC], { env, encoding: "utf8", stdio: "pipe" }) }; }
    catch (e) { return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; }
  };
  const here = run(process.env);
  for (const l of here.out.split("\n").filter(l => /WARNING/.test(l))) console.log(l);
  ok(here.code === 0, `the battery's environment holds a prod credential:\n${here.out.split("\n").filter(l => /FAIL/.test(l)).join("\n")}`);

  const clean = { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(require("os").tmpdir(), "sec3-home-")),
    DATABASE_URL: "postgresql://steward:steward@localhost:5544/steward_loadtest", PGPASSWORD: "steward" };
  ok(run(clean).code === 0, "a clean environment with the CI test job's loopback DATABASE_URL passes");
  const FAKE_PW = "sec3-fake-password-zz";
  const plants = [
    ["RAILWAY_TOKEN", "fake-railway-token-zz"],
    ["RAILWAY_API_TOKEN", "fake-railway-token-zz"],
    ["RAILWAY_PROJECT_TOKEN", "fake-railway-token-zz"],
    ["SUPABASE_ACCESS_TOKEN", "sbp_fakefakefake"],
    ["SUPABASE_SERVICE_ROLE_KEY", "fake.jwt.zz"],
    ["DATABASE_URL", `postgresql://postgres:${FAKE_PW}@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`],
    ["PROD_DATABASE_URL", `postgres://postgres.abcdefghijklmnopqrst:${FAKE_PW}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`],
    ["SOME_OTHER_URL", `postgresql://postgres:${FAKE_PW}@monorail.proxy.rlwy.net:41234/railway`],
    ["PGHOST", "db.abcdefghijklmnopqrst.supabase.co"],
  ];
  for (const [k, v] of plants) {
    const r = run({ ...clean, [k]: v });
    ok(r.code === 1 && r.out.includes(k), `planted ${k} turns the builder-access guard red, naming the variable (proven able to fail)`);
    ok(!r.out.includes(v) && !r.out.includes(FAKE_PW) && !r.out.includes("abcdefghijklmnopqrst"), `the guard never prints ${k}'s value`);
  }
  // The machine's own logins, in a fake home folder: a warning today, a failure once flipped.
  const fakeHome = fs.mkdtempSync(path.join(require("os").tmpdir(), "sec3-home-"));
  fs.mkdirSync(path.join(fakeHome, ".railway"));
  fs.writeFileSync(path.join(fakeHome, ".railway", "config.json"), JSON.stringify({ user: { accessToken: "fake-oauth-zz", refreshToken: "fake-refresh-zz" } }));
  fs.writeFileSync(path.join(fakeHome, ".claude.json"), JSON.stringify({ mcpServers: { railway: { command: "railway", args: ["mcp"] } } }));
  const soft = check({ env: {}, home: fakeHome, machineFatal: false });
  ok(soft.failures.length === 0 && soft.warnings.length === 2, "a Railway CLI login and a railway MCP are WARNINGS while MACHINE_LOGIN_FATAL is false", JSON.stringify(soft));
  const hard = check({ env: {}, home: fakeHome, machineFatal: true });
  ok(hard.failures.length === 2, "…and failures once MACHINE_LOGIN_FATAL is flipped (proven able to fail)");
  ok(![...soft.warnings, ...hard.failures].some(l => /fake-oauth-zz|fake-refresh-zz/.test(l)), "the machine check never prints a token");
  ok(typeof MACHINE_LOGIN_FATAL === "boolean", "MACHINE_LOGIN_FATAL is the one switch");
  fs.rmSync(fakeHome, { recursive: true, force: true }); fs.rmSync(clean.HOME, { recursive: true, force: true });

  // ci.yml: the job that runs the battery is given no secret and a loopback
  // database; only the deploy jobs hold a token.
  const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const jobsAt = ci.indexOf("\njobs:\n");
  const jobs = {};
  let cur = null;
  for (const line of ci.slice(jobsAt + 7).split("\n")) {
    const m = line.match(/^  ([a-z][a-z0-9-]*):\s*$/);
    if (m) { cur = m[1]; jobs[cur] = ""; continue; }
    if (cur) jobs[cur] += line.replace(/#.*$/, "") + "\n";
  }
  // CI-2: the battery runs in the `shard` matrix job; `combine` (named `test`)
  // reads the shards' results; `plan` writes the plan. None holds a secret.
  ok(/bash tests\/run-all\.sh/.test(jobs.shard || ""), "ci.yml's shard job runs the battery (so this guard runs there)");
  for (const j of ["tree-check", "guards", "plan", "shard", "combine"]) ok(!/secrets\./.test(jobs[j] || ""), `ci.yml's ${j} job is given no secret`);
  const dbUrl = ((jobs.shard || "").match(/DATABASE_URL:\s*(\S+)/) || [])[1] || "";
  ok(/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl), "ci.yml's shard job's DATABASE_URL is loopback");
  ok(Object.keys(jobs).filter(j => /secrets\.RAILWAY_TOKEN/.test(jobs[j])).every(j => /^deploy-/.test(j)), "only a deploy job in ci.yml holds RAILWAY_TOKEN");
}

// ── SECURE-3 item 4 · THE RESTORE DRILL REFUSES PROD ──────────────────────
// scripts/ops/restore-drill.js boots a backend against RESTORE_DATABASE_URL,
// so its refusals are the guard. Fake targets only; nothing connects.
{
  const D = require(path.join(root, "scripts", "ops", "restore-drill.js"));
  const ref = "abcdefghijklmnopqrst";
  const sb = `postgresql://postgres:fakepw@db.${ref}.supabase.co:5432/postgres`;
  const yes = ["--run", "--i-am-jonathan", "--project", "steward-restore-20261108-0300"];
  const R = (env, argv) => D.refusals({ env, argv, rootDir: path.join(root, "tests") });
  ok(R({ RESTORE_DATABASE_URL: sb }, yes).length === 0, "the drill accepts a new steward-restore- project with --i-am-jonathan");
  ok(R({ RESTORE_DATABASE_URL: "postgresql://steward@localhost:5544/steward_restore" }, ["--run"]).length === 0, "the drill accepts a local rehearsal without the confirm");
  ok(R({ RESTORE_DATABASE_URL: sb }, ["--run", "--project", "steward-restore-x"]).length > 0, "a remote target without --i-am-jonathan is refused");
  ok(R({ RESTORE_DATABASE_URL: sb }, ["--run", "--i-am-jonathan", "--project", "prod-copy"]).length > 0, "a project not named steward-restore-* is refused");
  ok(R({ RESTORE_DATABASE_URL: sb, PROD_SUPABASE_REF: ref }, yes).length > 0, "the prod project ref (PROD_SUPABASE_REF) is refused");
  ok(R({ RESTORE_DATABASE_URL: sb, PROD_DATABASE_URL: `postgresql://postgres:x@db.${ref}.supabase.co:5432/postgres` }, yes).length > 0, "a target matching PROD_DATABASE_URL is refused");
  ok(R({ RESTORE_DATABASE_URL: `postgresql://postgres.${ref}:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres`, PROD_SUPABASE_REF: ref }, yes).length > 0, "the prod ref is read from a pooler URL's user too");
  ok(R({ RESTORE_DATABASE_URL: "postgresql://u:p@monorail.proxy.rlwy.net:1/railway" }, yes).length > 0, "a non-Supabase remote host is refused");
  ok(R({ RESTORE_DATABASE_URL: "postgresql://steward@localhost:5544/x", RAILWAY_ENVIRONMENT: "production" }, ["--run"]).length > 0, "a shell with Railway variables is refused");
  ok(R({ RESTORE_DATABASE_URL: "postgresql://steward@localhost:5544/x", NODE_ENV: "production" }, ["--run"]).length > 0, "NODE_ENV=production is refused");
  ok(D.parseTarget(sb).ref === ref && /^[0-9a-f]{64}$/.test(D.PROD_REF_SHA256), "the drill reads a project ref and carries the prod ref's hash");
  const scrub = D.scrubber({ RESTORE_DATABASE_URL: sb });
  ok(!/fakepw/.test(scrub(`connect failed for ${sb}: password fakepw`)), "the drill scrubs the connection string and its password from anything it prints");
  const be = D.backendEnv(sb, 5690, "s", undefined);
  ok(be.DISABLE_BACKGROUND_TICKS === "1" && be.TEST_MODE === "1" && be.ANTHROPIC_API_KEY === "" && /^re_dummy/.test(be.RESEND_API_KEY)
     && /^sk_test_dummy$/.test(be.STRIPE_SECRET_KEY) && /127\.0\.0\.1/.test(be.RESEND_BASE_URL) && /127\.0\.0\.1/.test(be.STRIPE_API_BASE)
     && !Object.keys(be).some(k => /RAILWAY|SUPABASE/.test(k)), "the drill's backend gets a clean env: dummy Resend and Stripe on local ports, no AI key, ticks off");
}

// ── FIX-23 · THE DEMO TEARDOWN IS COMPLETE BY CONSTRUCTION ─────────────────
// On prod, seed-demo.js refused with "the teardown could not remove org
// org_b72demo; still refusing: (the orgs row itself)": every table it knew to
// clear was clear, and something it did not know about still pointed at the
// org. The teardown now reads every table and foreign key from pg_catalog and
// deletes children first. Two things are pinned here, against the battery's
// own scratch database (the shard seeds the demo before this suite):
//   1. no foreign key can block a demo row's delete from a table the teardown
//      cannot pin by org_id. A new table that points at orgs (or at any
//      org-scoped table) through some other column, and has no org_id, fails
//      this line until it gets one.
//   2. seeding twice in a row on one database passes.
// PROVEN ABLE TO FAIL: a table pointing at orgs through owner_org, with no
// org_id, is created inside a transaction that is rolled back, and the plan
// must name it as uncovered.
(async () => {
  const { Client } = require("pg");
  const { execFileSync } = require("child_process");
  const { teardownPlan } = require("../scripts/ci/seed-demo.js");
  const url = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
  const client = new Client({ connectionString: url });
  try { await client.connect(); }
  catch (e) { ok(false, `the demo-teardown guard needs the scratch database (${e.message})`); return; }
  const q = (sql, params = []) => client.query(sql, params).then(r => r.rows);
  try {
    const plan = await teardownPlan(q);
    ok(plan.tables.length > 100 && plan.order.length === plan.tables.length,
       `the teardown plan covers every org-scoped table (${plan.order.length} of ${plan.tables.length})`);
    ok(plan.uncovered.length === 0,
       "no table can block the demo teardown without an org_id to pin it by: "
       + plan.uncovered.map(f => `${f.child}.${f.cols} → ${f.parent} (${f.conname})`).join(", "));
    const pos = new Map(plan.order.map((t, i) => [t, i]));
    const late = plan.fks.filter(f => f.child !== f.parent && pos.has(f.child) && pos.has(f.parent)
      && "ar".includes(f.on_delete) && pos.get(f.child) > pos.get(f.parent));
    ok(late.length === 0, "the teardown deletes every child before its parent: " + late.map(f => f.conname).join(", "));

    await q("BEGIN");
    await q("CREATE TABLE zz_fix23_planted (id serial PRIMARY KEY, owner_org TEXT REFERENCES orgs(id))");
    const planted = await teardownPlan(q);
    await q("ROLLBACK");
    ok(planted.uncovered.some(f => f.child === "zz_fix23_planted"),
       "a planted table that points at orgs without an org_id is caught (proven able to fail)");
  } finally { await client.end(); }

  // HARDEN-1 · A BACKGROUND JOB WAITS FOR THE SCHEMA. On 7 Oct the scores
  // job ran in a new container before its migration added donor_scores.pattern
  // and failed for every org. recordTick (every job's seam) and the scores
  // recompute must await the readiness promise before touching a table.
  // Fails on the code before HARDEN-1, where neither waited.
  {
    const srv = require("../scripts/lib/readSource").splitText("server.js");   // SPLIT-2: server.js is split under server/boot/
    const bodyOf = name => { const i = srv.indexOf(`async function ${name}(`); return i < 0 ? "" : srv.slice(i, i + 400); };
    // FIX-51: the promise lives in bootGate.js, so a boot timer in any module waits too.
    const gate = fs.readFileSync(path.join(root, "bootGate.js"), "utf8");
    ok(/markDbReady\(\)/.test(srv) && /const DB_READY = bootGate\.READY/.test(srv) && /const READY = new Promise/.test(gate),
      "server.js resolves DB_READY (bootGate.READY) when the schema is ready");
    ok(/if \(!dbReady\) await DB_READY/.test(bodyOf("recordTick")), "every background job (recordTick) waits for the schema before it runs");
    ok(/if \(!dbReady\) await DB_READY/.test(bodyOf("recomputeScoresForOrg")), "the scores recompute waits for the schema before it runs");
  }

  for (const run of [1, 2]) {
    let out = "", code = 0;
    try { out = execFileSync("node", ["scripts/ci/seed-demo.js"], { cwd: root, env: process.env, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status; out = String(e.stdout || "") + String(e.stderr || ""); }
    ok(code === 0, `the demo seeds on run ${run} of 2 in a row on one database` + (code ? `:\n${out.split("\n").slice(-12).join("\n")}` : ""));
  }
})().catch(e => ok(false, `the demo-teardown guard crashed: ${e.stack}`)).finally(() => {
  console.log(`script-guards: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});

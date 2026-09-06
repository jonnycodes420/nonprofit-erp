// Script prod-write guard (BUILD-55 Part 1, 2026-08-15). Pure Node, no DB.
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
const read = f => fs.readFileSync(path.join(root, "scripts", f + ".js"), "utf8");

// ── The classification (every scripts/*.js must appear in exactly one list) ──

// Writes data (API or DB) — must resolve its target through prodGuard.
const GUARDED_WRITERS = [
  // BUILD-72 Part 5 — the demo seed. Loopback default via writerBase; any
  // database name outside the scratch allowlist fails closed EXCEPT the one
  // deliberate production path (prod db + prod BASE + --i-know-this-is-prod,
  // BUILD-76 follow-up — puts the Harborlight demo fiction on prod, touching
  // only org_b72demo rows); kb_*/kingdom refuse unconditionally, and the
  // identity check (server's reported database == the one being written)
  // always applies.
  "seed-build72-demo",
  "backfill-campaign-attribution", "build25-workflows-capture", "build35-capture",
  "build36-bulkassign-capture", "build36-notify-capture", "build47-capture",
  "build55-capture", "build57-capture", "build57-import-drill",
  "build48-capture", "build50-capture", "build54-capture",
  "dedupe-finance-gift-stamps", "extend-trials-free-through-2026",
  "finance-entity-routing-capture", "fix-build54-demo-photos",
  "fix-demo-finance-ledger", "invitation-capture", "load-irs-ein-registry",
  "migrate-build51-theme-assets", "migrate-build51b-impact-photos",
  "migrate-plans-core-team", "restore-asset", "seed-build45-asks",
  "seed-build45-portal-demo",
  "seed-build50-demo", "seed-build54-demo", "seed-creo-goals",
  "seed-fundraising-demo",
  "build59-capture", "build59-install-demo-images",
  "build64-capture",
];

// Writes data but HARD-REFUSES any non-loopback target outright (stricter
// than the guard — these are load/e2e fixtures that must never see prod).
const SELF_REFUSING = [
  // BUILD-75 B.1 — the route-inventory walker. BOOTS server.js (schema init
  // runs), so it hard-refuses any non-loopback DATABASE_URL outright.
  "build75-route-inventory","loadtest", "seed-loadtest", "seed-build46-network-demo", "build58-stripe-drill",
  // BUILD-76 — the drift-vs-real-Stripe drill: same rig as build58's (scratch
  // server on :5621 + `stripe listen`), refuses any non-loopback BASE.
  "build76-drift-drill",
  // BUILD-78 Part 0 — the cross-org field_id red-run reproduction. Runs
  // entirely through tests/helpers, whose api()/q() refuse any non-loopback
  // BASE or DATABASE_URL (tests/README.md); the refusal is inherited, and
  // the source note below keeps this suite's pattern check honest.
  "build78-repro-crossorg-fieldid"];

// Loopback is HARDCODED (no BASE env at all) — cannot reach a remote host.
const LOOPBACK_HARDCODED = ["build45-portal-capture", "onramp-capture", "build78-capture", "build79-repro", "build79-capture", "build80-capture"];

// Read-only against whatever BASE points at (may default to prod): their only
// write-shaped call is POST /auth/login. Verified below, not just trusted.
const PROD_READONLY = [
  "attribution-chips-capture", "build12-ui-capture", "build49-capture", "build57-prod-capture",
  "build61-prod-verify", "check-webhook-subscriptions",
  "consistency-audit", "finance-overview-capture",
  // BUILD-73 Part 4 — the landing page was rebuilt, and FIVE scripts that
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
  "build78-migration-reconcile",
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
  // BUILD-72 Part 4 — a pure SOURCE scan (reads server.js/db.js off disk and
  // counts civil-date/instant confusion sites). Touches no server, no database
  // and no network at all.
  "build72-date-audit",
  // BUILD-73 Part 2 — a pure SOURCE scan (reads server.js/db.js off disk and
  // finds any money value rounded to a whole dollar). No server, no database,
  // no network. Run BY tests/money-cents.test.js so the enumeration cannot drift.
  "build73-money-audit",
];

// Browser-driving captures: default loopback; any writes ride the logged-in
// app UI (Playwright), not script-issued fetches. Loopback default asserted.
const LOOPBACK_CAPTURES = [
  // BUILD-72 Part 5 — the walk. Drives the logged-in app in Playwright and
  // only reads; its one script-issued fetch is /auth/login.
  "build72-capture",
  "build14-capture", "build15-capture", "build17-capture", "build19-capture",
  "build19-home-capture", "build21-capture", "build22-capture", "build28-capture",
  "build34-capture", "build36-invite-capture", "build40-mobile-capture", "build61-capture",
  "build41-capture", "build46-capture", "creo-goals-capture",
  "donor-profile-gating-capture", "goal-consistency-capture", "import-stage-capture",
];

// Out of scope for BASE/DB guarding, each for a stated reason.
const EXEMPT = {
  "local-preview": "serves client/dist and proxies vercel.json's rewrites to a LOOPBACK-ONLY API; refuses any non-loopback API and writes nothing",
  "build73-landing-capture": "read-only Playwright capture of the PUBLIC landing page; refuses any non-loopback APP_ORIGIN, logs in to nothing and writes only PNGs under docs/landing/",
  "build28-prepare-images": "local image generation, no network writes",
  "create-billing-products": "writes to STRIPE, not the app; has its own refuse-live-without---live guard",
  "audit-gate": "BUILD-75 B.6 — runs `npm audit --json` on the local package and compares against audit/npm-audit-allowlist.json; no BASE, no DB, no app writes",
};

// ── 1. Every script file is classified ──────────────────────────────────────
const all = fs.readdirSync(path.join(root, "scripts")).filter(f => f.endsWith(".js")).map(f => f.replace(/\.js$/, ""));
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
  const prep = read("build28-prepare-images");
  ok(!/process\.env\.BASE|method:\s*["'](POST|PUT|PATCH|DELETE)/.test(prep), "build28-prepare-images stays network-write-free");
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

console.log(`script-guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

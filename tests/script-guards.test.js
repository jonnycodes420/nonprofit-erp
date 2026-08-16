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
];

// Writes data but HARD-REFUSES any non-loopback target outright (stricter
// than the guard — these are load/e2e fixtures that must never see prod).
const SELF_REFUSING = ["loadtest", "seed-loadtest", "seed-build46-network-demo"];

// Loopback is HARDCODED (no BASE env at all) — cannot reach a remote host.
const LOOPBACK_HARDCODED = ["build45-portal-capture", "onramp-capture"];

// Read-only against whatever BASE points at (may default to prod): their only
// write-shaped call is POST /auth/login. Verified below, not just trusted.
const PROD_READONLY = [
  "attribution-chips-capture", "build12-ui-capture", "build49-capture",
  "consistency-audit", "finance-overview-capture", "landing-crispness-prod",
  "landing-funnel-verify", "landing-hero-verify", "landing-image-verify",
  "landing-motion-verify", "screenshot-matrix", "topbar-verify",
];

// Browser-driving captures: default loopback; any writes ride the logged-in
// app UI (Playwright), not script-issued fetches. Loopback default asserted.
const LOOPBACK_CAPTURES = [
  "build14-capture", "build15-capture", "build17-capture", "build19-capture",
  "build19-home-capture", "build21-capture", "build22-capture", "build28-capture",
  "build34-capture", "build36-invite-capture", "build40-mobile-capture",
  "build41-capture", "build46-capture", "creo-goals-capture",
  "donor-profile-gating-capture", "goal-consistency-capture", "import-stage-capture",
];

// Out of scope for BASE/DB guarding, each for a stated reason.
const EXEMPT = {
  "build28-prepare-images": "local image generation, no network writes",
  "create-billing-products": "writes to STRIPE, not the app; has its own refuse-live-without---live guard",
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

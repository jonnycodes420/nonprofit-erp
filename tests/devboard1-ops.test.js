// DEVBOARD-1 · /ops, ONE PAGE THAT SHOWS THE WHOLE MACHINE.
//
// This guards security: /ops shows every customer org by name, the state of
// prod and the build pipeline, so it exists for live super-admins only.
//
//   §1 the door: signed out, a bad token, staff, an org admin and a demoted
//      super-admin (token still says super) all get 404; a super-admin 200.
//      RED ON MAIN: the route does not exist (404 for the super-admin too).
//   §2 the board: a fixture walk makes the right items; a build closes two;
//      the next day's walk verifies what passed, reopens what failed again,
//      keeps the rest open and adds what is new. Dry run writes nothing.
//   §3 a source down: with GitHub and the frontend unreachable, /ops answers
//      in under a second, those sections say so, and the rest is there; the
//      page itself renders and shows the sentence.
//   §4 a build's state: CI running, red, green, quiet after 45 minutes.
//
// WHAT WOULD MAKE THIS FAIL (planted and watched go red, see the PR):
//   · the door letting a staff user through (opsOnly → requireAuth)  → §1
//   · applyWalk leaving a passed item open                             → §2
//   · one source's failure taking the whole snapshot down               → §3
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { execFileSync } = require("child_process");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow } = require("./clock");

const ORG = "org_db1_hq", CUST = "org_db1_cust", DEMO = "org_db1_demo";
const ORGS = [ORG, CUST, DEMO];
const PW = "loadtest1234";
const SUPER = "db1-super@t.local", DEMOTED = "db1-demoted@t.local", ADMIN = "db1-admin@t.local", STAFF = "db1-staff@t.local";
const FIX = path.join(__dirname, "fixtures", "devboard1");
const ROOT = path.join(__dirname, "..");

async function reset() {
  await q(`DELETE FROM user_sessions WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id = ANY($1)`, [ORGS]).catch(() => {});
}

(async () => {
  await reset();
  const hash = bcrypt.hashSync(PW, 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES
           ($1,'Devboard HQ','db1-hq',1,'active','team','internal_test'),
           ($2,'Larkspur Pantry Collective','db1-larkspur',1,'active','team','customer'),
           ($3,'Devboard Demo Org','db1-demo',1,'active','team','demo')`, [ORG, CUST, DEMO]);
  const user = (id, org, email, role, sup) => q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, org, email, hash, id, role, sup]);
  await user("u_db1_super", ORG, SUPER, "admin", true);
  await user("u_db1_demoted", ORG, DEMOTED, "admin", true);
  await user("u_db1_admin", CUST, ADMIN, "admin", false);
  await user("u_db1_staff", CUST, STAFF, "staff", false);

  console.log("\n§1 · the door: 404 for everyone but a live super-admin");
  const sup = await login(SUPER), demoted = await login(DEMOTED), admin = await login(ADMIN), staff = await login(STAFF);
  await q(`UPDATE users SET is_super_admin = false WHERE id = 'u_db1_demoted'`);   // the token still says super
  const tampered = jwt.sign({ userId: "u_db1_super", orgId: ORG, isSuperAdmin: true }, "not-the-secret");
  for (const [who, tok] of [["signed out", null], ["a tampered token", tampered], ["staff", staff], ["an org admin", admin], ["a demoted super-admin", demoted]]) {
    const r = await api("GET", "/ops", tok);
    ok(`${who} gets 404 on GET /ops`, r.status === 404, r.status);
    ok(`…and the answer names nothing`, !/Larkspur|health|board/i.test(JSON.stringify(r.body || "")), r.body);
  }
  const first = await api("GET", "/ops", sup);
  ok("a super-admin gets 200 on GET /ops (RED ON MAIN: no such route)", first.status === 200, first.status);

  console.log("\n§2 · the board: one walk, a build's close, the next walk");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db1-board-"));
  const board = path.join(dir, "board.json");
  fs.writeFileSync(board, JSON.stringify({ version: 1, items: [], walks: [] }));
  const runScript = (script, args) => execFileSync(process.execPath, [path.join(ROOT, "scripts", "ops", script), ...args, "--board", board], { encoding: "utf8" });
  const read = () => JSON.parse(fs.readFileSync(board, "utf8"));
  const dry = runScript("board-import-walk.js", [path.join(FIX, "walk-2026-11-04.md")]);
  ok("a dry run writes nothing", read().items.length === 0 && /Dry run/.test(dry), dry);
  runScript("board-import-walk.js", [path.join(FIX, "walk-2026-11-04.md"), "--write"]);
  let b = read();
  const st = id => (b.items.find(i => i.id === id) || {}).state;
  ok("each FAIL is an open item, by date and check", JSON.stringify(b.items.map(i => [i.id, i.state])) === JSON.stringify([["W-1104-Grants-3", "open"], ["W-1104-List9", "open"], ["W-1104-Prof4", "open"]]), b.items.map(i => i.id));
  ok("…with the finding's words", (b.items.find(i => i.id === "W-1104-Prof4") || {}).words === "The profile rail reads $0 lifetime for a person with three gifts");
  ok("the walk's counts go into the trend: 2 pass, 3 fail, 1 skip", JSON.stringify(b.walks.map(w => [w.date, w.pass, w.fail, w.skip])) === JSON.stringify([["2026-11-04", 2, 3, 1]]), b.walks);
  runScript("board-import-walk.js", [path.join(FIX, "walk-2026-11-04.md"), "--write"]);
  ok("importing the same walk again changes nothing", JSON.stringify(read()) === JSON.stringify(b));
  const report = path.join(dir, "PEOPLE-9.md");
  fs.writeFileSync(report, "# PEOPLE-9 report\n\nCloses: W-1104-Prof4, W-1104-List9\n");
  runScript("board.js", ["close", "PEOPLE-9", report, "--date", "2026-11-04", "--write"]);
  b = read();
  ok("a build report's Closes line moves its items to fixed, owned by the build", st("W-1104-Prof4") === "fixed" && st("W-1104-List9") === "fixed"
    && b.items.find(i => i.id === "W-1104-Prof4").fixedBy === "PEOPLE-9" && st("W-1104-Grants-3") === "open");
  runScript("board-import-walk.js", [path.join(FIX, "walk-2026-11-05.md"), "--write"]);
  b = read();
  ok("the next walk's PASS makes the fixed item verified", st("W-1104-Prof4") === "verified", st("W-1104-Prof4"));
  ok("a fixed item that fails again is reopened", st("W-1104-List9") === "reopened", st("W-1104-List9"));
  ok("an open item that still fails stays open, once", st("W-1104-Grants-3") === "open" && b.items.filter(i => i.check === "Grants-3").length === 1);
  ok("a check that passed yesterday and fails today is a new item", st("W-1105-Gift1") === "open", b.items.map(i => i.id));
  ok("the trend has both days: fails 3, 3", JSON.stringify(b.walks.map(w => [w.date, w.pass, w.fail, w.skip])) === JSON.stringify([["2026-11-04", 2, 3, 1], ["2026-11-05", 2, 3, 2]]), b.walks);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log("\n§3 · GitHub and the frontend unreachable: those sections say so, the rest loads");
  process.env.OPS_GITHUB_API = "http://127.0.0.1:9";       // nothing listens on the discard port
  process.env.STATUS_FRONTEND_URL = "http://127.0.0.1:9";
  delete process.env.OPS_GITHUB_TOKEN;
  const SOURCES = require("../server/admin/opsSources");
  const qmark = sql => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); };
  const pg = { query: (sql, p) => q(qmark(sql), p), run: (sql, p) => q(qmark(sql), p) };
  await q(`DELETE FROM ops_snapshots WHERE key = 'ops'`).catch(() => {});   // the worker makes the table on its first refresh
  await q(`INSERT INTO user_sessions (id,user_id,org_id,created_at) VALUES ('ses_db1_admin','u_db1_admin',$1,$2)`, [CUST, new Date(testNow() - 3 * 3600e3).toISOString()]);
  await SOURCES.refreshSnapshot({ ...pg, buildSha: "abc1234", now: testNow() });
  const t0 = performance.now();
  const r = await api("GET", "/ops", sup);
  const took = performance.now() - t0;
  const o = r.body || {};
  ok(`/ops answers in under a second with GitHub down (${Math.round(took)} ms)`, r.status === 200 && took < 1000, r.status);
  ok("Builds says GitHub could not be reached", o.builds && o.builds.ok === false && /GitHub could not be reached|did not answer/.test(o.builds.error), o.builds);
  ok("the smoke and the nightly load say so too", o.health && o.health.ci.ok === false && o.health.load.ok === false, o.health && [o.health.ci, o.health.load]);
  ok("the frontend's commit says it could not be read", o.health && o.health.shas.frontend === null && /frontend could not be reached/i.test(o.health.frontendError || ""), o.health && o.health.frontendError);
  ok("prod health still shows the web's queue, pool and mailboxes", o.health && o.health.queue && o.health.pool && o.health.mailbox && "web" in o.health.shas);
  ok("the board still loads", o.board && o.board.ok === true && o.board.counts && Array.isArray(o.board.walks), o.board);
  const rows = (o.customers && o.customers.rows) || [];
  ok("customers lists the live org with its last sign-in, and not the demo or internal org",
    o.customers && o.customers.ok && rows.some(c => c.name === "Larkspur Pantry Collective" && c.lastLogin) && !rows.some(c => /Devboard/.test(c.name)), rows);
  const text = JSON.stringify(o);
  ok("nothing secret or personal in the answer (no token, no address, no connection string)",
    !/postgres(ql)?:\/\/|Bearer|@t\.local|password|DATABASE_URL|sk_test|re_dummy/i.test(text));
  // The page itself, rendered from this answer.
  const esbuild = require(path.join(ROOT, "client", "node_modules", "esbuild"));
  const out = path.join(os.tmpdir(), `db1-opsview-${process.pid}.cjs`);
  esbuild.buildSync({ entryPoints: [path.join(ROOT, "client", "src", "pages", "ops", "OpsView.jsx")], bundle: true, platform: "node", format: "cjs",
    outfile: out, external: ["react", "react-dom"], jsx: "automatic", nodePaths: [path.join(ROOT, "client", "node_modules")], logLevel: "silent" });
  const Module = require("module");
  const req = Module.createRequire(path.join(ROOT, "client", "package.json"));
  const React = req("react"), { renderToStaticMarkup } = req("react-dom/server");
  const m = new Module(out); m.paths = Module._nodeModulePaths(path.join(ROOT, "client")); m._compile(fs.readFileSync(out, "utf8"), out);
  fs.rmSync(out, { force: true });
  const html = renderToStaticMarkup(React.createElement(m.exports.default, { data: o, now: testNow() }));
  ok("the page renders with GitHub down, and its Builds section says so", /Builds/.test(html) && /GitHub could not be reached|did not answer/.test(html) && /Prod health/.test(html) && /Larkspur Pantry Collective/.test(html), html.slice(0, 300));

  console.log("\n§4 · a build's state and a quiet tab");
  const now = testNow(), at = min => new Date(now - min * 60000).toISOString();
  const pr = (updatedMin) => ({ created_at: at(300), updated_at: at(updatedMin), merged_at: null });
  ok("CI running is never quiet", SOURCES.prState(pr(90), { status: "in_progress", created_at: at(90), updated_at: at(90) }, { now }).state === "ci running"
    && SOURCES.prState(pr(90), { status: "in_progress", created_at: at(90), updated_at: at(90) }, { now }).quiet === null);
  const red = SOURCES.prState(pr(50), { status: "completed", conclusion: "failure", updated_at: at(50) }, { now });
  ok("a red run 50 minutes old is red and quiet for 50 minutes", red.state === "red" && red.quiet === 50, red);
  const green = SOURCES.prState(pr(20), { status: "completed", conclusion: "success", updated_at: at(20) }, { now });
  ok("a green run 20 minutes old is green and not quiet", green.state === "green" && green.quiet === null, green);
  ok("a PR with no push or CI for a week is parked, not quiet", SOURCES.prState({ created_at: at(20000), updated_at: at(15000), merged_at: null }, null, { now }).state === "parked");
  ok("a merged PR in the deployed commit is live", SOURCES.prState({ merged_at: at(30) }, null, { now, deployedHas: true }).state === "live");
  ok("the build is the title's prefix", SOURCES.buildOf("GIFTS-1: a gift can belong to an event") === "GIFTS-1" && SOURCES.buildOf("HOME-6 hotfix: x") === "HOME-6" && SOURCES.buildOf("fix a typo") === null);

  await q(`DELETE FROM ops_snapshots WHERE key = 'ops'`);
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });

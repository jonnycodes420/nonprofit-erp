// DEVBOARD-2 · EVERY PART OF STEWARD ON ONE MAP, WITH A CHECK YOU CAN RUN FROM /ops.
//
// This guards security: the new routes write to the database and open links
// into an org, so they exist for live super-admins only, and a link may only
// ever open the demo org.
//
//   §1 the door: signed out, staff and an org admin get 404 on every new route,
//      and a staff POST writes no row.
//   §2 the Map lists every area in ops/map.json (the answer and the page).
//   §3 a walk import puts each check's last result in its area; an unknown
//      prefix lands in Unsorted; an older walk never overwrites a newer one.
//   §4 Fail with a note (and a screenshot) makes a board item on GET /ops;
//      another Fail joins it; Pass verifies it.
//   §5 Open in demo points only at the demo org: a customer's person of the
//      same name is never linked, and no link names another org or path.
//   RED ON MAIN: /ops/map and /ops/checks do not exist (404 for the super-admin).
//
// WHAT WOULD MAKE THIS FAIL (planted and watched go red, see the PR):
//   · demoPeople looking a name up in any org (the demo filter dropped)  → §5
//   · POST /ops/checks behind requireAuth instead of the super-admin door → §1
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
require("./clock");

const ROOT = path.join(__dirname, "..");
const MAP = require("../server/admin/opsMap");
const BOARD = require("../server/admin/board");
const SEED = require("../scripts/ci/seed-demo");
const ORG = "org_db2_hq", CUST = "org_db2_cust";
const ORGS = [ORG, CUST];
const PW = "loadtest1234";
const SUPER = "db2-super@t.local", ADMIN = "db2-admin@t.local", STAFF = "db2-staff@t.local";
const FIX = path.join(__dirname, "fixtures", "devboard1");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function reset() {
  await q(`DELETE FROM ops_checks WHERE created_by LIKE 'u_db2_%'`).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM user_sessions WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id = ANY($1)`, [ORGS]).catch(() => {});
}
const rowsBy = async who => Number(((await q(`SELECT COUNT(*)::int AS n FROM ops_checks WHERE created_by = $1`, [who]).catch(() => [{ n: 0 }]))[0] || {}).n || 0);

function renderMapView(props) {
  const esbuild = require(path.join(ROOT, "client", "node_modules", "esbuild"));
  const out = path.join(os.tmpdir(), `db2-mapview-${process.pid}.cjs`);
  esbuild.buildSync({ entryPoints: [path.join(ROOT, "client", "src", "pages", "ops", "MapView.jsx")], bundle: true, platform: "node", format: "cjs",
    outfile: out, external: ["react", "react-dom"], jsx: "automatic", nodePaths: [path.join(ROOT, "client", "node_modules")], logLevel: "silent" });
  const Module = require("module");
  const req = Module.createRequire(path.join(ROOT, "client", "package.json"));
  const React = req("react"), { renderToStaticMarkup } = req("react-dom/server");
  const m = new Module(out); m.paths = Module._nodeModulePaths(path.join(ROOT, "client")); m._compile(fs.readFileSync(out, "utf8"), out);
  fs.rmSync(out, { force: true });
  return renderToStaticMarkup(React.createElement(m.exports.default, props));
}

(async () => {
  await reset();
  const hash = bcrypt.hashSync(PW, 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES
           ($1,'Devboard Two HQ','db2-hq',1,'active','team','internal_test'),
           ($2,'Quillfeather Reading Circle','db2-quill',1,'active','team','customer')`, [ORG, CUST]);
  const user = (id, org, email, role, sup) => q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, org, email, hash, id, role, sup]);
  await user("u_db2_super", ORG, SUPER, "admin", true);
  await user("u_db2_admin", CUST, ADMIN, "admin", false);
  await user("u_db2_staff", CUST, STAFF, "staff", false);
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, "ops", "map.json"), "utf8"));
  const personNames = [...new Set(map.areas.flatMap(a => a.checks.map(c => c.person).filter(Boolean)))];
  // A customer's people who share every demo person's name: never to be linked.
  for (const [i, n] of personNames.entries())
    await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','test')`, [`d_db2_twin${i}`, CUST, n, `twin${i}@t.local`]);

  console.log("\n§1 · the door: 404 on every new route for anyone but a live super-admin");
  const sup = await login(SUPER), admin = await login(ADMIN), staff = await login(STAFF);
  const body = { area: "gifts", check: "Gift-A", verdict: "fail", note: "a staff note" };
  for (const [who, tok, id] of [["signed out", null, null], ["staff", staff, "u_db2_staff"], ["an org admin", admin, "u_db2_admin"]]) {
    const g = await api("GET", "/ops/map", tok);
    ok(`${who} gets 404 on GET /ops/map`, g.status === 404 && !/Gift-A|Margaret|areas/.test(JSON.stringify(g.body || "")), g.status);
    const before = id ? await rowsBy(id) : 0;
    const p = await api("POST", "/ops/checks", tok, body);
    ok(`${who} gets 404 on POST /ops/checks`, p.status === 404, p.status);
    if (id) ok(`…and no row is written for ${who}`, (await rowsBy(id)) === before);
    const s = await api("GET", "/ops/checks/opc_x/shot", tok);
    ok(`${who} gets 404 on GET /ops/checks/:id/shot`, s.status === 404, s.status);
  }

  console.log("\n§2 · the Map tab lists every area in ops/map.json");
  ok("ops/map.json is a valid map", MAP.validateMap(map).length === 0, MAP.validateMap(map));
  const r = await api("GET", "/ops/map", sup);
  ok("a super-admin gets 200 on GET /ops/map (RED ON MAIN: no such route)", r.status === 200 && r.body && r.body.ok, r.status);
  const areas = (r.body && r.body.areas) || [];
  ok("every area in map.json is on the Map, in order, then Unsorted",
    JSON.stringify(areas.map(a => a.name)) === JSON.stringify([...map.areas.map(a => a.name), "Unsorted"]), areas.map(a => a.name));
  ok("every check in map.json is in its area", map.areas.every(a => {
    const got = areas.find(x => x.id === a.id); return got && JSON.stringify(got.checks.map(c => c.id)) === JSON.stringify(a.checks.map(c => c.id)); }));
  const html = renderMapView({ data: r.body, onMark: () => {} });
  ok("the page names every area and every check", map.areas.every(a => html.includes(a.name) && a.checks.every(c => html.includes(`data-check="${c.id}"`))), html.slice(0, 200));
  ok("…with Pass and Fail on every check", map.areas.every(a => a.checks.every(c => html.includes(`aria-label="Pass ${c.id}"`) && html.includes(`aria-label="Fail ${c.id}"`))));

  console.log("\n§3 · a walk import puts each check's last result in its area");
  let board = { version: 1, items: [], walks: [] };
  const walk = f => BOARD.parseWalk(fs.readFileSync(path.join(FIX, f), "utf8"));
  board = BOARD.applyWalk(board, walk("walk-2026-11-04.md"), { date: "2026-11-04" }).board;
  board = BOARD.applyWalk(board, walk("walk-2026-11-05.md"), { date: "2026-11-05" }).board;
  board = BOARD.applyWalk(board, [{ check: "Zed4", verdict: "FAIL", words: "A check of no known area" }, { check: "Prof4", verdict: "FAIL", words: "older" }], { date: "2026-11-03" }).board;
  const m = MAP.buildMap(map, board, []);
  const wc = (area, id) => ((m.find(a => a.id === area) || {}).walkChecks || []).find(c => c.id === id) || {};
  ok("Prof4 is in Profile, last PASS on 11-05 (the older 11-03 walk did not overwrite it)", wc("profile", "Prof4").verdict === "PASS" && wc("profile", "Prof4").date === "2026-11-05", wc("profile", "Prof4"));
  ok("List9 is in Donors list, FAIL on 11-05, with the walk's words", wc("donors", "List9").verdict === "FAIL" && /forgets its sort/.test(wc("donors", "List9").words), wc("donors", "List9"));
  ok("Grants-3 is in Grants, Gift1 in Gifts, Home2 in Home, Rep7 (SKIP) in Reports",
    wc("grants", "Grants-3").verdict === "FAIL" && wc("gifts", "Gift1").verdict === "FAIL" && wc("home", "Home2").verdict === "PASS" && wc("reports", "Rep7").verdict === "SKIP");
  ok("an unknown prefix lands in Unsorted, never nowhere", wc("unsorted", "Zed4").verdict === "FAIL" && (m.find(a => a.id === "unsorted").items || []).some(i => i.check === "Zed4"));
  ok("each area shows its open walk items", (m.find(a => a.id === "donors").items || []).some(i => i.id === "W-1104-List9") && (m.find(a => a.id === "grants").items || []).some(i => i.id === "W-1104-Grants-3"));
  const mhtml = renderMapView({ data: { ok: true, areas: m, lastWalk: "2026-11-05", demo: { signIn: MAP.DEMO_DIRECTOR, missing: [] } }, onMark: () => {} });
  ok("the page shows a walk check's result in its area", /data-area="profile"[\s\S]*data-check="Prof4"[\s\S]*walk pass · Nov 5[\s\S]*data-area="gifts"/.test(mhtml));

  console.log("\n§4 · Fail with a note makes a board item; Pass verifies it");
  const noNote = await api("POST", "/ops/checks", sup, { area: "gifts", check: "Gift-A", verdict: "fail", note: "  " });
  ok("a Fail with no note is refused", noNote.status === 400 && noNote.body.error === "note_required", noNote.body);
  const bad = await api("POST", "/ops/checks", sup, { area: "gifts", check: "Gift-A", verdict: "fail", note: "x", shot: "data:text/html;base64,PGI+" });
  ok("a screenshot that is not an image is refused", bad.status === 400 && bad.body.error === "bad_shot", bad.body);
  const unknown = await api("POST", "/ops/checks", sup, { area: "gifts", check: "Prof-A", verdict: "pass" });
  ok("a check not in that area is refused", unknown.status === 400, unknown.status);
  const f1 = await api("POST", "/ops/checks", sup, { area: "gifts", check: "Gift-A", verdict: "fail", note: "Raised stayed at $0 after a $250 gift", shot: PNG });
  const itemId = f1.body && f1.body.item && f1.body.item.id;
  ok("Fail with a note opens an item J-<MMDD>-Gift-A", f1.status === 201 && /^J-\d{4}-Gift-A$/.test(itemId || "") && f1.body.item.state === "open", f1.body);
  const [row] = await q(`SELECT created_by, created_by_name, area_id, verdict FROM ops_checks WHERE id = $1`, [f1.body.id]);
  ok("the row is stamped with the super-admin who marked it", row && row.created_by === "u_db2_super" && row.created_by_name && row.area_id === "gifts" && row.verdict === "fail", row);
  let ops = await api("GET", "/ops", sup);
  const findItem = o => ((o.body && o.body.board && o.body.board.builds) || []).flatMap(g => g.items).find(i => i.id === itemId);
  let it = findItem(ops);
  ok("the item is on the board beside the walk's, source jonathan, open, with the note and the screenshot",
    it && it.source === "jonathan" && it.state === "open" && it.words === "Raised stayed at $0 after a $250 gift" && it.check === "Gift-A" && it.area === "gifts" && it.shot === f1.body.id, it);
  const shot = await fetch(require("./helpers").BASE + `/ops/checks/${f1.body.id}/shot`, { headers: { Authorization: `Bearer ${sup}` } });
  ok("its screenshot opens, as an image", shot.status === 200 && /image\/png/.test(shot.headers.get("content-type") || ""), shot.status);
  const f2 = await api("POST", "/ops/checks", sup, { area: "gifts", check: "Gift-A", verdict: "fail", note: "still $0" });
  ok("a second Fail joins the open item rather than making another", f2.status === 201 && f2.body.item.id === itemId && f2.body.item.joined === true, f2.body);
  const mm = await api("GET", "/ops/map", sup);
  const giftA = (((mm.body.areas || []).find(a => a.id === "gifts") || {}).checks || []).find(c => c.id === "Gift-A") || {};
  ok("the Map shows the check's open item and your last mark", giftA.item && giftA.item.id === itemId && giftA.mark && giftA.mark.verdict === "fail", giftA);
  const p1 = await api("POST", "/ops/checks", sup, { area: "gifts", check: "Gift-A", verdict: "pass" });
  ok("Pass on that check verifies the item", p1.status === 201 && p1.body.item && p1.body.item.id === itemId && p1.body.item.state === "verified", p1.body);
  ops = await api("GET", "/ops", sup);
  it = findItem(ops);
  ok("…and the board shows it verified", it && it.state === "verified", it);
  const p2 = await api("POST", "/ops/checks", sup, { area: "gifts", check: "Gift-A", verdict: "pass" });
  ok("a Pass with nothing open verifies nothing", p2.status === 201 && p2.body.item === null, p2.body);
  const merged = MAP.mergeBoard({ items: [{ id: "W-1104-Gift-A", source: "walk", check: "Gift-A", state: "open", opened: "2026-11-04", history: [] }], walks: [] },
    [{ id: "opc_1", area_id: "gifts", check_id: "Gift-A", verdict: "pass", created_at: "2026-11-05T15:00:00Z" }]);
  ok("a Pass also verifies the walk's open item on that check, in the merged board", merged.items[0].state === "verified" && merged.items[0].verifiedBy === "jonathan");

  console.log("\n§5 · Open in demo points only at the demo org");
  ok("the map's demo org is the one seed-demo.js seeds", MAP.DEMO_ORG === SEED.ORG && r.body.demo.org === SEED.ORG && r.body.demo.signIn === SEED.ADMIN_EMAIL);
  const hrefs = areas.flatMap(a => [a.open, ...a.checks.map(c => c.open)]).filter(Boolean);
  ok("every area with a screen, and every check with one, has a link", hrefs.length >= map.areas.reduce((n, a) => n + a.checks.filter(c => c.open || c.person).length, 0));
  const target = h => (h.startsWith("/login?next=") ? decodeURIComponent(h.slice("/login?next=".length)) : h);
  ok("each link signs in first (/login?next=), or is the demo's own public giving page", hrefs.every(h => h.startsWith("/login?next=") || h.startsWith(`/give/${MAP.DEMO_SLUG}`)), hrefs.filter(h => !h.startsWith("/login?next=")));
  ok("each link opens a path inside the app that names no org", hrefs.every(h => MAP.safePath(target(h)) && !/org_|[?&]org/i.test(target(h))), hrefs);
  ok("no link opens the customer's person of the same name", !hrefs.some(h => /d_db2_twin/.test(h)), hrefs.filter(h => /d_db2_twin/.test(h)));
  const ids = [...new Set(hrefs.map(h => (/^\/donors\/([^#?]+)/.exec(target(h)) || [])[1]).filter(Boolean))];
  const owners = ids.length ? await q(`SELECT DISTINCT org_id FROM donors WHERE id = ANY($1)`, [ids]) : [];
  ok(`every person a link opens is a demo person (${ids.length} linked, ${r.body.demo.missing.length} not seeded here)`,
    owners.every(o => o.org_id === SEED.ORG) && ids.length + r.body.demo.missing.length >= personNames.length, owners);
  ok("a link to another org, another giving page or another host is never made",
    MAP.demoHref({ open: "/app/settings?org=org_creo" }) === null && MAP.demoHref({ open: "/give/someone-else" }) === null
    && MAP.demoHref({ open: "//evil.example/donors" }) === null && MAP.demoHref({ open: "/donors/d_1?orgId=x" }) === null
    && MAP.validateMap({ areas: [{ id: "x", name: "X", checks: [{ id: "X-A", says: "s", open: "/give/creo" }] }] }).length === 1);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await reset(); await closeDb(); } catch { /* closing */ } process.exit(1); });

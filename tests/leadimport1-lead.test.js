// LEAD-IMPORT-1 · THE QA FLEET'S MORNING SUMMARY LANDS ON THE /ops BOARD.
//
// This guards security: POST /ops/imports writes to the database from an
// uploaded file, so it exists for live super-admins only.
//
//   §1 the door: signed out, staff and an org admin get 404 on both new routes,
//      and no row is written.
//   §2 a fixture lead summary imports with the right tiers and IDs (the parser,
//      the preview, the confirm, and the board and "This morning" on GET /ops).
//   §3 importing the same file again changes nothing.
//   §4 a REPEAT of a fixed item reopens it; a "passing again" line verifies.
//   §5 an unknown line is listed in the preview, with why.
//   RED ON MAIN: there is no lead parser and no /ops/imports (404 for the super-admin).
//
// WHAT WOULD MAKE THIS FAIL (planted and watched go red, see the PR):
//   · the importer dropping tier 1 items                                → §2
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
require("./clock");

const FIX = path.join(__dirname, "fixtures", "leadimport1");
const ORG = "org_li1_hq", CUST = "org_li1_cust";
const ORGS = [ORG, CUST];
const PW = "loadtest1234";
const SUPER = "li1-super@t.local", ADMIN = "li1-admin@t.local", STAFF = "li1-staff@t.local";
const read = f => fs.readFileSync(path.join(FIX, f), "utf8");
const L7 = "lead-2026-11-07.md", L8 = "lead-2026-11-08.md";

let LEAD = null, IMPORTS = null;
try { LEAD = require("../server/admin/leadImport"); IMPORTS = require("../server/admin/opsImports"); } catch (e) { /* RED ON MAIN: no such modules */ }

async function reset() {
  await q(`DELETE FROM ops_imports WHERE created_by LIKE 'u_li1_%'`).catch(() => {});
  await q(`DELETE FROM user_sessions WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id = ANY($1)`, [ORGS]).catch(() => {});
}
const importRows = async () => Number(((await q(`SELECT COUNT(*)::int AS n FROM ops_imports`).catch(() => [{ n: 0 }]))[0] || {}).n || 0);
const boardItems = o => ((o.body && o.body.board && o.body.board.builds) || []).flatMap(g => g.items);

(async () => {
  await reset();
  const hash = bcrypt.hashSync(PW, 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES
           ($1,'Lead Import HQ','li1-hq',1,'active','team','internal_test'),
           ($2,'Thistledown Arts Trust','li1-thistle',1,'active','team','customer')`, [ORG, CUST]);
  const user = (id, org, email, role, sup) => q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, org, email, hash, id, role, sup]);
  await user("u_li1_super", ORG, SUPER, "admin", true);
  await user("u_li1_admin", CUST, ADMIN, "admin", false);
  await user("u_li1_staff", CUST, STAFF, "staff", false);
  const sup = await login(SUPER), admin = await login(ADMIN), staff = await login(STAFF);
  const body7 = { fileName: L7, text: read(L7) };
  const base0 = await importRows();   // rows anyone else left: every count below is relative

  console.log("\n§1 · the door: 404 on both new routes for anyone but a live super-admin");
  for (const [who, tok] of [["signed out", null], ["staff", staff], ["an org admin", admin]]) {
    const before = await importRows();
    const p = await api("POST", "/ops/imports/preview", tok, body7);
    ok(`${who} gets 404 on POST /ops/imports/preview`, p.status === 404 && !/W-1107|tier/i.test(JSON.stringify(p.body || "")), p.status);
    const w = await api("POST", "/ops/imports", tok, body7);
    ok(`${who} gets 404 on POST /ops/imports`, w.status === 404, w.status);
    ok(`…and no row is written for ${who}`, (await importRows()) === before);
  }

  console.log("\n§2 · a fixture lead summary imports with the right tiers and IDs");
  ok("the lead parser exists (RED ON MAIN)", !!LEAD && !!IMPORTS);
  const want = [["W-1107-Donors-12", 1, "REPEAT", "donors"], ["W-1107-Finance-3", 1, "NEW", "finance"], ["W-1107-Fundraising-4", 2, "REPEAT", "campaigns"],
    ["W-1107-Volunteers-2", 2, "NEW", "volunteers"], ["W-1107-Atlas-7", 3, "NEW", "atlas"], ["W-1107-Donors-5", 4, "NEW", "donors"], ["W-1107-Finance-9", 5, "NEW", "finance"]];
  if (LEAD) {
    ok("the file is read as the lead's shape; the old walk report still as a walk",
      LEAD.shapeOf(read(L7), L7) === "lead" && LEAD.shapeOf(fs.readFileSync(path.join(__dirname, "fixtures", "devboard1", "walk-2026-11-05.md"), "utf8"), "walk-2026-11-05.md") === "walk");
    const lead = LEAD.parseLead(read(L7), L7);
    ok("every item, with its ID, tier, NEW/REPEAT and Map area, in the file's order",
      JSON.stringify(lead.items.map(i => [i.id, i.tier, i.seen, i.area])) === JSON.stringify(want), lead.items.map(i => [i.id, i.tier, i.seen, i.area]));
    const d12 = lead.items.find(i => i.id === "W-1107-Donors-12") || {}, v2 = lead.items.find(i => i.id === "W-1107-Volunteers-2") || {};
    ok("…with its check, its one line and its evidence (list line and table row alike)",
      d12.check === "Donors-12" && d12.checkNo === 12 && d12.fleetArea === "Donors" && /reads \$0 lifetime for Wren Halloway, who has three gifts$/.test(d12.words) && d12.evidence === "donors/shot-12.png"
      && v2.words === "Saving a shift clears its notes" && v2.evidence === "volunteers/2.png" && lead.date === "2026-11-07", [d12, v2]);
  }
  const pv = await api("POST", "/ops/imports/preview", sup, body7);
  ok("a super-admin's preview answers 200 (RED ON MAIN: no such route)", pv.status === 200 && pv.body && pv.body.shape === "lead", pv.status);
  const pvb = pv.body || {};
  ok("the preview lists the seven fails, tier 1 first", JSON.stringify((pvb.items || []).map(i => [i.id, i.tier])) === JSON.stringify(want.map(w => [w[0], w[1]])), (pvb.items || []).map(i => [i.id, i.tier]));
  ok("…and would add seven items", JSON.stringify((pvb.changes || {}).added || []) !== "[]" && want.every(w => pvb.changes.added.includes(w[0])) && pvb.changes.added.length === 7, pvb.changes);
  ok("a preview writes nothing", (await importRows()) === base0);
  const c1 = await api("POST", "/ops/imports", sup, body7);
  ok("Confirm writes it: 201, one row", c1.status === 201 && (await importRows()) === base0 + 1, c1.status);
  const [row] = await q(`SELECT created_by, created_by_name, shape, report_date, file_name FROM ops_imports WHERE created_by = 'u_li1_super'`).catch(() => [null]);
  ok("the row is stamped with the super-admin who uploaded it", row && row.created_by === "u_li1_super" && row.created_by_name && row.shape === "lead" && row.report_date === "2026-11-07" && row.file_name === L7, row);
  let ops = await api("GET", "/ops", sup);
  const items = boardItems(ops);
  const got = want.map(w => items.find(i => i.id === w[0]));
  ok("GET /ops: every item on the board, open, with its tier", got.every((it, n) => it && it.state === "open" && it.tier === want[n][1] && it.seen === want[n][2]), got);
  const order = (((ops.body || {}).board || {}).builds || []).find(g => !g.build);
  ok("…sorted the lead's way (tier, then repeats above new)", order && JSON.stringify(order.items.filter(i => i.tier).map(i => i.id)) === JSON.stringify(want.map(w => w[0])), order && order.items.map(i => i.id));
  const m = (ops.body || {}).morning;
  ok("This morning: the date, the counts by tier and the top five",
    m && m.date === "2026-11-07" && JSON.stringify(m.tiers) === JSON.stringify({ 1: 2, 2: 2, 3: 1, 4: 1, 5: 1 }) && m.top.length === 5
    && JSON.stringify(m.top.map(t => t.id)) === JSON.stringify(want.slice(0, 5).map(w => w[0])), m);

  console.log("\n§3 · importing the same file again changes nothing");
  const before = JSON.stringify((ops.body || {}).board);
  const again = await api("POST", "/ops/imports/preview", sup, body7);
  ok("the preview says it was already imported, and would change nothing", again.status === 200 && again.body.duplicate && again.body.changes.added.length === 0, again.body && again.body.duplicate);
  const c2 = await api("POST", "/ops/imports", sup, { ...body7, text: body7.text.replace(/\n/g, "\r\n"), fileName: "lead-2026-11-07 (1).md" });
  ok("re-import (another name, CRLF line ends) answers unchanged and writes no row", c2.status === 200 && c2.body.unchanged === true && (await importRows()) === base0 + 1, [c2.status, c2.body && c2.body.unchanged]);
  ops = await api("GET", "/ops", sup);
  ok("…and the board is exactly as it was", JSON.stringify((ops.body || {}).board) === before);

  console.log("\n§4 · a REPEAT of a fixed item reopens it");
  if (IMPORTS) {
    const rows = [{ seq: 1, report_date: "2026-11-07", file_name: L7, body: read(L7), sha256: "a" }, { seq: 2, report_date: "2026-11-08", file_name: L8, body: read(L8), sha256: "b" }];
    const base = { version: 1, items: [], walks: [] };
    const fixedBase = { ...base, closed: [{ id: "W-1107-Finance-3", build: "MONEY-9", on: "2026-11-07" }] };
    const only7 = IMPORTS.deriveBoard(fixedBase, rows.slice(0, 1)).items.find(i => i.id === "W-1107-Finance-3");
    ok("a build's close (board.json `closed`) makes the uploaded item fixed", only7 && only7.state === "fixed" && only7.fixedBy === "MONEY-9", only7);
    const b = IMPORTS.deriveBoard(fixedBase, rows);
    const f3 = b.items.find(i => i.id === "W-1107-Finance-3"), d12 = b.items.find(i => i.id === "W-1107-Donors-12"), a7 = b.items.find(i => i.id === "W-1107-Atlas-7");
    ok("the next morning's REPEAT reopens it, with the new words", f3 && f3.state === "reopened" && /still \$40 short/.test(f3.words) && f3.seen === "REPEAT", f3);
    ok("a REPEAT of an item still open stays one item, open", a7 && a7.state === "open" && b.items.filter(i => i.check === "Atlas-7").length === 1, a7);
    ok("a 'passing again' line verifies its item", d12 && d12.state === "verified", d12);
    const unfixed = IMPORTS.deriveBoard(base, rows).items.find(i => i.id === "W-1107-Finance-3");
    ok("…while the same REPEAT of an item never fixed leaves it open", unfixed && unfixed.state === "open", unfixed);
    const BOARD = require("../server/admin/board");
    const cl = BOARD.closeItems(base, ["W-1107-Finance-3"], { build: "MONEY-9", date: "2026-11-07" });
    ok("board.js close records a close for an item that lives only in an upload", cl.recorded && cl.recorded[0] === "W-1107-Finance-3" && cl.board.closed.length === 1 && cl.missing.length === 0, cl);
  } else ok("deriveBoard exists (RED ON MAIN)", false);
  const p8 = await api("POST", "/ops/imports/preview", sup, { fileName: L8, text: read(L8) });
  ok("the next morning's preview: Donors-12 verified, Finance-3 still open", p8.status === 200 && p8.body.changes.verified.includes("W-1107-Donors-12") && p8.body.changes.stillOpen.includes("W-1107-Finance-3"), p8.body && p8.body.changes);

  console.log("\n§5 · an unknown line is listed in the preview");
  const un = pvb.unread || [];
  ok("a fail from an area the fleet does not walk is listed, with why", un.some(u => u.line === 24 && /Gardening/.test(u.text) && /not one of the fleet's areas/.test(u.why)), un);
  ok("a line with no fail ID is listed", un.some(u => u.line === 25 && /could not run/.test(u.text)), un);
  const notier = await api("POST", "/ops/imports/preview", sup, { fileName: "lead-2026-11-09.md", text: "# lead 2026-11-09\n\n- W-1109-Donors-3 · NEW · a fail under no tier\n## Tier 2\n- W-1109-Finance-1 · NEW · a silent change\n" });
  ok("a fail with no tier is listed, not guessed", notier.status === 200 && notier.body.unread.some(u => /no tier/.test(u.why)) && notier.body.items.length === 1, notier.body);
  const junk = await api("POST", "/ops/imports/preview", sup, { fileName: "notes.md", text: "# 2026-11-09\nnothing here\n" });
  ok("a file with nothing to read is refused, with its lines", junk.status === 400 && junk.body.error === "no_lines" && junk.body.unread.length === 1, junk.body);
  const txt = await api("POST", "/ops/imports/preview", sup, { fileName: "lead-2026-11-07.txt", text: read(L7) });
  ok("only a .md file is read", txt.status === 400 && txt.body.error === "not_md", txt.body);

  await reset();
  summary();
  await closeDb();
})().catch(async e => { console.error(e); await reset().catch(() => {}); process.exit(1); });

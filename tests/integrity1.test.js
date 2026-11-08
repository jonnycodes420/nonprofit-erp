// tests/integrity1.test.js: INTEGRITY-1. NOBODY VANISHES, EVERY COUNT IS THE
// SAME COUNT, ONE EMAIL BELONGS TO ONE PERSON. Guards donor data. Every name,
// file and address here is made up.
//
//   §1 W-1107-Finance-35: a donor who was here before an import is never
//      trashed by that import's undo, even when she was brought back from the
//      trash for ANOTHER file, and even with two imports and two undos at once.
//      The invariant: an import's undo removes only what that import created
//      or restored from the trash. And scripts/ops/integrity1-find-vanished.js
//      lists, restores (one audit row) and reverses.
//   §2 W-1107-Prod-04: Everyone is active person records (not trashed, erased
//      or archived; never a user) on every surface that says it.
//   §3 W-1107-Donors-11: Owner = Mike returns rows whose Owner says Mike, and
//      the portfolio bar agrees, after the user is renamed.
//   §5 duplicates: a household is one line in LYBUNT/SYBUNT; Data health flags
//      a person and household with identical gifts and one email on two
//      people; saving a duplicate email warns; one pending invite per address
//      (the index, and the script); meeting staff are named from users by id.
//   §4 W-1107-Donors-13: "Gives monthly" through the actual filter control in
//      a browser narrows the list to the monthly givers.
//   §6 W-1107-Donors-22X: Current through a household says so, by name.
"use strict";
const bcrypt = require("bcryptjs");
const path = require("path");
const { execFileSync } = require("child_process");
const fs = require("fs");
const { ok, summary, login, api, q, closeDb, civilPlusDays, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");
const { undoAndWait } = require("./lib/undoWait");

const BASE = process.env.BASE || "http://localhost:5601";
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const PASSWORD = "integrityone12345";
const TODAY = "2026-11-07";
const SUITE_DEADLINE_MS = 300000;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const INVITE_SCRIPT = path.join(__dirname, "..", "scripts", "ops", "integrity1-duplicate-invites.js");
const SCRIPT = path.join(__dirname, "..", "scripts", "ops", "integrity1-find-vanished.js");
const FIRST = ["Alder", "Briar", "Cedar", "Dahlia", "Elm", "Fern", "Garnet", "Hazel", "Iris", "Juniper"];
const LAST = ["Quarry", "Rook", "Sable", "Thistle", "Umber", "Vale", "Wick", "Yarrow", "Zephyr", "Moss",
              "Lumen", "Kestrel", "Juno", "Ivory", "Heron", "Gale", "Flint", "Ember", "Dune", "Cobalt"];

const one = async (sql, args) => (await q(sql, args))[0];
async function freshOrg(id, name, priors = 17) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Tester','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  for (let i = 0; i < priors; i++) await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ($1,$2,$3,$4,'system:test','Test')`,
    [`d_${id.slice(4)}_${i}`, id, `Prior Person ${i}`, `prior${i}@${id}.test`]);
  return login(email, PASSWORD);
}
async function importJob(tok, body) {
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status !== 202) return { start: r, end: null, importId: null };
  const t0 = performance.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { start: r, end: j.body, importId: r.body.importId };
    if (performance.now() - t0 > 150000) return { start: r, end: { status: "timeout" }, importId: r.body.importId };
    await new Promise(z => setTimeout(z, 300));
  }
}
// people × gifts rows, year-first dates, one email each; `extra` rows go on the end
function giftFile(people, giftsEach, tag, extra = []) {
  const grid = [["Name", "Email", "Gift Date", "Amount"]];
  for (let p = 0; p < people; p++) {
    const name = `${FIRST[p % 10]} ${LAST[Math.floor(p / 10) % 20]}`;
    for (let g = 0; g < giftsEach; g++) grid.push([name, `${tag}${p}@example.test`, `2025-${String(1 + g * 2).padStart(2, "0")}-1${g}`, String(25 + g * 5)]);
  }
  for (const r of extra) grid.push(r);
  return [{ name: "Gifts", grid }];
}
const liveIds = async org => new Set((await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [org])).map(r => r.id));
const vanishedFrom = async (org, before) => { const now = await liveIds(org); return [...before].filter(id => !now.has(id)); };
const script = (...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status == null ? 1 : e.status, out: String(e.stdout || "") + String(e.stderr || e.message || "") }; }
};

// The donor who vanished on 7 Nov, as a made-up fixture: $11,700 over three gifts.
async function addLongtimeDonor(org) {
  const id = `d_${org.slice(4)}_odessa`;
  await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ($1,$2,'Odessa Marchbanks','odessa.marchbanks@example.test','system:test','Test')`, [id, org]);
  for (const [k, amt, d] of [[1, 5000, "2023-03-14"], [2, 4200, "2024-05-02"], [3, 2500, "2025-06-20"]]) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','Test')`, [`g_${id}_${k}`, org, id, amt, d]);
  }
  return id;
}
const ODESSA_ROW = ["Odessa Marchbanks", "odessa.marchbanks@example.test", "2025-09-09", "100"];

(async () => {
  const deadline = setTimeout(() => { console.error(`integrity1: the suite passed its ${SUITE_DEADLINE_MS / 1000} s deadline`); process.exit(1); }, SUITE_DEADLINE_MS);

  // ── §1 W-1107-Finance-35: nobody who was here before an import vanishes by its undo
  {
    const ORG = "org_integrity1_vanish";
    const tok = await freshOrg(ORG, "Integrity One Vanish");
    const odessa = await addLongtimeDonor(ORG);
    // She is deleted by hand, a small file (A) names her, and "Bring them all
    // back" is pressed for A. File A is never imported: she is simply live
    // again, and in use, from here on.
    const rm = await api("POST", "/donors/bulk-delete", tok, { ids: [odessa], count: 1 });
    const fileA = giftFile(2, 1, "small", [ODESSA_ROW]);
    const uA = await api("POST", "/sheet-import/understand", tok, { fileName: "small.csv", sheets: fileA, useModel: false, today: TODAY });
    const bA = await api("POST", "/sheet-import/bring-back", tok, { ids: [odessa], fileKey: uA.body.fileKey });
    const before = await liveIds(ORG);
    ok("§1 setup: Odessa ($11,700) was deleted by hand, brought back for file A, and is live before the next import",
      rm.status === 200 && uA.status === 200 && bA.status === 200 && bA.body.restored === 1 && before.has(odessa), { rm: rm.status, uA: uA.status, bA: bA.body });
    // Two other files that also name her, imported at the same time, then both undone at the same time.
    const fileB = giftFile(200, 5, "bee", [ODESSA_ROW]);         // the 1,000-row file
    const fileC = giftFile(30, 2, "sea", [ODESSA_ROW]);
    const [jB, jC] = await Promise.all([
      importJob(tok, { fileName: "big.csv", sheets: fileB, useModel: false, previewOrgId: ORG, today: TODAY }),
      importJob(tok, { fileName: "other.csv", sheets: fileC, useModel: false, previewOrgId: ORG, today: TODAY })]);
    const claimed = (await q(`SELECT summary_json FROM imports WHERE id = ANY($1)`, [[jB.importId, jC.importId]]))
      .flatMap(r => ((typeof r.summary_json === "string" ? JSON.parse(r.summary_json) : r.summary_json) || {}).restoredFromTrash || []);
    const [uB, uC] = await Promise.all([undoAndWait(BASE, tok, jB.importId, { timeoutMs: 90000, pollMs: 100 }),
                                        undoAndWait(BASE, tok, jC.importId, { timeoutMs: 90000, pollMs: 100 })]);
    const gone1 = await vanishedFrom(ORG, before);
    ok("§1 two imports that name her, run at once, claim nobody they did not bring back (main: one of them claims Odessa)",
      jB.end && jB.end.status === "done" && jC.end && jC.end.status === "done" && claimed.length === 0, { b: jB.end && jB.end.status, c: jC.end && jC.end.status, claimed });
    ok("§1 the invariant: after both undos, everyone live before the imports is still live, Odessa included (main: Odessa is in the trash)",
      uB.status === 200 && uC.status === 200 && gone1.length === 0, { uB: uB.status, uC: uC.status, gone: gone1.length, odessaGone: gone1.includes(odessa) });
    // Re-import the big file and undo it again, while file C is imported beside it.
    const [jB2, jC2] = await Promise.all([
      importJob(tok, { fileName: "big.csv", sheets: fileB, useModel: false, previewOrgId: ORG, today: TODAY }),
      importJob(tok, { fileName: "other.csv", sheets: fileC, useModel: false, previewOrgId: ORG, today: TODAY })]);
    const uB2 = await undoAndWait(BASE, tok, jB2.importId, { timeoutMs: 90000, pollMs: 100 });
    const gone2 = await vanishedFrom(ORG, before);
    const [od] = await q(`SELECT deleted_at, (SELECT COALESCE(SUM(amount),0)::numeric FROM gifts g WHERE g.donor_id=d.id AND g.import_id IS NULL) AS own FROM donors d WHERE d.id=$1`, [odessa]);
    ok("§1 re-import, undo again beside a second import: still nobody from before is gone, and Odessa keeps her $11,700",
      jB2.end && jB2.end.status === "done" && jC2.end && jC2.end.status === "done" && uB2.status === 200 && gone2.length === 0 && od.deleted_at === null && Number(od.own) === 11700,
      { b2: jB2.end && jB2.end.status, c2: jC2.end && jC2.end.status, uB2: uB2.status, gone: gone2.length, od });
    // Pressed for the file that is then imported, Bring them back is still undone (IMPORT-9 holds).
    await api("POST", "/donors/bulk-delete", tok, { ids: [odessa], count: 1 });
    const uA2 = await api("POST", "/sheet-import/understand", tok, { fileName: "small.csv", sheets: fileA, useModel: false, today: TODAY });
    await api("POST", "/sheet-import/bring-back", tok, { ids: [odessa], fileKey: uA2.body.fileKey });
    const jA = await importJob(tok, { fileName: "small.csv", sheets: fileA, useModel: false, previewOrgId: ORG, today: TODAY });
    const uAu = await undoAndWait(BASE, tok, jA.importId, { timeoutMs: 60000, pollMs: 100 });
    ok("§1 brought back for file A and A imported: A's undo puts her back in the trash, as it said it would",
      jA.end && jA.end.status === "done" && uAu.status === 200 && uAu.body.backToTrash === 1
        && (await one(`SELECT deleted_at FROM donors WHERE id=$1`, [odessa])).deleted_at !== null, { a: jA.end && jA.end.status, undo: uAu.body && uAu.body.sentence });
  }

  // ── §1b the cleanup script, on an org a pre-INTEGRITY-1 undo left like 7 Nov
  {
    const ORG = "org_integrity1_found";
    const tok = await freshOrg(ORG, "Integrity One Found");
    const odessa = await addLongtimeDonor(ORG);
    const fileB = giftFile(10, 1, "bee", [ODESSA_ROW]);
    const jB = await importJob(tok, { fileName: "big.csv", sheets: fileB, useModel: false, previewOrgId: ORG, today: TODAY });
    // what the old code left: a bring-back with no file, pressed an hour
    // before by somebody else, claimed by B, and B's undo trashed her
    await q(`INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name, created_at, restored_at)
             VALUES ('del_i1_old', $1, 'donors', $2, $3::jsonb, 'u_other', 'Another', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour')`,
      [ORG, odessa, JSON.stringify({ __soft: true, __bringBack: { at: new Date(Date.parse(TODAY + "T15:00:00Z")).toISOString(), by: "u_other", importId: jB.importId } })]);
    await q(`UPDATE deleted_records SET row_data = jsonb_set(row_data, '{__bringBack,at}', to_jsonb((NOW() - INTERVAL '1 hour')::text)) WHERE id='del_i1_old'`);
    await q(`UPDATE donors SET deleted_at = NOW() WHERE id=$1`, [odessa]);
    await q(`INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name)
             VALUES ('del_i1_undo', $1, 'donors', $2, $3::jsonb, 'u_${ORG}', 'Wren Tester')`, [ORG, odessa, JSON.stringify({ __soft: true, __importUndo: jB.importId })]);
    const dry = script(`--org=${ORG}`);
    ok("§1b the dry run lists the org and its one vanished person, by org id and count only, and writes nothing",
      dry.code === 0 && /DRY RUN/.test(dry.out) && new RegExp(`${ORG}: 1\\b`).test(dry.out) && !/Odessa|Marchbanks|@example/.test(dry.out)
        && (await one(`SELECT deleted_at FROM donors WHERE id=$1`, [odessa])).deleted_at !== null, dry.out.slice(0, 300));
    const app = script(`--org=${ORG}`, "--apply");
    const audits = await q(`SELECT id, record_count FROM fin_audit_log WHERE org_id=$1 AND user_id='system:scripts/ops/integrity1-find-vanished' AND action='bring back'`, [ORG]);
    ok("§1b --apply brings her back with one audit row for the org, and closes the undo's trash row",
      app.code === 0 && audits.length === 1 && Number(audits[0].record_count) === 1 && (await one(`SELECT deleted_at FROM donors WHERE id=$1`, [odessa])).deleted_at === null
        && (await one(`SELECT restored_at FROM deleted_records WHERE id='del_i1_undo'`)).restored_at !== null, { out: app.out.slice(0, 300), audits });
    const again = script(`--org=${ORG}`, "--apply");
    ok("§1b a second run changes nothing", again.code === 0 && !new RegExp(`${ORG}:`).test(again.out)
      && (await q(`SELECT id FROM fin_audit_log WHERE org_id=$1 AND user_id='system:scripts/ops/integrity1-find-vanished'`, [ORG])).length === 1, again.out.slice(0, 300));
    const un = audits[0] ? script(`--undo=${audits[0].id}`) : { code: 1, out: "no audit row" };
    const un2 = audits[0] ? script(`--undo=${audits[0].id}`) : { code: 1, out: "no audit row" };
    ok("§1b --undo=<audit id> puts her back in the trash, and a second --undo changes nothing",
      un.code === 0 && (await one(`SELECT deleted_at FROM donors WHERE id=$1`, [odessa])).deleted_at !== null && un2.code === 0 && /: 0 put back/.test(un2.out),
      { un: un.out, un2: un2.out });
    void tok;
  }

  // ── §2 W-1107-Prod-04: Everyone is one definition on every surface
  {
    const ORG = "org_integrity1_everyone";
    const tok = await freshOrg(ORG, "Integrity One Everyone", 3);   // three live donors
    const add = (id, name, extra = "") => q(`INSERT INTO donors (id, org_id, name, created_by, created_by_name${extra ? ", " + extra.split("=")[0] : ""}) VALUES ($1,$2,$3,'system:test','Test'${extra ? ", " + extra.split("=")[1] : ""})`, [id, ORG, name]);
    await add("d_i1e_contact", "Corin Vale", `person_types='["volunteer"]'::jsonb`);
    await add("d_i1e_archived", "Arden Moss", "archived_at=NOW()");
    await add("d_i1e_erased", "Erased person", "erased_at=NOW()");
    await add("d_i1e_trashed", "Tamsin Rook", "deleted_at=NOW()");
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_i1e_staff',$1,'staff@integrity1.test','x','Sable Staff','staff')`, [ORG]);
    const key = 4;   // by hand: three donors and one contact; not the archived, the erased, the trashed or the user
    const dir = (await api("GET", "/donors?roleCounts=1&role=&limit=1", tok)).body || {};
    const rc = dir.roleCounts || {};
    const sumRes = await fetch(`${BASE}/donors/summaries?limit=1`, { headers: { Authorization: "Bearer " + tok } });
    const summaries = Number(sumRes.headers.get("x-total-count"));
    ok("§2 Everyone = 4 on the Directory tabs, its list, and the people total of /donors/summaries; Donors + Contacts = Everyone (main: the summaries total counts the archived and the erased, 6)",
      rc.everyone === key && rc.donors + rc.contacts === key && rc.contacts === 1 && Number(dir.total) === key && summaries === key,
      { rc, total: dir.total, summaries });
  }

  // ── §3 W-1107-Donors-11: one owner field
  {
    const ORG = "org_integrity1_owner";
    const tok = await freshOrg(ORG, "Integrity One Owner", 0);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_i1o_mike',$1,'mike@integrity1.test','x','Admin User','admin')`, [ORG]);
    for (const [i, n] of ["Bram Heron", "Cleo Dune", "Dara Flint"].entries()) {
      await q(`INSERT INTO donors (id, org_id, name, stage, assigned_to, assigned_to_name, created_by, created_by_name) VALUES ($1,$2,$3,'cultivation',$4,$5,'system:test','Test')`,
        [`d_i1o_${i}`, ORG, n, i < 2 ? "u_i1o_mike" : `u_${ORG}`, i < 2 ? "Admin User" : "Wren Tester"]);
    }
    await q(`UPDATE users SET name='Mike Halloran' WHERE id='u_i1o_mike'`);   // renamed since they were assigned
    const r = (await api("GET", "/donors?assignedTo=u_i1o_mike&role=&cols=owner&limit=50", tok)).body || {};
    const rows = r.donors || [];
    const bar = ((await api("GET", "/portfolio/officers", tok)).body || {});
    const officers = bar.officers || bar.rows || (Array.isArray(bar) ? bar : []);
    const mikeBar = officers.find(o => o.id === "u_i1o_mike" || o.user_id === "u_i1o_mike");
    ok("§3 Owner = Mike gives his two people, each row's Owner says Mike Halloran (column and cell), and the portfolio bar names him the same (main: \"Admin User\")",
      rows.length === 2 && rows.every(d => d.owner_label === "Mike Halloran" && d.assigned_to_name === "Mike Halloran" && (!d.cells || d.cells.owner === "Mike Halloran"))
        && !!mikeBar && /Mike Halloran/.test(JSON.stringify(mikeBar)),
      { rows: rows.map(d => [d.name, d.owner_label, d.cells && d.cells.owner]), mikeBar });
  }

  // ── §5 duplicates and shared emails
  {
    const ORG = "org_integrity1_dupes";
    const tok = await freshOrg(ORG, "Integrity One Dupes", 0);
    const Y = Number(civilPlusDays(0).slice(0, 4));
    await q(`INSERT INTO households (id, org_id, name) VALUES ('hh_i1_ash', $1, 'The Ashworth Household')`, [ORG]);
    for (const [id, name] of [["d_i1d_pru", "Prunella Ashworth"], ["d_i1d_hp", "Hollis and Prunella Ashworth"]]) {
      await q(`INSERT INTO donors (id, org_id, name, household_id, created_by, created_by_name) VALUES ($1,$2,$3,'hh_i1_ash','system:test','Test')`, [id, ORG, name]);
      for (const [k, d, a] of [[1, `${Y - 1}-03-15`, 250], [2, `${Y - 1}-09-01`, 500]])
        await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','Test')`, [`g_${id}_${k}`, ORG, id, a, d]);
    }
    await q(`INSERT INTO donors (id, org_id, name, created_by, created_by_name) VALUES ('d_i1d_solo',$1,'Linnea Gale','system:test','Test')`, [ORG]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_i1d_solo',$1,'d_i1d_solo',100,$2,'system:test','Test')`, [ORG, `${Y - 1}-05-05`]);
    const ly = (await api("GET", `/reports/lybunt?year=${Y}&yearMode=calendar`, tok)).body || {};
    const units = ly.units || [];
    const hh = units.find(u => u.members && u.members.length === 2);
    const foot = units.reduce((n, u) => n + Math.round(u.priorYearTotal * 100), 0);
    ok("§5 LYBUNT lists the Ashworth household once (2 lines: the household, Linnea), its people kept for the count, and the lines foot to the header (main: 3 lines)",
      (ly.rows || []).length === 3 && units.length === 2 && !!hh && hh.name === "The Ashworth Household" && hh.unit === "household"
        && foot === Math.round(Number(ly.figures && ly.figures.atStake && ly.figures.atStake.value) * 100),
      { rows: (ly.rows || []).length, units: units.map(u => [u.name, u.unit, u.priorYearTotal]), atStake: ly.figures && ly.figures.atStake && ly.figures.atStake.value });
    const sy = (await api("GET", `/reports/sybunt?year=${Y + 1}&yearMode=calendar`, tok)).body || {};
    ok("§5 SYBUNT the same way: the household is one line", (sy.units || []).filter(u => u.members).length === 1 && (sy.units || []).length === (sy.rows || []).length - 1,
      { rows: (sy.rows || []).length, units: (sy.units || []).map(u => u.name) });
    const ig = (await api("GET", "/data-health/identical-gifts", tok));
    const igRows = (ig.body && ig.body.rows) || [];
    ok("§5 Data health flags the person and household pair whose gifts are identical, and not Linnea (main: no such check, 404)",
      ig.status === 200 && igRows.length === 1 && [igRows[0].a, igRows[0].b].sort().join() === "d_i1d_hp,d_i1d_pru", { status: ig.status, rows: igRows });
    // one email, two people
    const a = await api("POST", "/donors", tok, { name: "Isolde Wick", email: "isolde.wick@example.test" });
    const b = await api("POST", "/donors", tok, { name: "Orrin Wick", email: "Isolde.Wick@example.test " });
    const health = (await api("GET", "/data-health", tok)).body || {};
    const hc = health.counts || health;
    const se = ((await api("GET", "/data-health/shared-emails", tok)).body || {}).rows || [];
    ok("§5 saving a second person with an email another person has answers with a warning naming them, and Data health lists the address (main: silent)",
      a.status === 201 && !a.body.warning && b.status === 201 && b.body.warning && /isolde\.wick@example\.test is also on Isolde Wick/.test(b.body.warning.sentence)
        && Number(hc.sharedEmails) === 1 && se.length === 1 && se[0].people.length === 2,
      { a: [a.status, a.body.warning], b: [b.status, b.body.warning], count: hc.sharedEmails, se });
    const edit = await api("PATCH", `/donors/${b.body.id}/contact`, tok, { email: "orrin.wick@example.test" });
    ok("§5 changing it to his own email clears it", edit.status === 200 && !edit.body.warning
      && ((((await api("GET", "/data-health/shared-emails", tok)).body || {}).rows) || []).length === 0, { edit: [edit.status, edit.body] });
    // meeting staff from users, by id
    await q(`UPDATE users SET name='Wren Tesseract' WHERE id=$1`, ["u_" + ORG]);
    await q(`INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name) VALUES ('ix_i1_meet',$1,'d_i1d_solo','meeting','Coffee.',$2,$3,'Wren')`, [ORG, civilPlusDays(-3), "u_" + ORG]);
    const mt = (await api("GET", `/figures/meetings/rows?from=${civilPlusDays(-30)}&to=${civilPlusDays(0)}`, tok)).body || {};
    const mrows = mt.rows || [];
    ok("§5 a logged meeting names its staff from the user record (Wren Tesseract), never the text typed when it was logged (main: \"Wren\")",
      mrows.length === 1 && /^Wren Tesseract · logged/.test(mrows[0].detail || ""), mrows.map(r => r.detail));
  }

  // ── §5 one pending invite per address
  {
    const ORG = "org_integrity1_invites";
    const tok = await freshOrg(ORG, "Integrity One Invites", 0);
    const idx = await one(`SELECT i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = 'invites_one_pending_per_email'`);
    let blocked = null;
    try {
      await q(`INSERT INTO invites (id, org_id, email, token, role, invited_by, expires_at) VALUES ('inv_i1_a',$1,'pip@integrity1.test','tok_i1_a','staff',$2,NOW() + INTERVAL '7 days')`, [ORG, "u_" + ORG]);
      await q(`INSERT INTO invites (id, org_id, email, token, role, invited_by, expires_at) VALUES ('inv_i1_b',$1,'PIP@integrity1.test','tok_i1_b','staff',$2,NOW() + INTERVAL '7 days')`, [ORG, "u_" + ORG]);
      blocked = false;
    } catch (e) { blocked = e.code === "23505"; }
    ok("§5 the unique index on (org, lower(email)) for pending invites is built and refuses a second pending invite to one address (main: no index, both written)",
      !!idx && idx.indisvalid === true && blocked === true, { idx, blocked });
    const two = await Promise.all([1, 2].map(() => api("POST", "/auth/invite", tok, { email: "quill@integrity1.test", role: "staff" })));
    const pending = (await one(`SELECT COUNT(*)::int n FROM invites WHERE org_id=$1 AND lower(email)='quill@integrity1.test' AND accepted_at IS NULL AND revoked_at IS NULL`, [ORG])).n;
    ok("§5 two presses of Invite at once leave one pending invite; the other is told it is waiting", pending === 1 && two.some(r => r.status === 409), { statuses: two.map(r => r.status), pending });

    // the cleanup for addresses that already repeat (from before the index): drop the index, plant two, run the script
    await q(`DROP INDEX IF EXISTS invites_one_pending_per_email`);
    await q(`INSERT INTO invites (id, org_id, email, token, role, invited_by, expires_at, created_at) VALUES
             ('inv_i1_old',$1,'rue@integrity1.test','tok_i1_old','staff',$2,NOW() - INTERVAL '1 day', NOW() - INTERVAL '8 days'),
             ('inv_i1_new',$1,'Rue@integrity1.test','tok_i1_new','staff',$2,NOW() + INTERVAL '6 days', NOW() - INTERVAL '1 day')`, [ORG, "u_" + ORG]);
    const run = (...args) => {
      try { return { code: 0, out: execFileSync(process.execPath, [INVITE_SCRIPT, ...args], { env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
      catch (e) { return { code: e.status == null ? 1 : e.status, out: String(e.stdout || "") + String(e.stderr || e.message || "") }; }
    };
    const dry = run(`--org=${ORG}`);
    const app = run(`--org=${ORG}`, "--apply");
    const st = async id => (await one(`SELECT revoked_at FROM invites WHERE id=$1`, [id])).revoked_at;
    const [{ id: auditId } = {}] = await q(`SELECT id FROM fin_audit_log WHERE org_id=$1 AND user_id='system:scripts/ops/integrity1-duplicate-invites' AND action='revoke invite'`, [ORG]);
    const again = run(`--org=${ORG}`, "--apply");
    ok("§5 the invite script: the dry run counts the org's one repeat (no address printed) and writes nothing; --apply revokes all but the newest, one audit row; a second run changes nothing",
      dry.code === 0 && new RegExp(`${ORG}: 1\\b`).test(dry.out) && !/rue@/i.test(dry.out) && app.code === 0 && (await st("inv_i1_old")) !== null && (await st("inv_i1_new")) === null
        && !!auditId && again.code === 0 && !new RegExp(`${ORG}:`).test(again.out), { dry: dry.out.slice(0, 200), app: app.out.slice(0, 200), again: again.out.slice(0, 200) });
    await q(`UPDATE invites SET revoked_at = NOW() WHERE id='inv_i1_new'`);
    const un = auditId ? run(`--undo=${auditId}`) : { code: 1, out: "" };
    ok("§5 --undo=<audit id> restores the revoked invite while no other invite to that address is pending", un.code === 0 && (await st("inv_i1_old")) === null, un.out);
    // put the index back as the boot built it (only where it was built: on main there is none)
    await q(`UPDATE invites SET revoked_at = NOW() WHERE org_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL`, [ORG]);
    if (idx) await q(`CREATE UNIQUE INDEX IF NOT EXISTS invites_one_pending_per_email ON invites (org_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL`);
  }

  // ── §4 W-1107-Donors-13: "Gives monthly" through the filter control, in a browser
  {
    const ORG = "org_integrity1_monthly";
    const tok = await freshOrg(ORG, "Integrity One Monthly", 0);
    const names = ["Ansel Brook", "Briony Cask", "Caspian Dell", "Delphine Eyre", "Emrys Fold", "Florian Gate", "Ginevra Holt", "Hartley Isle"];
    for (const [i, n] of names.entries()) {
      const id = `d_i1m_${i}`;
      await q(`INSERT INTO donors (id, org_id, name, created_by, created_by_name) VALUES ($1,$2,$3,'system:test','Test')`, [id, ORG, n]);
      // the first two give every month (8 months, 30 days apart); the rest gave twice this year
      const days = i < 2 ? [...Array(8).keys()].map(k => civilPlusDays(-10 - 30 * k)) : [civilPlusDays(-20), civilPlusDays(-200)];
      for (const [k, d] of days.entries()) await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,25,$4,'system:test','Test')`, [`g_${id}_${k}`, ORG, id, d]);
    }
    const viaApi = (await api("GET", `/donors?role=&limit=50&where=${encodeURIComponent(JSON.stringify({ join: "and", conditions: [{ field: "monthly", op: "yes" }] }))}`, tok)).body || {};
    ok("§4 the server's rule: Gives monthly is the two month-apart givers", Number(viaApi.total) === 2, { total: viaApi.total });
    const why = (() => {
      if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
      const apiHost = BASE.replace(/^https?:\/\//, "");
      const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
      if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
      try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
      return null;
    })();
    if (!browserLegOrSkip(why, "§4 (browser leg)")) {
      const lg = await api("POST", "/auth/login", null, { email: `${ORG}@test.local`, password: PASSWORD });
      const { chromium } = require(PW);
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
        await ctx.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
          [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
        const page = await ctx.newPage();
        const sent = [];
        page.on("request", r => { if (/\/donors\?/.test(r.url())) sent.push(r.url()); });
        await page.goto(`${APP}/donors?people=everyone`, { waitUntil: "networkidle", timeout: 60000 });
        await page.locator('[data-testid="dir-add-filter"]').click();
        await page.locator('[data-testid="filter-field-search"]').fill("monthly");
        await page.locator('[data-testid="filter-field-monthly"]').click();
        const opNow = await page.locator('[data-testid="filter-op"]').inputValue().catch(() => null);
        await page.locator('[data-testid="filter-apply"]').click();
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(500);
        const body = await page.locator("body").innerText();
        const m = body.match(/([\d,]+) (?:people match|person matches)/);
        const shown = names.filter(n => body.includes(n));
        const asked = sent.filter(u => /where=/.test(u)).pop() || "";
        ok("§4 in the browser, + Add filter, Gives monthly, Yes: the count says 2 people match and only the two monthly givers are listed",
          opNow === "yes" && !!m && Number(m[1]) === 2 && shown.length === 2 && shown.every(n => names.indexOf(n) < 2) && /monthly/.test(decodeURIComponent(asked)),
          { op: opNow, count: m && m[1], shown, asked: decodeURIComponent(asked).slice(-160) });
      } finally { await browser.close(); }
    }
  }

  // ── §6 W-1107-Donors-22X: Current through a household or a gives-through link says so
  {
    const ORG = "org_integrity1_current";
    const tok = await freshOrg(ORG, "Integrity One Current", 0);
    const old = civilPlusDays(-500), recent = civilPlusDays(-40);
    await q(`INSERT INTO donors (id, org_id, name, last_gift_date, created_by, created_by_name) VALUES ('d_i1c_ida',$1,'Ida Fennick',$2,'system:test','Test'),
             ('d_i1c_trust',$1,'Fennick Charitable Trust',$3,'system:test','Test'), ('d_i1c_own',$1,'Otto Brisk',$3,'system:test','Test')`, [ORG, old, recent]);
    await q(`UPDATE donors SET kind='organization' WHERE id='d_i1c_trust'`);
    for (const [id, d, a] of [["d_i1c_ida", old, 80], ["d_i1c_trust", recent, 900], ["d_i1c_own", old, 50], ["d_i1c_own", recent, 60]])
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','Test')`, [`g_${id}_${d}`, ORG, id, a, d]);
    await q(`INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type) VALUES ('rel_i1c',$1,'d_i1c_ida','d_i1c_trust','owner')`, [ORG]);
    const st = (await api("GET", "/donors/d_i1c_ida/status", tok)).body || {};
    const cur = (st.tags || []).find(t => t.key === "current");
    const own = ((await api("GET", "/donors/d_i1c_own/status", tok)).body.tags || []).find(t => t.key === "current");
    ok("§6 Ida, Current only through the trust she gives through, is told so by name; her tooltip never says she gave (main: \"They gave in the last 12 months\")",
      !!cur && /^Current through Fennick Charitable Trust \(gives through\)\./.test(cur.sentence) && !/^They gave in the last 12 months/.test(cur.sentence)
        && !!own && /^They gave in the last 12 months/.test(own.sentence),
      { ida: cur, otto: own && own.sentence });
  }

  clearTimeout(deadline);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

// tests/import9.test.js: IMPORT-9. UNDO REALLY UNDOES, AND A MESSY FILE SAYS
// WHAT IT GUESSED. Guards donor data: Muse's Walk B (5 Nov) imported a
// 1,000-row file, undid it, imported it again, pressed "Bring them all back"
// for the 199 people in the trash, and undid again: the gifts went and all 199
// stayed live at $0 (Everyone 1,017 → 1,217, no safe way back). The same walk
// read "3/4/25" as March 4, mixed date formats and "$75.5" without a word.
// Every file and name here is made up.
//
//   §1 the walk's sequence on a 1,000-row file: import, undo, (notes keep 199;
//      "Remove them too" trashes them), re-import, Bring them all back, undo.
//      Everyone after the final undo equals Everyone before that import.
//   §2 scripts/ops/import9-undo-leftovers.js: the dry run lists an org a
//      pre-IMPORT-9 undo left behind (org id and count); --apply trashes them
//      once with one audit row; a second run changes nothing; --undo restores.
//   §3 a messy file stops at the date question, and the answer decides 3/4/25.
//   §4 the preview lists the amounts it tidied, and the rows a date column
//      wrote another way.
"use strict";
const bcrypt = require("bcryptjs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { undoAndWait } = require("./lib/undoWait");

const BASE = process.env.BASE || "http://localhost:5601";
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const PASSWORD = "importnine12345";
const TODAY = "2026-11-05";
const SUITE_DEADLINE_MS = 300000;
const SCRIPT = path.join(__dirname, "..", "scripts", "ops", "import9-undo-leftovers.js");
const FIRST = ["Alder", "Briar", "Cedar", "Dahlia", "Elm", "Fern", "Garnet", "Hazel", "Iris", "Juniper"];
const LAST = ["Quarry", "Rook", "Sable", "Thistle", "Umber", "Vale", "Wick", "Yarrow", "Zephyr", "Moss",
              "Lumen", "Kestrel", "Juno", "Ivory", "Heron", "Gale", "Flint", "Ember", "Dune", "Cobalt"];

const one = async (sql, args) => (await q(sql, args))[0];
async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Tester','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  for (let i = 0; i < 17; i++) await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ($1,$2,$3,$4,'system:test','Test')`,
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
// people × gifts rows, year-first dates (no date question), one email each
function giftFile(people, giftsEach, tag) {
  const grid = [["Name", "Email", "Gift Date", "Amount"]];
  for (let p = 0; p < people; p++) {
    const name = `${FIRST[p % 10]} ${LAST[Math.floor(p / 10) % 20]}`;
    for (let g = 0; g < giftsEach; g++) grid.push([name, `${tag}${p}@example.test`, `2025-${String(1 + g * 2).padStart(2, "0")}-1${g}`, String(25 + g * 5)]);
  }
  return [{ name: "Gifts", grid }];
}
async function everyone(tok) {
  const r = await api("GET", "/donors?roleCounts=1&people=everyone&limit=1", tok);
  return r.body && r.body.roleCounts ? r.body.roleCounts.everyone : null;
}
const live = async org => (await one(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [org])).n;
// import, notes keep `keep` people through the undo, "Remove them too" trashes them
async function trashedByAnEarlierRun(tok, org, sheets, keep) {
  const j = await importJob(tok, { fileName: "walk.csv", sheets, useModel: false, previewOrgId: org, today: TODAY });
  const made = await q(`SELECT id FROM donors WHERE org_id=$1 AND created_import_id=$2 ORDER BY email LIMIT $3`, [org, j.importId, keep]);
  for (const d of made) await q(`INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name) VALUES ($1,$2,$3,'note','Met at the walk.',$4,$5,'Wren Tester')`,
    [`ix_i9_${d.id}`, org, d.id, TODAY, "u_" + org]);
  const back = await undoAndWait(BASE, tok, j.importId, { timeoutMs: 60000, pollMs: 100 });
  await emptyTrash(tok);   // INTEGRITY-3: the undo put the rest in the trash; this walk's state had them gone
  const stayed = (back.body && back.body.stayed) || [];
  const rm = await api("POST", "/donors/bulk-delete", tok, { ids: stayed.map(x => x.id), count: stayed.length });
  return { job: j, undo: back, stayed: stayed.length, rm: rm.status };
}
// INTEGRITY-3: an undo puts the people its file created in the trash (it used to delete
// them outright). The walk was recorded when they were gone, so it empties the trash
// (Empty trash, the only way out) where the undo used to delete them.
const emptyTrash = tok => api("POST", "/donors/purge-trash", tok, { confirm: "empty", olderThanDays: null });
async function reimportWithBringBack(tok, org, sheets) {
  const u = await api("POST", "/sheet-import/understand", tok, { fileName: "walk.csv", sheets, useModel: false, today: TODAY });
  const ids = [...new Set([...(u.body.deletedMatches || []).map(x => x.id),
    ...(u.body.questions || []).filter(x => x.kind === "deletedPerson").map(x => x.deletedId)].filter(Boolean))];
  const bb = await api("POST", "/sheet-import/bring-back", tok, { ids, fileKey: u.body.fileKey });   // INTEGRITY-1: the file it is pressed for
  const j = await importJob(tok, { fileName: "walk.csv", sheets, useModel: false, previewOrgId: org, today: TODAY });
  return { matchedTrash: ids.length, bring: bb, job: j };
}
const script = (...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status == null ? 1 : e.status, out: String(e.stdout || "") + String(e.stderr || e.message || "") }; }
};

(async () => {
  const deadline = setTimeout(() => { console.error(`import9: the suite passed its ${SUITE_DEADLINE_MS / 1000} s deadline`); process.exit(1); }, SUITE_DEADLINE_MS);

  // ── §1 the walk: undo reverses everything the import did
  {
    const ORG = "org_import9_walk";
    const tok = await freshOrg(ORG, "Import Nine Walk");
    const sheets = giftFile(200, 5, "walk");
    const e0 = await everyone(tok);
    const j1 = await importJob(tok, { fileName: "walk.csv", sheets, useModel: false, previewOrgId: ORG, today: TODAY });
    const e1 = await everyone(tok);
    const u1 = await undoAndWait(BASE, tok, j1.importId, { timeoutMs: 60000, pollMs: 100 });
    const e2 = await everyone(tok);
    await emptyTrash(tok);
    ok("§1 a 1,000-row file imports 200 people and its undo takes them away (17 → 217 → 17)",
      j1.end && j1.end.status === "done" && e0 === 17 && e1 === 217 && u1.status === 200 && e2 === 17, { job: j1.end && j1.end.status, e0, e1, undo: u1.status, e2 });
    const t = await trashedByAnEarlierRun(tok, ORG, sheets, 199);
    const before = await everyone(tok);
    const trashed = (await one(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NOT NULL`, [ORG])).n;
    const r = await reimportWithBringBack(tok, ORG, sheets);
    const during = await everyone(tok);
    ok("§1 the re-import matches the 199 in the trash; Bring them all back says undo returns them to the trash",
      t.stayed === 199 && t.rm === 200 && before === 17 && trashed === 199 && r.matchedTrash === 199 && r.bring.status === 200 && r.bring.body.restored === 199
        && /199 people are back\./.test(r.bring.body.sentence) && /if you undo the import, they all go back to the trash/.test(r.bring.body.sentence)
        && r.job.end && r.job.end.status === "done" && during === 217,
      { stayed: t.stayed, rm: t.rm, before, trashed, matched: r.matchedTrash, bring: r.bring.body, job: r.job.end && r.job.end.status, during });
    const [imp] = await q(`SELECT summary_json FROM imports WHERE id=$1`, [r.job.importId]);
    const sj = imp && (typeof imp.summary_json === "string" ? JSON.parse(imp.summary_json) : imp.summary_json) || {};
    ok("§1 the import records the 199 it restored from the trash", (sj.restoredFromTrash || []).length === 199, { restored: (sj.restoredFromTrash || []).length });
    const u2 = await undoAndWait(BASE, tok, r.job.importId, { timeoutMs: 60000, pollMs: 100 });
    const after = await everyone(tok);
    const zero = (await one(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND id NOT LIKE 'd_import9_walk_%'`, [ORG])).n;
    const open = (await one(`SELECT COUNT(DISTINCT d.id)::int n FROM donors d JOIN deleted_records r ON r.org_id=d.org_id AND r.record_id=d.id AND r.table_name='donors' AND r.restored_at IS NULL
                               WHERE d.org_id=$1 AND d.deleted_at IS NOT NULL`, [ORG])).n;
    ok("§1 after the final undo Everyone is what it was before the import (17), nobody from the file is left at $0, and the 199 are in the trash with a trash row each (main: 216)",
      u2.status === 200 && after === before && zero === 0 && open === 200 && u2.body.backToTrash === 199   // INTEGRITY-3: + the one person the file made, in the trash too
        && /199 people it brought back from the trash are back in the trash/.test(u2.body.sentence || ""),
      { undo: u2.status, before, after, zero, open, backToTrash: u2.body && u2.body.backToTrash, sentence: u2.body && u2.body.sentence });
  }

  // ── §2 the cleanup script, on an org a pre-IMPORT-9 undo left behind
  {
    const ORG = "org_import9_left";
    const tok = await freshOrg(ORG, "Import Nine Leftovers");
    const sheets = giftFile(40, 2, "left");
    await trashedByAnEarlierRun(tok, ORG, sheets, 30);
    const before = await everyone(tok);
    const r = await reimportWithBringBack(tok, ORG, sheets);
    // the run as main wrote it: who it restored was not recorded
    await q(`UPDATE imports SET summary_json = summary_json::jsonb - 'restoredFromTrash' WHERE id=$1`, [r.job.importId]);
    const u = await undoAndWait(BASE, tok, r.job.importId, { timeoutMs: 60000, pollMs: 100 });
    const left = await everyone(tok);
    // a person she wrote to since is not a leftover
    const [kept] = await q(`SELECT d.id FROM donors d WHERE d.org_id=$1 AND d.deleted_at IS NULL AND d.email LIKE 'left%' ORDER BY d.email LIMIT 1`, [ORG]);
    const note = kept ? await api("POST", `/donors/${kept.id}/interactions`, tok, { type: "note", note: "Rang after the walk.", date: TODAY }) : { status: 0 };
    const liveBefore = await live(ORG);
    const dry = script(`--org=${ORG}`);
    const still = await live(ORG);
    ok("§2 the dry run lists the org and its 29 leftovers (one has a note since), by org id and count only, and writes nothing",
      r.matchedTrash === 30 && u.status === 200 && left === before + 30 && note.status < 300 && dry.code === 0 && new RegExp(`${ORG}: 29\\b`).test(dry.out) && /DRY RUN/.test(dry.out)
        && !/Alder|Briar|Cedar|@example/.test(dry.out) && still === liveBefore,
      { matched: r.matchedTrash, before, left, note: note.status, code: dry.code, out: dry.out.slice(0, 400), still });
    const app = script(`--org=${ORG}`, "--apply");
    const audits = await q(`SELECT id, record_count FROM fin_audit_log WHERE org_id=$1 AND user_id='system:scripts/ops/import9-undo-leftovers' AND action='return to trash'`, [ORG]);
    const afterApply = await everyone(tok);
    ok("§2 --apply puts the 29 back in the trash with one audit row for the org; Everyone is back to before, plus the one with a note",
      app.code === 0 && audits.length === 1 && Number(audits[0].record_count) === 29 && afterApply === before + 1, { code: app.code, out: app.out.slice(0, 300), audits, afterApply, before });
    const again = script(`--org=${ORG}`, "--apply");
    const audits2 = await q(`SELECT id FROM fin_audit_log WHERE org_id=$1 AND user_id='system:scripts/ops/import9-undo-leftovers'`, [ORG]);
    ok("§2 a second run changes nothing", again.code === 0 && !new RegExp(`${ORG}:`).test(again.out) && audits2.length === 1 && (await everyone(tok)) === afterApply,
      { out: again.out.slice(0, 300), audits: audits2.length });
    const un = audits[0] ? script(`--undo=${audits[0].id}`) : { code: 1, out: "no audit row" };
    const afterUndo = await everyone(tok);
    const un2 = audits[0] ? script(`--undo=${audits[0].id}`) : { code: 1, out: "no audit row" };
    ok("§2 --undo=<audit id> brings them back, and a second --undo changes nothing",
      un.code === 0 && afterUndo === left && un2.code === 0 && /: 0 brought back/.test(un2.out) && (await everyone(tok)) === left, { un: un.out, afterUndo, left, un2: un2.out });
  }

  // ── §3 and §4 a messy file
  {
    const ORG = "org_import9_messy";
    const tok = await freshOrg(ORG, "Import Nine Messy");
    const grid = [["Name", "Email", "Date", "Amount"],
      ["Opal Ferrow", "opal@example.test", "3/4/25", "$75.5"],
      ["Quill Brannagh", "quill@example.test", "5/6/25", "1,000"],
      ["Sorrel Atwick", "sorrel@example.test", "7/8/25", "$40"],
      ["Tamsin Royle", "tamsin@example.test", "2/1/25", "25.00"],
      ["Ulric Danby", "ulric@example.test", "2025-02-11", "30 USD"],
      ["Vesna Corrow", "vesna@example.test", "March 9, 2025", "$1,250.00"],
      ["Wilder Pash", "wilder@example.test", "6/9/25", "$12.5"],
      ["Xanthe Mourne", "xanthe@example.test", "10/11/25", "2,000"],
      ["Yorick Selby", "yorick@example.test", "4/3/25", "60"]];
    const sheets = [{ name: "Gifts", grid }];
    const body = { fileName: "messy.csv", sheets, useModel: false, today: TODAY, previewOrgId: ORG };
    const u = await api("POST", "/sheet-import/understand", tok, body);
    const dq = (u.body.questions || []).filter(x => x.kind === "dateOrder");
    const commit = await api("POST", "/sheet-import/commit", tok, body);
    const nGifts = (await one(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG])).n;
    ok("§3 the messy file stops at one date question for the column (\"3/4/25: March 4 or 3 April?\") and nothing imports until it is answered",
      u.status === 200 && u.body.ready === false && dq.length === 1 && dq[0].text === "3/4/25: March 4 or 3 April?" && dq[0].examples.length >= 3
        && dq[0].options.map(o => o.key).join() === "month,day" && commit.status === 409 && commit.body.error === "questions_open" && nGifts === 0,
      { status: u.status, ready: u.body.ready, dq: dq.map(x => [x.text, (x.examples || []).length]), commit: [commit.status, commit.body && commit.body.error], nGifts });
    const k = dq[0] && dq[0].key;
    const asDay = await api("POST", "/sheet-import/understand", tok, { ...body, answers: { dateOrder: { [k]: "day" } } });
    const asMonth = await api("POST", "/sheet-import/understand", tok, { ...body, answers: { dateOrder: { [k]: "month" } } });
    const opal = x => ((x.body.gifts || []).find(g => g.line === 2) || {}).date;
    ok("§3 the answer decides how 3/4/25 is read: day first is 3 April, month first is March 4",
      asDay.body.ready === true && opal(asDay) === "2025-04-03" && asMonth.body.ready === true && opal(asMonth) === "2025-03-04",
      { day: [asDay.body.ready, opal(asDay)], month: [asMonth.body.ready, opal(asMonth)] });
    const job = await importJob(tok, { ...body, answers: { dateOrder: { [k]: "day" } } });
    const [g] = await q(`SELECT g.date::text AS date FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND d.email='opal@example.test'`, [ORG]);
    ok("§3 answered day first, the gift is written on 2025-04-03", job.end && job.end.status === "done" && g && g.date === "2025-04-03", { job: job.end && job.end.status, g });
    const t = asDay.body.tidiedAmounts;
    const want = ["$75.5", "1,000", "30 USD", "$12.5", "2,000"];   // "$1,250.00" is written plainly
    ok("§4 the preview counts and lists the 5 amounts it tidied (\"We tidied 5 amounts\"), each with what it became",
      !!t && t.count === 5 && /^We tidied 5 amounts/.test(t.sentence) && t.rows.map(r => r.raw).join("|") === want.join("|")
        && t.rows[0].shown === "$75.50" && t.rows[1].shown === "$1,000.00",
      t);
    const mixed = ((asDay.body.dateGuesses || [])[0] || {}).mixed;
    ok("§4 the date column that mixes formats lists the rows it read another way",
      !!mixed && mixed.count === 2 && mixed.rows.map(r => `${r.line}:${r.read}`).join() === "6:2025-02-11,7:2025-03-09", mixed);
  }

  clearTimeout(deadline);
  await closeDb();
  summary("import9");
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

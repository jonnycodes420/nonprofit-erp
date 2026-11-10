// tests/integrity3.test.js: INTEGRITY-3. AN IMPORT UNDO NEVER DESTROYS A
// PERSON. Guards donor data: Fiona Callahan ($35,000) was gone from every
// surface (not in the Trash, search, the Audit log or Recent changes). On
// main, a person an import CREATED who was later in the trash (moved in and
// out by other imports' undo and Bring them back) was deleted outright when
// that import was undone: her row, her trash rows, no audit row naming her.
// Every name here is made up.
//
//   §1 the fleet's trail: P was here first, with a gift. Import A matches P;
//      undo A leaves P untouched. P goes to the trash; import B brings P back;
//      undo B puts P back in the trash on her ORIGINAL trash row (who, when,
//      why), restorable, with her gift.
//   §2 a person import X created, trashed, brought back by B, B undone, then
//      X undone: still in the trash, never deleted outright (main: gone).
//   §3 a person an import created, live, goes to the trash on undo, with a
//      trash row naming the import (main: deleted outright).
//   §4 every person an undo moves is one audit row: id, from-state, to-state.
//   §5 Empty trash writes one audit row per person, by id.
//   §6 the Trash page and the Everyone breakdown count the trash the same
//      (a record merged into another is in neither).
//
// Planted defect (run by hand, in the report): undo treats "restored" as
// "created" (restored people joined to the created list): §1 goes red.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { undoAndWait } = require("./lib/undoWait");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "integritythree12345";
const TODAY = "2026-11-10";
const SUITE_DEADLINE_MS = 240000;

const one = async (sql, args) => (await q(sql, args))[0];
async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Tester','admin')`, ["u_" + id, id, `${id}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  return login(`${id}@test.local`, PASSWORD);
}
async function person(org, id, name, email, gifts = []) {
  await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ($1,$2,$3,$4,'system:test','Test')`, [id, org, name, email]);
  for (const [k, [amt, d]] of gifts.entries())
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name,created_at) VALUES ($1,$2,$3,$4,$5,'system:test','Test', NOW() - INTERVAL '30 days')`, [`g_${id}_${k}`, org, id, amt, d]);
  return id;
}
async function importFile(tok, org, fileName, rows) {
  const sheets = [{ name: "Gifts", grid: [["Name", "Email", "Gift Date", "Amount"], ...rows] }];
  const r = await api("POST", "/sheet-import/commit", tok, { fileName, sheets, useModel: false, previewOrgId: org, today: TODAY, background: true });
  if (r.status !== 202) return { importId: null, start: r.status };
  for (const t0 = performance.now(); performance.now() - t0 < 120000;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { importId: r.body.importId, status: j.body.status, sheets };
    await new Promise(z => setTimeout(z, 300));
  }
  return { importId: r.body.importId, status: "timeout", sheets };
}
// the preview's "Bring them all back", pressed for this same file, then the import
async function bringBackAndImport(tok, org, fileName, rows) {
  const sheets = [{ name: "Gifts", grid: [["Name", "Email", "Gift Date", "Amount"], ...rows] }];
  const u = await api("POST", "/sheet-import/understand", tok, { fileName, sheets, useModel: false, today: TODAY });
  const ids = [...new Set([...(u.body.deletedMatches || []).map(x => x.id),
    ...(u.body.questions || []).filter(x => x.kind === "deletedPerson").map(x => x.deletedId)].filter(Boolean))];
  const bb = await api("POST", "/sheet-import/bring-back", tok, { ids, fileKey: u.body.fileKey });
  return { matched: ids, bring: bb, ...(await importFile(tok, org, fileName, rows)) };
}
const stateOf = async id => { const d = await one(`SELECT deleted_at IS NOT NULL AS t FROM donors WHERE id=$1`, [id]); return !d ? "gone" : d.t ? "trash" : "active"; };
const openRows = id => q(`SELECT id, created_by, row_data -> '__why' ->> 'kind' AS why, row_data ->> '__importUndo' AS imp FROM deleted_records
                           WHERE record_id=$1 AND table_name='donors' AND restored_at IS NULL ORDER BY created_at`, [id]);
const undo = (tok, id) => undoAndWait(BASE, tok, id, { timeoutMs: 60000, pollMs: 100 });
const moveRows = (org, id) => q(`SELECT action, before_fields, after_fields FROM fin_audit_log WHERE org_id=$1 AND entity_id=$2 AND action='moved to trash'`, [org, id]);

(async () => {
  const deadline = setTimeout(() => { console.error(`integrity3: the suite passed its ${SUITE_DEADLINE_MS / 1000} s deadline`); process.exit(1); }, SUITE_DEADLINE_MS);

  // ── §1 the fleet's trail, on a person who was here before every import
  {
    const ORG = "org_integrity3_trail";
    const tok = await freshOrg(ORG, "Integrity Three Trail");
    const P = await person(ORG, "d_i3t_p", "Rosalind Quill", "rquill@example.test", [[35000, "2025-06-01"]]);
    const a = await importFile(tok, ORG, "fleet-a.csv", [["Rosalind Quill", "rquill@example.test", "2026-10-01", "50"], ["Tobias Fen", "tfen@example.test", "2026-10-02", "20"]]);
    const ua = await undo(tok, a.importId);
    const afterA = { state: await stateOf(P), rows: (await openRows(P)).length, gifts: (await one(`SELECT COUNT(*)::int n FROM gifts WHERE donor_id=$1`, [P])).n,
      moved: (await moveRows(ORG, P)).length };
    ok("§1 a person who was here first and is active is untouched by an undo of an import that matched her (no trash row, her gift, no move)",
      a.status === "done" && ua.status === 200 && afterA.state === "active" && afterA.rows === 0 && afterA.gifts === 1 && afterA.moved === 0, { a: a.status, undo: ua.status, afterA });
    const del = await api("DELETE", `/donors/${P}`, tok);
    const [orig] = await openRows(P);
    const b = await bringBackAndImport(tok, ORG, "fleet-b.csv", [["Rosalind Quill", "rquill@example.test", "2026-10-05", "75"]]);
    const during = await stateOf(P);
    const ub = await undo(tok, b.importId);
    const rows = await openRows(P);
    const st = await stateOf(P);
    ok("§1 after re-import and undo she is in the trash on her ORIGINAL trash row (Wren's delete), not a new one",
      del.status === 200 && b.matched.includes(P) && b.bring.status === 200 && b.status === "done" && during === "active" && ub.status === 200
        && st === "trash" && rows.length === 1 && orig && rows[0].id === orig.id && rows[0].why === "delete" && rows[0].created_by === "u_" + ORG,
      { del: del.status, matched: b.matched, during, undo: ub.body && ub.body.sentence, st, rows, orig });
    const list = await api("GET", "/trash/people?q=Quill", tok);
    const back = await api("POST", "/trash/people/restore", tok, { ids: [P] });
    const gifts = await q(`SELECT amount FROM gifts WHERE donor_id=$1`, [P]);
    ok("§1 the Trash lists her as deleted from her record, and Restore brings her back with her $35,000 gift",
      list.body.total === 1 && /^Deleted from their record/.test(list.body.people[0].why) && back.body.restored === 1 && await stateOf(P) === "active"
        && gifts.length === 1 && Number(gifts[0].amount) === 35000,
      { list: list.body.people, back: back.body, gifts });
  }

  // ── §2 a person a file made, moved in and out of the trash, then that file undone
  {
    const ORG = "org_integrity3_made";
    const tok = await freshOrg(ORG, "Integrity Three Made");
    const x = await importFile(tok, ORG, "made-x.csv", [["Cassius Vane", "cvane@example.test", "2025-05-01", "12000"]]);
    const C = (await one(`SELECT id FROM donors WHERE org_id=$1 AND name='Cassius Vane'`, [ORG])).id;
    await api("DELETE", `/donors/${C}`, tok);
    const [orig] = await openRows(C);
    const b = await bringBackAndImport(tok, ORG, "made-b.csv", [["Cassius Vane", "cvane@example.test", "2026-10-05", "60"]]);
    await undo(tok, b.importId);
    const ux = await undo(tok, x.importId);
    const rows = await openRows(C);
    const found = await api("GET", "/trash/people?q=Cassius", tok);
    ok("§2 undoing the file that made him leaves him in the trash on his own trash row, findable and restorable (main: deleted outright, trash rows and all)",
      x.status === "done" && b.matched.includes(C) && ux.status === 200 && await stateOf(C) === "trash" && rows.length === 1 && orig && rows[0].id === orig.id
        && found.body.total === 1 && /in the trash, restorable for 30 days/.test(ux.body.sentence || ""),
      { x: x.status, matched: b.matched, undo: ux.body && ux.body.sentence, state: await stateOf(C), rows, found: found.body.total });
  }

  // ── §3 a person a file made, still live, when the file is undone; §4 the audit rows
  {
    const ORG = "org_integrity3_new";
    const tok = await freshOrg(ORG, "Integrity Three New");
    const P = await person(ORG, "d_i3n_p", "Odile Marsh", "omarsh@example.test", [[900, "2025-02-01"]]);
    const j = await importFile(tok, ORG, "new-people.csv", [["Ines Lowry", "ilowry@example.test", "2026-10-01", "25"], ["Odile Marsh", "omarsh@example.test", "2026-10-01", "30"]]);
    const I = (await one(`SELECT id FROM donors WHERE org_id=$1 AND name='Ines Lowry'`, [ORG])).id;
    const u = await undo(tok, j.importId);
    const rows = await openRows(I);
    ok("§3 a person the file created goes to the trash on undo, with a trash row naming the import (main: deleted outright)",
      j.status === "done" && u.status === 200 && await stateOf(I) === "trash" && rows.length === 1 && rows[0].why === "import_undo" && rows[0].imp === j.importId
        && await stateOf(P) === "active",
      { undo: u.body && u.body.sentence, state: await stateOf(I), rows });
    const mv = await moveRows(ORG, I);
    const undid = await q(`SELECT 1 FROM fin_audit_log WHERE org_id=$1 AND entity_type='import' AND entity_id=$2`, [ORG, j.importId]);
    ok("§4 the undo writes one audit row for the person it moved (id, active → trash) and one for the undo; none for the person it only matched",
      mv.length === 1 && mv[0].before_fields.state === "active" && mv[0].after_fields.state === "trash" && undid.length === 1 && (await moveRows(ORG, P)).length === 0,
      { mv, undid: undid.length });

    // ── §5 Empty trash: one row per person, by id
    const H = await person(ORG, "d_i3n_h", "Hollis Drey", "hdrey@example.test");
    await api("DELETE", `/donors/${H}`, tok);
    const inTrash = (await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NOT NULL ORDER BY id`, [ORG])).map(r => r.id);
    const e = await api("POST", "/donors/purge-trash", tok, { confirm: "empty", olderThanDays: null });
    const purged = (await q(`SELECT entity_id FROM fin_audit_log WHERE org_id=$1 AND action='deleted for good' ORDER BY entity_id`, [ORG])).map(r => r.entity_id);
    ok("§5 Empty trash deletes for good and writes one audit row per person, naming their id",
      e.status === 200 && e.body.purged === inTrash.length && inTrash.includes(H) && await stateOf(H) === "gone" && JSON.stringify(purged) === JSON.stringify(inTrash),
      { e: e.body, inTrash, purged });
  }

  // ── §6 one trash count
  {
    const ORG = "org_integrity3_count";
    const tok = await freshOrg(ORG, "Integrity Three Count");
    const keep = await person(ORG, "d_i3c_keep", "Perrin Ashdown", "pash@example.test");
    const gone = await person(ORG, "d_i3c_gone", "Perrin Ashdon", "pash2@example.test");
    const t1 = await person(ORG, "d_i3c_t1", "Sorrel Benn", "sbenn@example.test");
    const merge = await api("POST", "/donors/merge", tok, { primaryId: keep, secondaryId: gone });
    await api("DELETE", `/donors/${t1}`, tok);
    const page = await api("GET", "/trash/people?limit=5", tok);
    const bd = await api("GET", "/people/everyone-breakdown", tok);
    ok("§6 the Trash page and the Everyone breakdown say the same number; a record merged into another is in neither (main: 1 and 2)",
      merge.status === 200 && await stateOf(gone) === "trash" && page.body.inTrash === 1 && bd.body.notCounted.trash === 1,
      { merge: merge.status, page: page.body.inTrash, breakdown: bd.body.notCounted });
  }

  clearTimeout(deadline);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

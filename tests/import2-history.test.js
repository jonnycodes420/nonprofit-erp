// tests/import2-history.test.js: IMPORT-2. BRING THEIR WHOLE HISTORY.
//
// On a local org with the real 1,000-donor messy file imported, the paired
// notes file (2,420 rows, tests/fixtures/import2) is previewed, brought in and
// undone through the real routes, and checked against its key.
//
// WHAT IS ASSERTED
//   §1  The donor file: every old id a folded person had is kept on them, and
//       its Notes column became dated notes on the people (item 4).
//   §2  The preview writes nothing and matches the key: 1,910 by the old id,
//       239 by email, 251 by name, 20 matching nobody; the open tasks, HTML
//       notes, day-first dates and DO NOT SOLICIT people are all counted.
//   §3  A DO NOT SOLICIT note sets the flag only after it is confirmed, and an
//       unconfirmed preference ("email only, no calls") sets nothing.
//   §4  HTML notes arrive as clean text, line breaks kept.
//   §5  Open tasks become real tasks, on the Thread and on the Calendar.
//   §6  Last contacted and engagement use the original dates.
//   §7  No history yet is not a zero: the scores say noHistory until a person
//       has any conversation on file.
//   §8  Imported do not solicit keeps a person off Calls to make.
//   §9  ⌘K finds the words of an imported call.
//   §10 Undo removes everything the history import added, and only that.
//
// HOW IT WOULD GO RED: drop the folded id (§1 and §2's 1,910 fall to 1,848);
// set a flag at preview or without confirmation (§3); leave the tags in (§4);
// stamp imports with today (§6); read "Calls to make" without do_not_solicit
// (§8: the flagged donor is on the list); delete less on undo (§10).
// Proven able to fail: with the folded-id fix reverted, §1 and §2 went red;
// with callsToMake's do_not_solicit line removed, §8 went red.
//
// Standard scratch stack (tests/README.md). Sends nothing.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_import2h";
const ADMIN = "import2h@test.local";
const FX = path.join(__dirname, "fixtures", "import2");
const KEY = JSON.parse(fs.readFileSync(path.join(FX, "key.json"), "utf8"));
const RUN_DONORS = "imp_import2h_donors";
const RUN_HIST = "imp_import2h_hist";

const TABLES = ["interaction_attachments", "tasks", "interactions", "gifts", "donor_scores", "donor_relationships", "fin_transactions",
  "imports", "email_suppressions", "call_snoozes", "donors", "fin_funds", "accounts", "users"];

function parseCsv(t) {
  const rows = []; let row = [], cell = "", qd = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (qd) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else qd = false; } else cell += c; }
    else if (c === '"') qd = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const toObjects = (raw) => { const h = raw[0].map(x => x.trim()); return { headers: h,
  rows: raw.slice(1).filter(r => r.some(c => String(c).trim())).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]))) }; };

async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  try {
    await reset();
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,'Import2 History','import2-history',1,'active','team')`, [ORG]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ('u_import2h',$1,$2,$3,'Sarah Mitchell','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
    const tok = await login(ADMIN);
    const lib = await import("../shared/importShape.js");
    const H = await import("../shared/historyImport.js");
    const today = require("./helpers").civilToday();

    // ── §1 · the donor file ──────────────────────────────────────────────
    const dRaw = parseCsv(fs.readFileSync(path.join(FX, "steward-test-1000-donors-messy.csv"), "utf8").replace(/^﻿/, "")).slice(1);
    const dFile = toObjects(dRaw);
    const txMap = lib.autoDetectTxMapping(dFile.headers, dFile.rows.slice(0, 10));
    const built = lib.buildTransactionRows({ rows: dFile.rows }, txMap, { today });
    const byDonor = new Map();
    for (const g of built.gifts) { if (!byDonor.has(g.donorIndex)) byDonor.set(g.donorIndex, []); byDonor.get(g.donorIndex).push(g); }
    let importNotes = 0, chunkFail = null;
    for (let s = 0; s < built.donors.length; s += 500) {
      const slice = built.donors.slice(s, s + 500); const cg = [];
      slice.forEach((_, li) => { const gg = byDonor.get(s + li); if (gg) gg.forEach(g => { const { donorIndex, ...rest } = g; cg.push({ ...rest, donorIndex: li }); }); });
      const r = await api("POST", "/donors/import-combined", tok, { donors: slice, gifts: cg, importId: RUN_DONORS });
      if (r.status !== 200) { chunkFail = `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`; break; }
      importNotes += r.body.importNotesCreated || 0;
    }
    ok("§1 the 1,000-donor file imports", !chunkFail, chunkFail);
    const scott = await q(`SELECT id, external_donor_id, external_donor_ids FROM donors WHERE org_id=$1
                            AND (external_donor_id='D10449' OR external_donor_ids @> '["D10449"]'::jsonb
                                 OR external_donor_id='D20024' OR external_donor_ids @> '["D20024"]'::jsonb)`, [ORG]);
    ok("§1 a person the file lists under two old ids answers to both (Scott Ramos, D10449 and D20024)",
      scott.length === 1 && [...new Set([scott[0].external_donor_id, ...(scott[0].external_donor_ids || [])])].sort().join(",") === "D10449,D20024", JSON.stringify(scott));
    const [dn] = await q(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE date IS NULL OR date = '')::int undated
                            FROM interactions WHERE org_id=$1 AND type='note' AND import_id=$2`, [ORG, RUN_DONORS]);
    ok("§1 the donor file's Notes column became dated notes on the people", dn.n > 0 && dn.n === importNotes && dn.undated === 0, dn);

    // ── §7 (before) · no history yet ─────────────────────────────────────
    const [plain] = await q(`SELECT d.id FROM donors d WHERE d.org_id=$1 AND NOT EXISTS
                               (SELECT 1 FROM interactions i WHERE i.donor_id=d.id AND i.type <> 'gift') ORDER BY d.id LIMIT 1`, [ORG]);
    const s0 = await api("GET", `/donors/${plain.id}/scores`, tok);
    ok("§7 a person with only gifts on file reads No history yet, not 0 and Distant", s0.body.noHistory === true, JSON.stringify(s0.body).slice(0, 160));

    // ── §2 · the preview ─────────────────────────────────────────────────
    const nFile = toObjects(parseCsv(fs.readFileSync(path.join(FX, "steward-test-notes-messy.csv"), "utf8")));
    const flagsBefore = (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND do_not_solicit IS TRUE`, [ORG]))[0].n;
    const [ixBefore] = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1`, [ORG]);
    const p = await api("POST", "/history-import/preview", tok, { fileName: "steward-test-notes-messy.csv", headers: nFile.headers, rows: nFile.rows });
    const c = p.body.counts || {};
    ok("§2 the preview reads the file", p.status === 200 && c.rows === KEY.rows, `${p.status} ${JSON.stringify(c).slice(0, 200)}`);
    ok(`§2 ${KEY.matchedById.toLocaleString()} match by the old system's id`, c.byMethod?.id === KEY.matchedById, c.byMethod);
    ok(`§2 ${KEY.matchedByEmail} by email`, c.byMethod?.email === KEY.matchedByEmail, c.byMethod);
    ok(`§2 ${KEY.matchedByName} by name`, c.byMethod?.name === KEY.matchedByName, c.byMethod);
    ok(`§2 ${KEY.matchNobody} match nobody, and nothing is guessed`, c.unmatched === KEY.matchNobody && c.ambiguous === 0, { unmatched: c.unmatched, ambiguous: c.ambiguous });
    ok(`§2 ${KEY.openTasks} open tasks`, c.openTasks === KEY.openTasks, c.openTasks);
    const expOverdue = nFile.rows.filter(r => /^(open|not started|in progress)$/i.test(r.Status) && H.readDate(r["Due Date"]).value < today).length;
    ok("§2 the overdue ones are counted against today", c.openTasksOverdue === expOverdue && expOverdue > 0, { got: c.openTasksOverdue, expOverdue });
    ok(`§2 ${KEY.html} HTML notes`, c.html === KEY.html, c.html);
    ok(`§2 ${KEY.dayFirstRows} dates read day first, each listed`, c.dayFirst === KEY.dayFirstRows && p.body.dayFirst.length === KEY.dayFirstRows, c.dayFirst);
    ok(`§2 ${KEY.emptyNoteRefused} rows refused, each with its reason`,
      c.refused === KEY.emptyNoteRefused && p.body.refused.every(r => /empty/.test(r.reason)), p.body.refused);
    const dnsProps = p.body.prefs.filter(x => x.flag === "do_not_solicit");
    ok(`§2 DO NOT SOLICIT found for ${KEY.doNotSolicitPeople} people (${KEY.doNotSolicit} rows), each for a person to confirm`,
      dnsProps.length === KEY.doNotSolicitPeople && c.prefs.do_not_solicit === KEY.doNotSolicit, { people: dnsProps.length, rows: c.prefs.do_not_solicit });
    const flagsAfterPreview = (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND do_not_solicit IS TRUE`, [ORG]))[0].n;
    const [ixAfterPreview] = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1`, [ORG]);
    ok("§2 the preview wrote nothing", flagsAfterPreview === flagsBefore && ixAfterPreview.n === ixBefore.n, { flagsBefore, flagsAfterPreview });

    // ── commit: confirm DO NOT SOLICIT only; create one unmatched person ──
    const confirmFlags = dnsProps.filter(x => !x.already).map(x => ({ donorId: x.donorId, flag: x.flag }));
    const createGroup = p.body.unmatched.find(g => g.canCreate);
    const cm = await api("POST", "/history-import/commit", tok, { importId: RUN_HIST, fileName: "steward-test-notes-messy.csv",
      headers: nFile.headers, rows: nFile.rows, confirmFlags, create: createGroup.indexes });
    ok("§3 the history comes in", cm.status === 200 && cm.body.interactions > 2000, `${cm.status} ${JSON.stringify(cm.body).slice(0, 240)}`);

    // ── §3 · flags only as confirmed ─────────────────────────────────────
    const flagged = await q(`SELECT id FROM donors WHERE org_id=$1 AND do_not_solicit IS TRUE`, [ORG]);
    ok("§3 every confirmed DO NOT SOLICIT is set", confirmFlags.every(f => flagged.some(r => r.id === f.donorId)), flagged.length);
    const callProps = p.body.prefs.filter(x => x.flag === "do_not_call");
    const [calls] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND do_not_call IS TRUE`, [ORG]);
    ok("§3 a preference nobody confirmed sets nothing (\"email only, no calls\")", callProps.length > 0 && calls.n === 0, { proposed: callProps.length, set: calls.n });

    // ── §4 · HTML becomes clean text ─────────────────────────────────────
    const html = await q(`SELECT note FROM interactions WHERE org_id=$1 AND import_id=$2 AND metadata->>'wasHtml' = 'true'`, [ORG, RUN_HIST]);
    ok("§4 HTML notes arrive as text, no tags, entities decoded, line breaks kept",
      html.length > 100 && html.every(r => !/<\/?[a-z][^>]*>/i.test(r.note) && !/&(amp|quot|lt|gt);/.test(r.note)) && html.some(r => r.note.includes("\n")),
      html.slice(0, 2));

    // ── §5 · open tasks on the Thread and the Calendar ───────────────────
    const tasks = await q(`SELECT id, due, donor_id FROM tasks WHERE org_id=$1 AND import_id=$2`, [ORG, RUN_HIST]);
    const expTasks = KEY.openTasks - p.body.unmatched.filter(g => g !== createGroup).flatMap(g => g.indexes)
      .filter(i => /^(open|not started|in progress)$/i.test(nFile.rows[i].Status)).length;
    ok(`§5 the open tasks became tasks (${expTasks}: every open task on a person Steward has)`, tasks.length === expTasks, tasks.length);
    const soon = tasks.filter(t => t.due >= today).sort((a, b) => a.due.localeCompare(b.due))[0];
    const to = new Date(Date.parse(soon.due + "T12:00:00Z") + 7 * 864e5).toISOString().slice(0, 10);
    const cal = await api("GET", `/calendar/items?from=${today}&to=${to < today ? today : to}&scope=everyone`, tok);
    ok("§5 an imported open task is on the Calendar on its due date",
      (cal.body.items || []).some(i => i.id === `task:${soon.id}` && i.start === soon.due), { status: cal.status, soon });
    const th = await api("GET", `/threads?donorId=${soon.donor_id}&scope=all`, tok);
    ok("§5 …and on the Thread", JSON.stringify(th.body).includes(soon.id), JSON.stringify(th.body).slice(0, 200));

    // ── §6 · original dates ──────────────────────────────────────────────
    const [call] = await q(`SELECT donor_id, MAX(LEFT(date,10)) AS d FROM interactions
                             WHERE org_id=$1 AND import_id=$2 AND type IN ('call','meeting') AND LEFT(date,10) <= $3 AND LEFT(date,10) > $4
                             GROUP BY donor_id ORDER BY donor_id LIMIT 1`, [ORG, RUN_HIST, today, `${+today.slice(0, 4) - 2}-01-01`]);
    const [sc] = await q(`SELECT last_touch FROM donor_scores WHERE org_id=$1 AND donor_id=$2`, [ORG, call.donor_id]);
    ok("§6 engagement's last touch is the original date from the file, not the day of the import",
      sc && String(sc.last_touch).slice(0, 10) >= call.d && String(sc.last_touch).slice(0, 10) !== today, { sc, call });
    const [ymd] = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND import_id=$2 AND LEFT(date,10) = $3`, [ORG, RUN_HIST, today]);
    ok("§6 no imported line is stamped with today", ymd.n === nFile.rows.filter(r => H.readDate(r.Date).value === today).length, ymd);
    ok("§6 the report gives the engagement spread before and after", cm.body.engagement && cm.body.engagement.before.no_history > 0, cm.body.engagement);

    // ── §7 (after) ───────────────────────────────────────────────────────
    const s1 = await api("GET", `/donors/${call.donor_id}/scores`, tok);
    ok("§7 a person with imported history no longer reads No history yet", s1.body.noHistory === false, s1.body.noHistory);

    // ── §8 · do not solicit keeps them off Calls to make ─────────────────
    const flaggedId = confirmFlags[0].donorId;
    const [control] = await q(`SELECT id FROM donors WHERE org_id=$1 AND COALESCE(do_not_solicit,false)=false
                                 AND COALESCE(do_not_contact,false)=false AND COALESCE(deceased,false)=false AND COALESCE(kind,'') <> 'anonymous'
                                 AND EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=donors.id) ORDER BY id LIMIT 1`, [ORG]);
    for (const [id, did] of [["g_import2h_flag", flaggedId], ["g_import2h_ctl", control.id]])
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,250000,$4,'system:test','test')`, [id, ORG, did, today]);
    const hc = await api("GET", "/home/calls", tok);
    const onList = id => (hc.body.rows || []).some(r => r.donorId === id) || JSON.stringify(hc.body).includes(id);
    ok("§8 a large gift from an ordinary donor puts them on Calls to make (the check is not vacuous)", onList(control.id), hc.body.count);
    ok("§8 the same gift from a donor marked do not solicit does not", !onList(flaggedId), hc.body.rows);

    // ── §9 · ⌘K finds what was said ──────────────────────────────────────
    const se = await api("GET", "/search?q=" + encodeURIComponent("talk to my wife"), tok);
    ok("§9 search finds the words of an imported conversation", (se.body.results || []).some(r => r.kind === "notes" || r.kind === "note" || r.kind === "meeting"),
      JSON.stringify(se.body).slice(0, 200));

    // ── §10 · undo ───────────────────────────────────────────────────────
    const created = await q(`SELECT id FROM donors WHERE org_id=$1 AND created_import_id=$2`, [ORG, RUN_HIST]);
    const un = await api("POST", `/imports/${RUN_HIST}/reverse`, tok, {});
    ok("§10 undo runs", un.status === 200, `${un.status} ${JSON.stringify(un.body).slice(0, 200)}`);
    const [left] = await q(`SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$1 AND import_id=$2)::int ix,
                                   (SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND import_id=$2)::int tk,
                                   (SELECT COUNT(*) FROM donors WHERE org_id=$1 AND do_not_solicit IS TRUE)::int dns,
                                   (SELECT COUNT(*) FROM donors WHERE org_id=$1 AND created_import_id=$2)::int people,
                                   (SELECT COUNT(*) FROM interactions WHERE org_id=$1 AND import_id=$3)::int donor_notes`, [ORG, RUN_HIST, RUN_DONORS]);
    ok("§10 every history line, task, person and flag it added is gone",
      left.ix === 0 && left.tk === 0 && left.people === 0 && created.length === 1 && left.dns === flagsBefore, left);
    ok("§10 …and nothing else: the donor file's own notes stay", left.donor_notes === dn.n, left);
  } catch (e) {
    ok("suite ran without throwing", false, e.stack);
  } finally {
    await reset();
    summary();
    await closeDb();
  }
})();

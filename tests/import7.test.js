// tests/import7.test.js: IMPORT-7. A BIG SINGLE SHEET LOSES NO ROWS, THE
// RECEIPT NAMES ITS COUNTS, AND A BIG UNDO CAN'T HANG. Guards donor data:
// "Import a spreadsheet" kept the first 20,000 rows of each sheet
// (routes/sheetImport.js readBody, MAX_ROWS) and said nothing, so a one-sheet
// 25,000-person CSV landed 19,999 people (the header is a row) under a
// receipt that read "Imported 19,999 new people." And the 25k Undo was one
// request with no limit, which hung a CI shard twice on 3 Nov.
//
//   §1 every row: a generated 25,000-person CSV (made-up names,
//      tests/lib/bigSheet.js) previews 25,000 people and imports 25,000, and
//      the receipt's every-row line balances: rows in this file = people
//      created + set aside + errored, counted again from the database.
//   §2 too big: a file past the row limit is refused, preview and write, with
//      its count ("This file has 200,002 rows…"), and nothing is written.
//   §3 each count named: a two-sheet workbook's receipt has one line per sheet
//      naming the sheet and its unit, the file's line adds them up, and no
//      label is used for two numbers (the workbook screen's "rows in the
//      file" is gone).
//   §5 a 5,000-gift file in under two minutes at prod's round trip: on prod a
//      1,005-person, 5,010-gift workbook took over an hour, one gift at a time
//      (recordGift, a gift_type UPDATE and a progress write each). The same
//      shape, generated, lands whole, and its time here plus every statement it
//      sent charged 20 ms (the job's own count, TEST_MODE) is under 2 minutes.
//   §4 the big Undo: Undo of the 25,000-person import answers at once (202),
//      runs on the queue with progress, and is followed to done with this
//      suite's own deadline, never a wait; every person goes. A small import
//      still undoes in the request (200).
//
// HOW IT GOES RED ON MAIN: §1 19,999 land and the receipt has no row line;
// §2 the file is cut, read and written (200, people in the database); §3 the
// receipt has no per-sheet lines; §4 the Undo holds the request and answers
// 200 after the work (no 202), and undo-status is a 404; §5 the job does not
// count its statements, and one gift at a time is about 70,000 of them (about
// 24 minutes at 20 ms, measured). Planted: MAX_ROWS =
// 20000 back in readBody turns §1 red; the 5,000-row hand-off taken out of
// the reverse route turns §4 red; GIFT_BATCH = 1 turns §5 red.
//
// Standard scratch stack (tests/README.md). Sends nothing. The server legs
// read no date; the reader's today is fixed (2026-11-03) for §0.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { bigPeopleCsv, bigGiftRows } = require("./lib/bigSheet");
const { undoAndWait } = require("./lib/undoWait");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "loadtest1234";
const N = 25000;
const SUITE_DEADLINE_MS = 360000;   // the whole suite; §4's own wait is shorter

let R = null;
const reader = async () => (R = R || await import("../shared/sheetRead.js"));
async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const one = async (sql, args) => (await q(sql, args))[0];
// helpers.api, once more on a dropped keep-alive socket (a 50 MB body's
// neighbour); every call here is a read or carries its run id
async function call(...a) {
  for (let i = 0; ; i++) {
    try { return await api(...a); }
    catch (e) { if (i >= 2 || !/fetch failed|ECONNRESET|socket/i.test(String(e.message) + String(e.cause && e.cause.code))) throw e; await new Promise(z => setTimeout(z, 300)); }
  }
}
async function importJob(tok, body) {
  const r = await call("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status !== 202) return { start: r, end: null, importId: null };
  const t0 = performance.now();
  for (;;) {
    const j = await call("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { start: r, end: j.body, importId: r.body.importId };
    if (performance.now() - t0 > 150000) return { start: r, end: { status: "timeout" }, importId: r.body.importId };
    await new Promise(z => setTimeout(z, 500));
  }
}

(async () => {
  const deadline = setTimeout(() => { console.error(`import7: the suite passed its ${SUITE_DEADLINE_MS / 1000} s deadline`); process.exit(1); }, SUITE_DEADLINE_MS);
  deadline.unref();
  const Rm = await reader();

  // ── §1 every row of a 25,000-person sheet
  const ORG1 = "org_import7_big";
  const tok = await freshOrg(ORG1, "Import Seven Big Sheet");
  const csv = bigPeopleCsv(N);
  const sheets = [{ name: "Sheet1", grid: Rm.gridFromText(csv) }];
  const t0 = performance.now();
  const u = await call("POST", "/sheet-import/understand", tok, { fileName: "big-people.csv", sheets, useModel: false });
  ok(`§1 the preview reads every one of the ${N.toLocaleString("en-US")} people in a one-sheet CSV (main: 19,999, the rest cut without a word)`,
    u.status === 200 && u.body.counts && u.body.counts.people === N && u.body.rowAccount && u.body.rowAccount.rows === N && u.body.rowAccount.balanced,
    { status: u.status, error: u.body.error, people: u.body.counts && u.body.counts.people, rows: u.body.rowAccount && u.body.rowAccount.sentence, ms: Math.round(performance.now() - t0) });
  const job = await importJob(tok, { fileName: "big-people.csv", sheets, useModel: false, previewOrgId: ORG1 });
  const res = (job.end && job.end.result) || {};
  const { n: inDb } = await one(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND created_import_id=$2`, [ORG1, job.importId]);
  ok(`§1 ...and all ${N.toLocaleString("en-US")} land, each a person in the database`,
    job.end && job.end.status === "done" && res.donorsCreated === N && inDb === N,
    { job: job.end && job.end.status, error: job.end && job.end.error, created: res.donorsCreated, inDb });
  const sr = res.sheetRows || null, line = sr && sr.sheets[0];
  ok("§1 the receipt's every-row line balances, in this file's words: rows in this file = people created + set aside + errored",
    !!line && sr.sheets.length === 1 && line.rows === N && line.peopleCreated === N && line.setAside === 0 && line.errored === 0 && line.balanced && sr.file.balanced
      && line.sentence === `${N.toLocaleString("en-US")} rows in this file = ${N.toLocaleString("en-US")} people created + 0 set aside + 0 errored ✓`,
    sr);
  const rec = await call("GET", `/imports/${job.importId}`, tok);
  const recRows = rec.body && rec.body.import && rec.body.import.sheetRows;
  ok("§1 ...and Settings, Imports opens the same line from the import's record", rec.status === 200 && !!recRows && recRows.sheets[0].sentence === (line && line.sentence),
    { status: rec.status, line: recRows && recRows.sheets[0] && recRows.sheets[0].sentence });

  // ── §4 the big Undo, followed with this suite's own deadline
  const back = await undoAndWait(BASE, tok, job.importId, { timeoutMs: 120000, pollMs: 100 });
  // INTEGRITY-3: an undo puts the people its file created in the trash, never deletes them outright
  const { n: leftPeople } = await one(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG1]);
  ok("§4 Undo of the 25,000-person import answers at once (202) and runs on the queue, not in the request (main: one request held to the end)",
    back.via === "queue" && back.answeredMs < 10000, { via: back.via, answeredMs: back.answeredMs, status: back.status, error: back.error });
  ok("§4 ...with its progress on the way (what it is doing, how far of how many)",
    // a step that removes counted rows says how far; one that doesn't (the rest of the file) says what it is doing
    back.seen.some(s => s.status === "running" && /^Undoing: /.test(s.sentence || "") && (s.total === 0 || s.done <= s.total)) || back.seen.length === 1 && back.seen[0].status === "done",
    back.seen.slice(0, 4));
  ok("§4 ...and is followed to done inside the deadline: every person the file made is gone, and the sentence counts them",
    back.status === 200 && leftPeople === 0 && /25,000 people this file created/.test((back.body && back.body.sentence) || ""),
    { status: back.status, ms: back.ms, error: back.error, leftPeople, sentence: back.body && back.body.sentence });
  const again = await call("POST", `/imports/${job.importId}/reverse`, tok, {});
  ok("§4 ...and pressing Undo again says it was already undone", again.status === 409 && again.body.error === "already_reversed", { status: again.status, body: again.body });

  // ── §2 a file past the limit: refused with its count, nothing written
  const ORG2 = "org_import7_huge";
  const tok2 = await freshOrg(ORG2, "Import Seven Huge");
  const huge = [{ name: "Sheet1", grid: [["Name"], ...Array.from({ length: 200001 }, (_, i) => ["P" + i])] }];
  const hu = await call("POST", "/sheet-import/understand", tok2, { fileName: "huge.csv", sheets: huge, useModel: false });
  const hc = await call("POST", "/sheet-import/commit", tok2, { fileName: "huge.csv", sheets: huge, useModel: false, previewOrgId: ORG2, background: true });
  const wrote = await one(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int d, (SELECT COUNT(*) FROM imports WHERE org_id=$1)::int i,
                                  (SELECT COUNT(*) FROM sheet_import_jobs WHERE org_id=$1)::int j`, [ORG2]);
  ok("§2 a file past the limit is refused before it is read, with its count (main: cut to 20,000 and read)",
    hu.status === 413 && hu.body.error === "too_many_rows" && hu.body.rows === 200002
      && /^This file has 200,002 rows\. Steward reads up to 200,000 in one file; split it and import each part\.$/.test(hu.body.message || ""),
    { status: hu.status, body: hu.body });
  ok("§2 ...the write is refused the same way, and nothing is written: no person, no import, no job",
    hc.status === 413 && hc.body.error === "too_many_rows" && wrote.d === 0 && wrote.i === 0 && wrote.j === 0, { status: hc.status, error: hc.body.error, wrote });

  // ── §3 a two-sheet workbook: each count named
  const ORG3 = "org_import7_names";
  const tok3 = await freshOrg(ORG3, "Import Seven Names");
  const people = [["First Name", "Last Name", "Email"], ...Array.from({ length: 12 }, (_, i) => [["Avery", "Brin", "Calder", "Dace"][i % 4], ["Ashgrove", "Brackwell", "Cindermoor"][i % 3] + (i > 3 ? "-" + i : ""), `n${i}@names.example`])];
  const gifts = [["Email", "Amount", "Date"], ...people.slice(1, 9).map((p, i) => [p[2], String(50 + i * 5), "2026-09-0" + (1 + (i % 9))]), ["", "Total", ""]];
  const wb = [{ name: "People", grid: people }, { name: "Gifts", grid: gifts }];
  const u3 = await call("POST", "/sheet-import/understand", tok3, { fileName: "names.xlsx", sheets: wb, useModel: false });
  const j3 = u3.status === 200 ? await importJob(tok3, { fileName: "names.xlsx", sheets: wb, useModel: false, previewOrgId: ORG3, answers: u3.body.questions ? {} : {} }) : { end: null };
  const s3 = j3.end && j3.end.result && j3.end.result.sheetRows;
  const byName = s3 ? Object.fromEntries(s3.sheets.map(x => [x.sheet, x])) : {};
  ok("§3 the receipt has one line per sheet, each naming its sheet and what it counts",
    !!s3 && byName.People && byName.Gifts && /^12 rows in the People sheet = 12 people created \+ 0 set aside \+ 0 errored ✓$/.test(byName.People.sentence)
      && /^\d+ rows in the Gifts sheet = 8 gift rows written \+ \d+ set aside \+ 0 errored ✓$/.test(byName.Gifts.sentence),
    { status: u3.status, job: j3.end && j3.end.status, error: j3.end && (j3.end.error || j3.end.sentence), sheets: s3 && s3.sheets.map(x => x.sentence) });
  const sum = k => s3 ? s3.sheets.reduce((t, x) => t + x[k], 0) : -1;
  ok("§3 ...and the file's line is the sheets added up, with its own words",
    !!s3 && s3.file.rows === sum("rows") && s3.file.giftRowsWritten === sum("giftRowsWritten") && s3.file.balanced
      && s3.file.sentence === `${s3.file.rows} rows in all 2 sheets = 12 people created + 8 gift rows written + ${s3.file.setAside} set aside + 0 errored ✓`,
    s3 && s3.file);
  // the workbook screen's two numbers that both said "rows in the file"
  const wbSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "WorkbookImport.jsx"), "utf8");
  const labels = s3 ? [...s3.sheets, s3.file].map(x => x.sentence.replace(/^[\d,]+ /, "").split(" = ")[0]) : [];
  ok("§3 no label counts two things: each sheet's and the file's line differ, and the workbook receipt no longer says \"rows in the file\"",
    labels.length === 3 && new Set(labels).size === 3 && !/\brows in the file\b/.test(wbSrc) && /gift rows in the \{ps\.sheet\} sheet/.test(wbSrc), labels);

  // ── §5 a 5,010-gift file, inside two minutes at prod's round trip
  const ORG5 = "org_import7_gifts", LATENCY_MS = 20, BUDGET_MS = 120000;
  const tok5 = await freshOrg(ORG5, "Import Seven Gifts");
  const gsheets = [{ name: "Gifts", grid: bigGiftRows(1005, 5010) }];
  const u5 = await call("POST", "/sheet-import/understand", tok5, { fileName: "test-1000.xlsx", sheets: gsheets, useModel: false });
  const t5 = performance.now();
  const j5 = u5.status === 200 ? await importJob(tok5, { fileName: "test-1000.xlsx", sheets: gsheets, useModel: false, previewOrgId: ORG5 }) : { end: null };
  const wall5 = Math.round(performance.now() - t5);
  // the job's statement count lands just after it says done
  let trips = j5.end && j5.end.roundTrips;
  for (let i = 0; j5.importId && trips == null && i < 40; i++) {
    await new Promise(z => setTimeout(z, 250));
    const j = await call("GET", `/sheet-import/jobs/${encodeURIComponent(j5.importId)}`, tok5);
    trips = j.body && j.body.roundTrips;
  }
  const db5 = await one(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int g, (SELECT COALESCE(SUM(amount),0) FROM gifts WHERE org_id=$1)::numeric d,
                                (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int p,
                                (SELECT COUNT(*) FROM interactions WHERE org_id=$1 AND type='gift' AND gift_id IS NOT NULL)::int lines,
                                (SELECT COUNT(*) FROM events_outbox WHERE org_id=$1 AND type='gift.recorded' AND ready)::int events,
                                (SELECT COUNT(*) FROM gifts WHERE org_id=$1 AND gift_type IS NOT NULL)::int typed,
                                (SELECT COUNT(*) FROM donors d WHERE org_id=$1 AND NOT EXISTS (
                                   SELECT 1 FROM (SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM gifts g WHERE g.donor_id=d.id) t
                                    WHERE t.s = d.total_giving AND t.n = d.gift_count))::int off`, [ORG5]);
  const sent = gsheets[0].grid.slice(1).reduce((t, r) => t + Math.round(Number(r[3]) * 100), 0) / 100;
  ok("§5 a 1,005-person, 5,010-gift file lands whole through the one gift path: every gift, its timeline line and its event, each person's total and count",
    j5.end && j5.end.status === "done" && db5.g === 5010 && Number(db5.d) === sent && db5.p === 1005 && db5.lines === 5010 && db5.events === 5010
      && db5.typed === 1002 && db5.off === 0,
    { job: j5.end && j5.end.status, error: j5.end && j5.end.error, sent, ...db5 });
  const charged = wall5 + (trips || 0) * LATENCY_MS;
  ok(`§5 ...in under 2 minutes at ${LATENCY_MS} ms a statement (${wall5} ms here + ${trips} statements × ${LATENCY_MS} ms = ${Math.round(charged / 1000)} s; one gift at a time: about 24 minutes)`,
    trips != null && charged < BUDGET_MS, { wall5, trips, charged });
  // IMPORT-10: the same file again is asked first; she says "Import again anyway"
  const again5 = u5.status === 200 ? await importJob(tok5, { fileName: "test-1000.xlsx", sheets: gsheets, useModel: false, previewOrgId: ORG5, answers: { importAgain: j5.importId } }) : { end: null };
  const { n: g5 } = await one(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG5]);
  ok("§5 ...and the same file again adds nothing: every gift row is already here",
    again5.end && again5.end.status === "done" && g5 === 5010 && again5.end.result && again5.end.result.giftsCreated === 0 && again5.end.result.duplicates === 5010,
    { status: again5.end && again5.end.status, gifts: g5, created: again5.end && again5.end.result && again5.end.result.giftsCreated, duplicates: again5.end && again5.end.result && again5.end.result.duplicates });

  // §4 under the line: a small import is undone in the request
  const small = await undoAndWait(BASE, tok3, j3.importId || "none", { timeoutMs: 30000 });
  ok("§4 a small import is still undone in the request (200 with its sentence)", small.via === "inline" && small.status === 200 && /^Undone\. 8 gifts removed/.test((small.body && small.body.sentence) || ""),
    { via: small.via, status: small.status, sentence: small.body && (small.body.sentence || small.body.message) });
  // FLAKE-2: an undo that has marked the import undone but is still finishing
  // (the after-change step of a long undo) is not done yet. The old order
  // wrote reversed_at first, and a screen polling then read "done" with the
  // stand-in "Undone. The whole import was removed." and no count. Planted
  // here: that in-between row; the screen must read it as still running.
  if (j3.importId) {
    await q(`UPDATE imports SET undo_state = (undo_state - 'result') || '{"status":"running","phase":"finishing"}'::jsonb WHERE id=$1 AND org_id=$2`, [j3.importId, ORG3]);
    const mid = await call("GET", `/imports/${j3.importId}/undo-status`, tok3);
    ok("§4 an undo still finishing is never read as done without its count",
      mid.status === 200 && mid.body.status === "running" && !/whole import was removed/.test(mid.body.sentence || ""),
      { status: mid.status, undo: mid.body && mid.body.status, sentence: mid.body && mid.body.sentence });
  }

  for (const id of [ORG1, ORG2, ORG3, ORG5]) {
    const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
  }
  summary();
  await closeDb();
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });

// server/onboard/concierge.js · ONBOARD-4 item 5. "SEND IT TO US".
//
// She sends her donor file instead of importing it herself (or the file she
// attached when she booked the call is used). It becomes one job on /ops →
// Onboarding:
//
//   received   the file is here
//   mapped     the mapper's first pass ran: what the spreadsheet importer
//              understood (shared/sheetRead.js understand, the importer's own
//              judgement) and the cells it read, kept so Load writes exactly
//              what was reviewed. CSV is read on the server when it arrives;
//              a workbook is read in the reviewer's browser by the importer's
//              own reader (readSheetFile) and sent back as cells.
//   loaded     a PERSON pressed Load. Load runs the spreadsheet import's own
//              job (routes/sheetImport.js INTERNAL.commit), so the run is a
//              normal import: in her Imports, with its Undo.
//
// NOTHING LOADS WITHOUT A PERSON PRESSING LOAD. create() and firstPass() never
// write a donor or a gift; load() is called only from POST
// /ops/onboarding/concierge/:id/load. The planted defect (ONBOARD4B_PLANT=
// autoload, tests only) loads at create and tests/onboard4b.test.js §1 goes red.
//
// Her side reads four words with dates: Received, Being mapped, Ready for you
// to check (Load ran; she checks the totals, ONBOARD-3), Loaded (she said
// Looks right: orgs.data_in_at on or after the load).
"use strict";
const { newId } = require("../shared/newId");

const PLANT = process.env.TEST_MODE === "1" ? process.env.ONBOARD4B_PLANT || "" : "";
const MAX_BYTES = 10 * 1024 * 1024;
const TEXT_EXT = /\.(csv|tsv|txt)$/i;
const SHEET_EXT = /\.(csv|tsv|txt|xlsx|xlsm|xls|ods)$/i;
const STATES = [
  { key: "received", words: "Received" },
  { key: "mapping", words: "Being mapped" },
  { key: "ready", words: "Ready for you to check" },
  { key: "loaded", words: "Loaded" },
];

const cleanName = n => String(n || "").replace(/[\\/\r\n\t]/g, " ").trim().slice(0, 200);

// The file as sent: { fileName, fileType, data (base64) }. A refusal names the fix.
function readUpload(b) {
  const fileName = cleanName(b && b.fileName);
  if (!fileName) return { error: "file_needed", message: "Choose your donor file first." };
  if (!SHEET_EXT.test(fileName)) return { error: "file_type", message: "Send a spreadsheet: .xlsx, .xls, .csv or .tsv. Steward cannot read this kind of file." };
  const raw = String((b && b.data) || "").replace(/^data:[^,]*,/, "");
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length) return { error: "file_empty", message: "That file is empty." };
  if (bytes.length > MAX_BYTES) return { error: "file_too_big", message: "That file is over 10 MB. Email it to jonathan@stewardapp.dev instead." };
  return { fileName, fileType: String((b && b.fileType) || "").slice(0, 120) || null, bytes };
}

async function create(ctx, orgId, file, who, { source = "upload", bookingId = null, note = null } = {}) {
  const id = newId("ocj");
  await ctx.run(`INSERT INTO onboard_concierge_jobs (id, org_id, source, booking_id, file_name, file_type, file_size, file_data, note, created_by, created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, source, bookingId, file.fileName, file.fileType, file.bytes.length, file.bytes, note ? String(note).slice(0, 1000) : null, who.id, who.name]);
  // The mapper's first pass, on the server, for a text file. A workbook waits for the reviewer's reader.
  if (TEXT_EXT.test(file.fileName)) {
    const sheets = await textSheets(file.bytes).catch(() => null);
    if (sheets) await firstPass(ctx, id, sheets, { id: "system:onboard-concierge", name: "Steward (first pass)" });
  }
  if (PLANT === "autoload") await load(ctx, id, who, { userId: who.id, name: who.name }).catch(() => {});   // THE PLANTED DEFECT (tests only)
  return id;
}

async function textSheets(bytes) {
  const I = await import("../../shared/importShape.js");
  const S = await import("../../shared/sheetRead.js");
  const dec = I.decodeSpreadsheetBytesDetailed(new Uint8Array(bytes));
  return [{ name: "Sheet1", grid: S.gridFromText(dec.text) }];
}

// What the importer understood, in a few facts the reviewer reads before Load.
function summarize(u) {
  const c = u.counts || {};
  const cols = [];
  for (const t of u.tables || []) for (const col of t.columns || []) cols.push({ header: String(col.header || ""), role: col.role || null });
  return {
    people: Number(c.people || 0), gifts: Number(c.gifts || 0), giftCents: Number(c.giftCents || 0), aside: Number(c.aside || 0),
    pledges: Number(c.pledges || 0), columns: cols.slice(0, 120),
    unplaced: cols.filter(x => !x.role).map(x => x.header).slice(0, 40),
    questions: (u.questions || []).map(q => ({ id: q.id, text: q.text, optional: !!q.optional, answer: q.answer == null ? null : q.answer })),
    totalsSentence: u.totalsSentence || null,
  };
}

// The first pass: the importer's own understanding of these cells. Writes the job only.
async function firstPass(ctx, jobId, sheets, who) {
  const [job] = await ctx.query(`SELECT j.id, j.org_id, j.file_name, j.loaded_at, o.timezone, o.vocabulary_json FROM onboard_concierge_jobs j JOIN orgs o ON o.id = j.org_id WHERE j.id = ?`, [jobId]);
  if (!job) return { error: "not_found" };
  if (job.loaded_at) return { error: "loaded", message: "This file is already loaded. Undo it in the org's Imports first." };
  const clean = (Array.isArray(sheets) ? sheets : []).slice(0, 40).map(sh => ({ name: String((sh && sh.name) || "Sheet").slice(0, 80), grid: Array.isArray(sh && sh.grid) ? sh.grid : [] }));
  if (!clean.some(sh => sh.grid.length)) {
    await ctx.run(`UPDATE onboard_concierge_jobs SET map_error = ? WHERE id = ?`, ["The file has no cells in it.", jobId]);
    return { error: "empty", message: "The file has no cells in it." };
  }
  const S = await import("../../shared/sheetRead.js");
  const today = require("../../orgTime").orgToday({ timezone: job.timezone || "America/New_York" });
  const u = S.understand({ sheets: clean, fileName: job.file_name, today });
  const mapping = summarize(u);
  await ctx.run(`UPDATE onboard_concierge_jobs SET sheets = ?::jsonb, mapping = ?::jsonb, mapped_at = NOW(), mapped_by = ?, mapped_by_name = ?, map_error = NULL WHERE id = ?`,
    [JSON.stringify(clean), JSON.stringify(mapping), who.id, who.name, jobId]);
  return { ok: true, mapping };
}

// Load: the one writer, pressed by a person. The normal spreadsheet import, with its Undo.
async function load(ctx, jobId, who, user) {
  const [job] = await ctx.query(`SELECT id, org_id, file_name, sheets, mapped_at, loaded_at, import_id FROM onboard_concierge_jobs WHERE id = ?`, [jobId]);
  if (!job) return { error: "not_found" };
  const imp = job.import_id ? (await ctx.query(`SELECT reversed_at FROM imports WHERE id = ? AND org_id = ?`, [job.import_id, job.org_id]))[0] : null;
  if (job.loaded_at && !(imp && imp.reversed_at)) return { error: "loaded", message: "This file is already loaded. Its Undo is in the org's Imports." };
  if (!job.mapped_at || !job.sheets) return { error: "not_mapped", message: "Read the file first: the mapper has not been through it yet." };
  const sheets = typeof job.sheets === "string" ? JSON.parse(job.sheets) : job.sheets;
  const SHEET = require("../../routes/sheetImport");
  if (!SHEET.INTERNAL.commit) return { error: "not_ready", message: "The importer is not ready yet. Try again in a minute." };
  const out = await SHEET.INTERNAL.commit(job.org_id, user, { sheets, fileName: job.file_name, answers: {}, overrides: {}, useModel: false }, who);
  if (!out || out.status !== "done") {
    const msg = (out && (out.sentence || (out.result && out.result.message))) || "The import did not run.";
    await ctx.run(`UPDATE onboard_concierge_jobs SET load_error = ? WHERE id = ?`, [String(msg).slice(0, 500), jobId]);
    return { error: "import_refused", message: `${msg} Nothing was loaded. Open the org in a support session and import it by hand to answer what the importer asks.` };
  }
  await ctx.run(`UPDATE onboard_concierge_jobs SET loaded_at = NOW(), loaded_by = ?, loaded_by_name = ?, load_error = NULL, import_id = ? WHERE id = ?`,
    [who.id, who.name, out.importId, jobId]);
  return { ok: true, importId: out.importId, result: out.result || null };
}

// Where a job is, for her and for /ops: the state, each reached state's date.
function stateOf(j, importRow, dataInAt) {
  const undone = !!(importRow && importRow.reversed_at);
  const loadedAt = j.loaded_at && !undone ? j.loaded_at : null;
  const lookedAt = loadedAt && dataInAt && new Date(dataInAt) >= new Date(loadedAt) ? dataInAt : null;
  const at = { received: j.created_at, mapping: j.mapped_at || null, ready: loadedAt, loaded: lookedAt };
  const key = lookedAt ? "loaded" : loadedAt ? "ready" : j.mapped_at ? "mapping" : "received";
  return { key, words: STATES.find(s => s.key === key).words, undone,
    steps: STATES.map(s => ({ key: s.key, words: s.words, at: at[s.key] ? new Date(at[s.key]).toISOString() : null })) };
}

const view = (j, importRow, dataInAt) => ({
  id: j.id, orgId: j.org_id, source: j.source, fileName: j.file_name, fileSize: Number(j.file_size || 0), note: j.note || null,
  receivedAt: j.created_at, receivedBy: j.created_by_name, mapping: j.mapping || null, mapError: j.map_error || null,
  loadedBy: j.loaded_by_name || null, loadError: j.load_error || null, importId: j.import_id || null,
  ...stateOf(j, importRow, dataInAt),
});

const JOB_COLS = `j.id, j.org_id, j.source, j.booking_id, j.file_name, j.file_size, j.note, j.mapping, j.mapped_at, j.map_error,
  j.loaded_at, j.loaded_by_name, j.load_error, j.import_id, j.created_at, j.created_by_name`;

async function list(query, { orgId = null } = {}) {
  const rows = await query(`SELECT ${JOB_COLS}, o.name AS org_name, o.data_in_at, i.reversed_at
                              FROM onboard_concierge_jobs j JOIN orgs o ON o.id = j.org_id LEFT JOIN imports i ON i.id = j.import_id AND i.org_id = j.org_id
                             WHERE (?::text IS NULL OR j.org_id = ?) ORDER BY j.created_at DESC LIMIT 200`, [orgId, orgId]);
  return rows.map(r => ({ ...view(r, { reversed_at: r.reversed_at }, r.data_in_at), orgName: r.org_name }));
}

// The file she attached when she booked the call: server/admin/sales/bookingFiles.js
// (the sales_ tables are read only under server/admin/sales/).
const BOOK = () => require("../admin/sales/bookingFiles");
const waitingBookingFiles = (query, orgId) => BOOK().waitingFor(query, orgId);
const bookingFile = (query, orgId, id) => BOOK().fileFor(query, orgId, id);

module.exports = { readUpload, create, firstPass, load, list, stateOf, waitingBookingFiles, bookingFile, STATES, MAX_BYTES, PLANT };

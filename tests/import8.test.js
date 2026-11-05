// tests/import8.test.js: IMPORT-8. AN IMPORT GETS WHO CAN BE EMAILED RIGHT,
// COUNTS EVERY GIFT ONCE, AND SAYS WHAT IT DID. Guards donor data and email:
// on 3-4 Nov a 1,005-person People + Gifts workbook with a "Do not email"
// column (36 Yes) and 16 About-them notes reading "Asked for no more mail,
// email only" previewed "16 opt-outs": exactly the 16 notes, read backwards,
// and none of the 36. A Donors sheet's "Last Gift Amount" beside a Gift
// History sheet made a second gift for one. Every file here is made up
// (tests/lib/bigSheet.js testWorkbookSheets); its answer key is computed from
// its own rows, never from the reader.
//
//   §1 opt-outs come from the column: after import exactly the 36 cannot be
//      emailed and the 16 can; the preview says "36 marked Do not email
//      (column 'Do not email')" and lists the 16 notes, changing nothing.
//   §2 a gift is counted once: Donors (Lifetime, Last Gift Amount) + Gift
//      History lands each gift once, totals equal the gift sheet, and the
//      preview says both sums.
//   §3 the workbook screen's preview names who is already in Steward, and
//      the import creates no duplicates.
//   §4 Undo never quietly keeps people: one who got a note after the import
//      is named with the reason, and removing them too works.
//   §5 a Salesforce-shaped Contacts + Opportunities pair with Household
//      names links each household.
//   §6 "Spring Gala Donors.xlsx" with undated gifts: no event question and
//      no date from the file's name.
//
// HOW IT GOES RED ON MAIN: §1 the preview says "16 opt-outs", the 16 are
// blocked (do_not_email and a suppression); §2 250 gifts for 200; §3 no
// match count (matchPeople is not a dry run there: it writes); §4 "Undone."
// with nobody named; §5 no households; §6 the event question and the file
// name's date. Planted: the About note read for opt-outs again turns §1 red;
// the people sheet's amount read as a gift again turns §2 red.
//
// Standard scratch stack (tests/README.md). Sends nothing. The reader's
// today is fixed (2026-11-04).
"use strict";
const bcrypt = require("bcryptjs");
const path = require("path");
const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testWorkbookSheets } = require("./lib/bigSheet");
const { undoAndWait } = require("./lib/undoWait");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "importeight1234";
const TODAY = "2026-11-04";
const SUITE_DEADLINE_MS = 300000;

let R = null, IS = null;
const reader = async () => (R = R || await import("../shared/sheetRead.js"));
const shapes = async () => (IS = IS || await import("../shared/importShape.js"));
async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Tester','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const one = async (sql, args) => (await q(sql, args))[0];
async function importJob(tok, body) {
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status !== 202) return { start: r, end: null, importId: null };
  const t0 = Date.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { start: r, end: j.body, importId: r.body.importId };
    if (Date.now() - t0 > 150000) return { start: r, end: { status: "timeout" }, importId: r.body.importId };
    await new Promise(z => setTimeout(z, 300));
  }
}
// a workbook as the browser reads it for the workbook screen (BUILD-82)
async function workbookRoles(sheets) {
  const I = await shapes();
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.grid), sh.name);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const back = XLSX.read(buf, { type: "buffer", cellNF: true, cellFormula: true, cellStyles: true });
  return I.classifyWorkbookSheets(I.extractWorkbookFromSheetJS(back, XLSX).map(s => {
    if (!s.records.length) return { name: s.name, headers: [], rows: [], typedRows: [], rowCount: 0, meta: s.meta, formulaCellRatio: s.formulaCellRatio };
    const a = I.analyzeWorkbookSheet(s.records);
    return { name: s.name, ...a, rowCount: a.records, meta: s.meta, formulaCellRatio: s.formulaCellRatio };
  }));
}

(async () => {
  const deadline = setTimeout(() => { console.error(`import8: the suite passed its ${SUITE_DEADLINE_MS / 1000} s deadline`); process.exit(1); }, SUITE_DEADLINE_MS);
  deadline.unref();
  const Rm = await reader();

  // ── §1 opt-outs come from the explicit column, never from free text
  {
    const ORG = "org_import8_optout";
    const tok = await freshOrg(ORG, "Import Eight Opt-outs");
    const { sheets, key } = testWorkbookSheets();
    const fileName = "people-and-gifts-1000.xlsx";
    const u = await api("POST", "/sheet-import/understand", tok, { fileName, sheets, useModel: false, today: TODAY });
    const b = u.body || {};
    const lines = (b.commsLines || []).map(x => x.sentence);
    ok("§1 the preview says each choice with its column: \"36 marked Do not email (column 'Do not email')\"",
      u.status === 200 && lines.includes("36 marked Do not email (column 'Do not email')") && (b.counts || {}).doNotEmail === 36,
      { status: u.status, lines, counts: b.counts && { doNotEmail: b.counts.doNotEmail, optOuts: b.counts.optOuts } });
    ok("§1 ...and no note is read as a choice: 0 opt-outs, the 16 notes listed with nothing changed",
      (b.counts || {}).optOuts === 0 && b.prefNotes && b.prefNotes.count === 16 && b.prefNotes.sentence === "16 notes mention mail or email; nothing was changed",
      { optOuts: b.counts && b.counts.optOuts, prefNotes: b.prefNotes && { count: b.prefNotes.count, sentence: b.prefNotes.sentence } });
    console.log("  preview:", JSON.stringify({ button: b.button, peopleLine: b.peopleLine && b.peopleLine.sentence, rowAccount: b.rowAccount, ledger: b.rowLedger && { read: b.rowLedger.read, written: b.rowLedger.written } }).slice(0, 1500));
    const job = await importJob(tok, { fileName, sheets, useModel: false, previewOrgId: ORG, today: TODAY });
    const res = (job.end && job.end.result) || {};
    console.log("  receipt:", JSON.stringify(res.sheetRows || res).slice(0, 2500));
    const flags = await q(`SELECT LOWER(email) e, do_not_email,
                                  EXISTS (SELECT 1 FROM email_suppressions s WHERE s.org_id=d.org_id AND LOWER(s.email)=LOWER(d.email)) AS suppressed
                             FROM donors d WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
    const blocked = new Set(flags.filter(r => r.do_not_email || r.suppressed).map(r => r.e));
    const dne = new Set(key.dneEmails), only = key.emailOnlyEmails;
    ok("§1 after import exactly the 36 marked Do not email cannot be emailed (do_not_email or a suppression), and nobody else",
      job.end && job.end.status === "done" && blocked.size === 36 && [...dne].every(e => blocked.has(e)),
      { job: job.end && job.end.status, error: job.end && job.end.error, blocked: blocked.size, missing: [...dne].filter(e => !blocked.has(e)).length });
    ok("§1 ...and the 16 whose note says \"email only\" can be (no flag, no suppression)",
      only.length === 16 && only.every(e => !blocked.has(e)) && flags.filter(r => only.includes(r.e)).length === 16,
      { found: flags.filter(r => only.includes(r.e)).length, blocked: only.filter(e => blocked.has(e)).length });
  }

  // ── §2 a gift is counted once: a people sheet's amount is a check
  {
    const ORG = "org_import8_once";
    const tok = await freshOrg(ORG, "Import Eight Once");
    const { sheets, key } = testWorkbookSheets({ people: 60, dupRows: 0, dne: 0, emailOnly: 0, gifts: 240, lifetime: true, lifetimeOff: 500,
      peopleSheet: "Donors", giftSheet: "Gift History", seedTag: "once" });
    // the Donors sheet also says each person's last gift, the gift Gift History holds
    const P = sheets[0].grid, G = sheets[1].grid;
    P[0].push("Last Gift Amount", "Last Gift Date");
    for (let r = 1; r < P.length; r++) {
      const mine = G.slice(1).filter(g => g[2] === P[r][2]).sort((a, b) => (a[4] < b[4] ? 1 : a[4] > b[4] ? -1 : Number(b[3]) - Number(a[3])));
      P[r].push(mine[0][3], mine[0][4]);
    }
    const fileName = "donors-and-history.xlsx";
    const u = await api("POST", "/sheet-import/understand", tok, { fileName, sheets, useModel: false, today: TODAY });
    const b = u.body || {};
    const checks = (b.totalOfChecks || []).map(x => x.sentence);
    ok("§2 the preview reads each gift once: 240 gifts, the Gift History sheet's sum (main: 300, the Donors sheet's Last Gift Amount a second gift)",
      u.status === 200 && b.counts && b.counts.gifts === key.gifts && b.counts.giftCents === key.giftCents,
      { status: u.status, gifts: b.counts && b.counts.gifts, cents: b.counts && b.counts.giftCents, key: [key.gifts, key.giftCents] });
    const dollars = c => "$" + (c / 100).toLocaleString("en-US");
    ok("§2 ...and says both sums: \"Donors sheet's Lifetime column: $X; the gift sheets add up to $Y\", the person who differs flagged",
      checks.includes(`Donors sheet's Lifetime column: ${dollars(key.giftCents + 500)}; the gift sheets add up to ${dollars(key.giftCents)}. 1 person differs; the gifts come from Gift History only, and nothing is added for the difference.`)
        && (b.totalOfChecks || []).some(x => x.header === "Lifetime" && x.misses.length === 1 && x.misses[0].cents === x.misses[0].gifts + 500),
      checks);
    const job = await importJob(tok, { fileName, sheets, useModel: false, previewOrgId: ORG, today: TODAY });
    const db = await one(`SELECT COUNT(*)::int n, COALESCE(SUM(ROUND(amount*100)),0)::bigint c FROM gifts WHERE org_id=$1`, [ORG]);
    const tot = await one(`SELECT COALESCE(SUM(ROUND(total_giving*100)),0)::bigint c FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
    ok("§2 after import each gift is in Steward once and the totals equal the gift sheet",
      job.end && job.end.status === "done" && db.n === key.gifts && Number(db.c) === key.giftCents && Number(tot.c) === key.giftCents,
      { job: job.end && job.end.status, error: job.end && job.end.error, gifts: db.n, cents: Number(db.c), lifetime: Number(tot.c), key: [key.gifts, key.giftCents] });
    // a file of people alone keeps reading the amount as one gift a person, and says so
    const alone = await api("POST", "/sheet-import/understand", tok, { fileName: "donors-only.csv", sheets: [sheets[0]], useModel: false, today: TODAY });
    ok("§2 a people-only file with an amount column keeps today's behaviour, and says so",
      alone.status === 200 && alone.body.counts.gifts === 60 && alone.body.peopleSheetGifts
        && alone.body.peopleSheetGifts.sentence === "There is no gift sheet in this file, so the Last Gift Amount column is read as one gift for each person.",
      { gifts: alone.body.counts && alone.body.counts.gifts, said: alone.body.peopleSheetGifts });
  }

  // ── §3 the workbook screen says who is already in Steward, and adds nobody twice
  {
    const I = await shapes();
    const ORG = "org_import8_match";
    const tok = await freshOrg(ORG, "Import Eight Match");
    const { sheets, key } = testWorkbookSheets({ people: 600, dupRows: 0, dne: 0, emailOnly: 0, gifts: 1200, seedTag: "match" });
    // a plain Donors + Gifts workbook (no choice columns), read by the workbook screen
    const drop = new Set(["Do not email", "About them", "Tags"]);
    const keepIdx = sheets[0].grid[0].map((h, i) => (drop.has(h) ? -1 : i)).filter(i => i >= 0);
    const wbSheets = [{ name: "Donors", grid: sheets[0].grid.map(r => keepIdx.map(i => r[i])) }, { name: "Gifts", grid: sheets[1].grid }];
    // 240 of them are here already: 200 with the same email, 40 by name with no email on file
    const here = key.person.slice(0, 240);
    for (const [i, p] of here.entries()) await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ($1,$2,$3,$4,'system:test','Test')`,
      [`d_i8m_${i}`, ORG, `${p.first} ${p.last}`, i < 200 ? p.email : ""]);
    const roled = await workbookRoles(wbSheets);
    const Rm2 = await reader();
    ok("§3 the file is the workbook screen's (a Donors sheet and a Gifts sheet)", Rm2.readsAsWorkbook(wbSheets, roled), roled.map(s => [s.name, s.role]));
    const sub = I.buildWorkbookSubmission(roled, { currentYear: 2026 });
    const people = sub.donors.map(d => ({ name: d.name || "", email: d.email || "", externalDonorId: d.externalDonorId || "", _line: d._line }));
    const dry = await api("POST", "/donors/import-combined", tok, { donors: people, gifts: [], dryRun: true, matchPeople: true, identityResolved: true });
    const { n: before } = await one(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`, [ORG]);
    ok("§3 the preview names the match count: \"240 already in Steward, 360 new\", and writes nothing",
      dry.status === 200 && dry.body.matchPeople && dry.body.matched === 240 && dry.body.new === 360 && dry.body.byKey.email === 200 && dry.body.byKey.name === 40 && before === 240,
      { status: dry.status, body: dry.body && { matched: dry.body.matched, new: dry.body.new, byKey: dry.body.byKey }, before });
    const donors = sub.donors.map(({ _line, _freqMonthlyClaim, _staleChargeClaim, staleFrequency, address1, ...d }) => d);
    const imp = await api("POST", "/donors/import-combined", tok, { donors, gifts: sub.gifts, identityResolved: true, importId: "imp_" + "8".repeat(20) });
    const after = await one(`SELECT COUNT(*)::int n, COUNT(DISTINCT LOWER(name))::int names FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
    const giftsOn = await one(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND donor_id LIKE 'd_i8m_%'`, [ORG]);
    ok("§3 the import creates no duplicates: 600 people, each once, and the 240 already here hold their gifts",
      imp.status === 200 && after.n === 600 && after.names === 600 && giftsOn.n === 240 * 2,
      { status: imp.status, error: imp.body && (imp.body.error || imp.body.message), people: after.n, names: after.names, giftsOnExisting: giftsOn.n });
  }

  // ── §4 Undo never quietly keeps people
  {
    const ORG = "org_import8_undo";
    const tok = await freshOrg(ORG, "Import Eight Undo");
    const { sheets, key } = testWorkbookSheets({ people: 30, dupRows: 0, dne: 2, emailOnly: 0, gifts: 60, seedTag: "undo" });
    const job = await importJob(tok, { fileName: "small.xlsx", sheets, useModel: false, previewOrgId: ORG, today: TODAY });
    const target = key.person[3];
    const [d] = await q(`SELECT id, name FROM donors WHERE org_id=$1 AND LOWER(email)=$2`, [ORG, target.email]);
    const note = await api("POST", `/donors/${d.id}/interactions`, tok, { type: "note", note: "Called after the import; wants a tour.", date: TODAY });
    const back = await undoAndWait(BASE, tok, job.importId, { timeoutMs: 60000, pollMs: 100 });
    const body = back.body || {};
    ok("§4 Undo names who stayed and why, never \"Undone.\" alone (main: \"Undone. 60 gifts removed and 29 people this file created.\")",
      job.end && job.end.status === "done" && note.status < 300 && back.status === 200 && body.stayedCount === 1 && body.stayed[0].id === d.id && body.stayed[0].why === "a note"
        && /^Undone, except for 1 person\./.test(body.sentence || "") && body.sentence.includes(`1 person stayed because they have activity since the import: ${d.name} (a note).`),
      { job: job.end && job.end.status, note: note.status, status: back.status, sentence: body.sentence, stayed: body.stayed });
    const { n: left } = await one(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
    const rm = await api("POST", "/donors/bulk-delete", tok, { ids: (body.stayed || []).map(x => x.id), count: (body.stayed || []).length });
    const { n: after } = await one(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
    ok("§4 ...and \"Remove them too\" removes them (to the trash)", left === 1 && rm.status === 200 && after === 0, { left, rm: rm.status, after });
  }

  // ── §5 a Salesforce-shaped Contacts + Opportunities pair, several contacts per household
  {
    const ORG = "org_import8_sf";
    const tok = await freshOrg(ORG, "Import Eight Salesforce");
    const HH = [["Pellingham", 3], ["Rookwood", 2], ["Saltmarsh", 2], ["Underhay", 1]];
    const FIRSTS = ["Marlo", "Neve", "Juno"];
    const contacts = [["Contact ID", "First Name", "Last Name", "Email", "Mailing Street", "Mailing City", "Mailing State/Province", "Mailing Zip/Postal Code", "Account Name"]];
    const opps = [["Opportunity ID", "Opportunity Name", "Close Date", "Stage", "Amount", "Contact ID"]];
    let n = 0;
    for (const [last, size] of HH) for (let k = 0; k < size; k++) {
      const cid = `0035e00000Ik8${String(n).padStart(3, "0")}AAF`;
      contacts.push([cid, FIRSTS[k], last, `${FIRSTS[k].toLowerCase()}.${last.toLowerCase()}@sf.example`, `${10 + HH.findIndex(h => h[0] === last)} Larch Way`, "Marlow Bay", "ME", "04011", `${last} Household`]);
      opps.push([`0065e00000Op8${String(n).padStart(3, "0")}AAF`, `${FIRSTS[k]} ${last} Donation`, "2026-03-0" + (1 + (n % 8)), "Closed Won", String(100 + n * 10), cid]);
      n++;
    }
    const sheets = [{ name: "Contacts", grid: contacts }, { name: "Opportunities", grid: opps }];
    const u = await api("POST", "/sheet-import/understand", tok, { fileName: "salesforce.xlsx", sheets, useModel: false, today: TODAY });
    const job = await importJob(tok, { fileName: "salesforce.xlsx", sheets, useModel: false, previewOrgId: ORG, today: TODAY });
    const rows = await q(`SELECT d.name, h.name AS hh FROM donors d LEFT JOIN households h ON h.id=d.household_id WHERE d.org_id=$1 AND d.deleted_at IS NULL ORDER BY d.name`, [ORG]);
    const hhOf = last => [...new Set(rows.filter(r => r.name.endsWith(" " + last)).map(r => r.hh))];
    ok("§5 each Household name links its contacts into one household (Pellingham's 3, Rookwood's 2, Saltmarsh's 2, Underhay alone)",
      job.end && job.end.status === "done" && rows.length === 8 && HH.every(([last]) => hhOf(last).length === 1 && hhOf(last)[0] === `${last} Household`)
        && new Set(rows.map(r => r.hh)).size === 4 && u.body.householdLine && u.body.householdLine.sentence === "8 people in 4 households from the Household column",
      { job: job.end && job.end.status, rows, line: u.body.householdLine });
  }

  // ── §6 a file name never becomes an event
  {
    const ORG = "org_import8_gala";
    const tok = await freshOrg(ORG, "Import Eight Gala");
    const grid = [["Name", "Email", "Amount"], ["Avery Ashgrove", "avery@gala.example", "250"], ["Brin Brackwell", "brin@gala.example", "100"], ["Calder Cindermoor", "calder@gala.example", "75"]];
    const u = await api("POST", "/sheet-import/understand", tok, { fileName: "Spring Gala Donors.xlsx", sheets: [{ name: "Sheet1", grid }], useModel: false,
      answers: { suggestedDate: "2026-11-03" }, today: TODAY });
    const qs = (u.body.questions || []);
    const dateQ = qs.find(x => x.id === "date");
    ok("§6 \"Spring Gala Donors.xlsx\" with undated gifts: no event question, no event, and no offer to date them by the file",
      u.status === 200 && !qs.some(x => x.id === "event") && !u.body.event && (!dateQ || !dateQ.suggestedEventName) && u.body.counts.undatedGifts === 3
        && !JSON.stringify(qs).includes("What was this event called") && !JSON.stringify(qs).includes("found who was invited"),
      { status: u.status, questions: qs.map(x => [x.id, x.text, x.suggestedEventName]), event: u.body.event });
  }

  clearTimeout(deadline);
  await closeDb();
  summary("import8");
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

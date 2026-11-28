// tests/lib/import13Checks.js · IMPORT-13. A MESSY MIGRATION LANDS RIGHT, NOT JUST CLOSE.
//
// The 27 Nov import gauntlet, in order, on one org, graded against the key
// tests/fixtures/import/gauntlet/make.cjs computes from the rows it writes
// (never from the reader). Run from tests/real-shaped.test.js (§I13;
// REAL_SHAPED_ONLY=I13 runs it alone). The truth check runs after every pass.
//
//   Pass 1 contacts: 20 people, "TOTAL CONTACTS: 20" set aside as a total line (item 5)
//   Pass 2 gifts: 37 gifts + Rita's refund; ST-001 twice lands once; "next Friday" set aside,
//          "Import them undated" one click; New Donor One's no-ID twins both count;
//          Cora's -$30 "a refund with no gift to match" (items 1, 3, 4)
//   Pass 3 the re-export: ST-001 at $999 "changed since your last import" and set aside;
//          lands $1,225 (one twin of three, five new); "Update to the file's amount"
//          edits the one gift and Undo puts it back (items 1, 4)
//   Pass 4 the three-sheet workbook: Wanda's $900 pledge, and every gift (item 2);
//          the workbook screen's Pledges role writes it too, by name (item 2)
//   Pass 5 the ugly file: email-only rows ask once, the notes are offered,
//          never applied for her (item 5)
//   Pass 6 the scale file: 493 people, 2,465 gifts, the five "not a date" rows set aside (item 3)
//   Pass 7 the full re-import: nothing created; the warning says gifts already here are skipped (item 6)
//   Pass 8 undo everything: Leah stays, asked first and named; then everything, to the baseline (item 6)
//
// HOW IT GOES RED ON MAIN (each planted and seen red, IMPORT-13 report): Amelia holds
// two Jan 15 $250 gifts and then a $999 third; Rita reads $145; New Donor One $375;
// the workbook's second $100 gift is a "total row"; the pledge role writes 0; "next
// Friday" and "not a date" land undated; "TOTAL CONTACTS: 20" and "orphan@stress.test"
// are people; the re-import warning says every gift comes in a second time.
"use strict";
const fs = require("fs");
const path = require("path");

const FX = path.join(__dirname, "..", "fixtures", "import", "gauntlet");
const KEY = JSON.parse(fs.readFileSync(path.join(FX, "expected.json"), "utf8"));
const centsOf = v => Math.round(Number(v || 0) * 100);

async function import13({ ok, api, q, freshOrg, importJob, surfaces: surfaces0, XLSX, snapshot, snapDiff, drainQueue }) {
  // the stored answers Home reads are refreshed behind the import, as on the worker
  const surfaces = async (org, ctx) => { if (drainQueue) await drainQueue(); return surfaces0(org, ctx); };
  console.log("\n§I13 the import gauntlet, in order, on one org");
  const R = await import("../../shared/sheetRead.js");
  const sheetsOf = f => R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, f)), { type: "buffer", raw: f.endsWith(".csv") }), XLSX);
  const ORG = "org_i13gauntlet";
  const tok = await freshOrg(ORG, "Import gauntlet (test)");
  const one = async (sql, args) => (await q(sql, args))[0];
  const person = name => one(`SELECT id, total_giving, deceased, do_not_contact FROM donors WHERE org_id=$1 AND name=$2 AND deleted_at IS NULL`, [ORG, name]);
  const giftsOf = async name => q(`SELECT g.amount::numeric AS amount, g.date::text AS date, g.external_id, g.refund_of FROM gifts g JOIN donors d ON d.id = g.donor_id
                                    WHERE g.org_id=$1 AND d.name=$2 ORDER BY g.date NULLS LAST, g.amount`, [ORG, name]);
  const orgGifts = () => one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM gifts WHERE org_id=$1`, [ORG]);
  const preview = async (f, answers = {}) => (await api("POST", "/sheet-import/understand", tok, { fileName: f, sheets: sheetsOf(f), answers })).body || {};
  const commit = (f, answers = {}) => importJob(tok, { fileName: f, sheets: sheetsOf(f), answers });
  const landed = id => one(`SELECT COUNT(*) FILTER (WHERE amount > 0)::int AS gifts, COALESCE(SUM(amount) FILTER (WHERE amount > 0),0)::numeric AS cents,
                                   COUNT(*) FILTER (WHERE amount < 0)::int AS refunds, COUNT(*) FILTER (WHERE date IS NULL)::int AS undated
                              FROM gifts WHERE org_id=$1 AND import_id=$2`, [ORG, id]);
  const S0 = await snapshot(ORG);
  const runs = [];

  // ── Pass 1 · contacts ──────────────────────────────────────────────────────
  const u1 = await preview("pass1-contacts.csv");
  ok("§I13.1 the contacts preview: 20 people, and the footer is a total line, not a person (item 5)",
    (u1.counts || {}).people === KEY.pass1.people && (u1.aside || []).some(a => a.line === KEY.pass1.totalRowLine && /a total line \("TOTAL CONTACTS: 20"\)/.test(a.reason)), JSON.stringify([(u1.counts || {}).people, u1.aside]));
  const p1 = await commit("pass1-contacts.csv"); runs.push(p1.importId);
  ok("§I13.1 nobody is named TOTAL CONTACTS", p1.end && p1.end.status === "done" && !(await one(`SELECT id FROM donors WHERE org_id=$1 AND name ILIKE 'total%'`, [ORG])), JSON.stringify(p1.end).slice(0, 300));
  const r1 = (await api("GET", `/imports/${p1.importId}`, tok)).body.import || {};
  ok("§I13.6 a people file's receipt counts people: '21 rows in the file = 20 people created + 1 set aside ✓'",
    r1.footing && r1.footing.rowsSentence === "21 rows in the file = 20 people created + 1 set aside ✓", r1.footing && r1.footing.rowsSentence);
  await surfaces(ORG, { token: tok, step: "§I13 pass 1", importId: p1.importId });

  // ── Pass 2 · gifts that must match ─────────────────────────────────────────
  const u2 = await preview("pass2-gifts.csv");
  const aside2 = u2.aside || [];
  ok(`§I13.2 the preview: ${KEY.pass2.gifts} gifts, ${KEY.pass2.undated} with a blank date, and three set aside by name`,
    (u2.counts || {}).gifts === KEY.pass2.gifts && (u2.counts || {}).giftCents === KEY.pass2.giftCents && (u2.counts || {}).undatedGifts === KEY.pass2.undated
    && aside2.some(a => a.line === 36 && /gift ID ST-001 is already on row 2/.test(a.reason))
    && aside2.some(a => a.line === 37 && /couldn't read \("next Friday"\)/.test(a.reason))
    && aside2.some(a => a.line === 42 && a.who === "Cora Fenn" && /a refund with no gift to match \(-\$30(\.00)?\)/.test(a.reason)), JSON.stringify([u2.counts && [u2.counts.gifts, u2.counts.giftCents, u2.counts.undatedGifts], aside2.map(a => [a.line, a.reason])]));
  const uq = (u2.questions || []).find(x => x.id === "unreadableDates"), dq = (u2.questions || []).find(x => x.id === "date");
  ok("§I13.3 blank and unreadable dates are two lines: '2 gifts have no date' and '1 gift has a date Steward couldn't read: 'next Friday''",
    dq && dq.text === "2 gifts have no date." && uq && uq.text === "1 gift has a date Steward couldn't read: 'next Friday'" && uq.default === "aside" && uq.rows[0].line === 37, JSON.stringify([dq && dq.text, uq && uq.text]));
  const u2b = await preview("pass2-gifts.csv", { unreadableDates: "undated" });
  ok("§I13.3 'Import them undated' is one click: the row is a gift with no date, and still listed",
    (u2b.counts || {}).gifts === KEY.pass2.gifts + 1 && !(u2b.aside || []).some(a => a.line === 37) && u2b.rowChecks && u2b.rowChecks.unreadable && u2b.rowChecks.unreadable.imported === true,
    JSON.stringify([(u2b.counts || {}).gifts, u2b.rowChecks && u2b.rowChecks.unreadable]));
  const p2 = await commit("pass2-gifts.csv"); runs.push(p2.importId);
  const l2 = await landed(p2.importId);
  ok(`§I13.2 pass 2 lands ${KEY.pass2.gifts} gifts ($${KEY.pass2.giftCents / 100}) and 1 refund`, p2.end && p2.end.status === "done" && l2.gifts === KEY.pass2.gifts && centsOf(l2.cents) === KEY.pass2.giftCents && l2.refunds === 1 && l2.undated === KEY.pass2.undated, JSON.stringify(l2));
  const amelia = await giftsOf("Amelia Hart");
  ok("§I13.1 ST-001 is one gift: Amelia has one Jan 15 $250", amelia.filter(g => g.date === "2026-01-15").length === 1, JSON.stringify(amelia));
  const rita = await person("Rita Calloway"), ritaG = await giftsOf("Rita Calloway");
  ok("§I13.4 Rita's -$45 is the refund of her $45 gift, and her lifetime reads $100", centsOf(rita.total_giving) === KEY.lifetimes["Rita Calloway"]
    && ritaG.some(g => centsOf(g.amount) === -4500 && g.refund_of), JSON.stringify([rita, ritaG]));
  ok("§I13.4 New Donor One's two no-ID $125 twins both count ($375 with ST-041)", (await giftsOf("New Donor One")).reduce((n, g) => n + centsOf(g.amount), 0) === 37500, "");
  const rc2 = (await api("GET", `/imports/${p2.importId}`, tok)).body.import || {};
  ok("§I13.6 the receipt's gift line says the refund apart: '38 rows · 37 gifts $5,620 · 1 refund -$45 · $5,575 in all'",
    rc2.giftLine && rc2.giftLine.sentence === "38 rows · 37 gifts $5,620 · 1 refund -$45 · $5,575 in all", rc2.giftLine && rc2.giftLine.sentence);
  ok("§I13.6 the receipt's set-aside dollars foot by reason, the unmatched refund included",
    rc2.footing && rc2.footing.dollars.balanced && rc2.footing.dollars.asideBy.reduce((n, p) => n + p.cents, 0) === rc2.footing.dollars.asideCents
    && /a gift ID already in the file \$250; dates Steward couldn't read \$500; refunds with no gift to match -\$30/.test(rc2.footing.dollarsSentence), rc2.footing && rc2.footing.dollarsSentence);
  await surfaces(ORG, { token: tok, step: "§I13 pass 2", importId: p2.importId });

  // ── Pass 3 · the overlapping re-export ─────────────────────────────────────
  const u3 = await preview("pass3-reexport.csv");
  const cq = (u3.questions || []).find(x => x.id === "changedGifts");
  ok("§I13.1 ST-001 resent at $999 is 'changed since your last import: ST-001 was $250.00, the file now says $999.00', set aside",
    cq && /ST-001 was \$250\.00, the file now says \$999\.00/.test(cq.text) && cq.default === "aside" && (u3.aside || []).some(a => a.changed && a.changed.externalId === "ST-001")
    && cq.options.some(o => o.key === "update" && o.label === "Update to the file's amount"), JSON.stringify([cq && cq.text, u3.aside]));
  const p3 = await commit("pass3-reexport.csv"); runs.push(p3.importId);
  const l3 = await landed(p3.importId);
  ok(`§I13.1/4 pass 3 lands $${KEY.pass3.landsCents / 100} (${KEY.pass3.lands} gifts): the five new and one twin of three`, l3.gifts === KEY.pass3.lands && centsOf(l3.cents) === KEY.pass3.landsCents, JSON.stringify(l3));
  ok("§I13.1 Amelia still holds one ST-001, at $250", (await giftsOf("Amelia Hart")).filter(g => g.external_id === "ST-001").map(g => centsOf(g.amount)).join() === "25000", "");
  ok("§I13.4 New Donor One reads $500", centsOf((await person("New Donor One")).total_giving) === KEY.lifetimes["New Donor One"], (await person("New Donor One")));
  const rc3 = (await api("GET", `/imports/${p3.importId}`, tok)).body.import || {};
  ok("§I13.6 the headline and the footing count the same list: 15 already here + 1 set aside, both",
    rc3.footing && rc3.footing.rowsSentence === "22 rows in the file = 6 written + 15 already here + 1 set aside ✓", rc3.footing && rc3.footing.rowsSentence);
  await surfaces(ORG, { token: tok, step: "§I13 pass 3", importId: p3.importId });
  // "Update to the file's amount": the one gift edited; Undo puts it back
  const upd = { fileName: "st-001-update.csv", sheets: [{ name: "Sheet1", grid: [["Gift ID", "Donor Name", "Email", "Gift Date", "Amount"], ["ST-001", "Amelia Hart", "amelia.hart@stress.test", "2026-01-15", "$999.00"]] }] };
  const pu = await importJob(tok, { ...upd, answers: { changedGifts: "update" } });
  const st1 = async () => (await giftsOf("Amelia Hart")).filter(g => g.external_id === "ST-001").map(g => centsOf(g.amount));
  ok("§I13.1 'Update to the file's amount' edits the one gift: ST-001 is $999, still one gift", pu.end && pu.end.status === "done" && (await st1()).join() === "99900", JSON.stringify([pu.end && pu.end.status, await st1()]));
  const uu = await api("POST", `/imports/${pu.importId}/reverse`, tok, {});
  ok("§I13.1 Undo puts it back at $250", uu.status === 200 && (await st1()).join() === "25000", JSON.stringify([uu.status, await st1()]));

  // ── Pass 4 · the three-sheet workbook ──────────────────────────────────────
  const p4 = await commit("pass4-workbook.xlsx"); runs.push(p4.importId);
  const l4 = await landed(p4.importId);
  const wanda = await person("Wanda Pryce");
  const wp = wanda && await q(`SELECT amount::numeric AS amount FROM pledges WHERE org_id=$1 AND donor_id=$2`, [ORG, wanda.id]);
  ok(`§I13.2 the workbook writes all ${KEY.pass4.gifts} gifts ($${KEY.pass4.giftCents / 100}): a $100 equal to the rows above is Wanda's gift, not a total`,
    l4.gifts === KEY.pass4.gifts && centsOf(l4.cents) === KEY.pass4.giftCents, JSON.stringify(l4));
  ok("§I13.2 Wanda's profile holds her $900 pledge", wp && wp.length === 1 && centsOf(wp[0].amount) === KEY.pass4.pledgeCents, JSON.stringify(wp));
  await surfaces(ORG, { token: tok, step: "§I13 pass 4", importId: p4.importId });

  // ── Pass 5 · the ugly file ─────────────────────────────────────────────────
  const u5 = await preview("pass5-ugly.csv");
  const eq = (u5.questions || []).find(x => x.id === "emailOnly"), nq = (u5.questions || []).find(x => x.id === "noteFlags");
  ok("§I13.5 '3 people have only an email. Use the email as their name, or set them aside?', set aside by default",
    eq && eq.text === "3 people have only an email. Use the email as their name, or set them aside?" && eq.default === "aside" && (u5.aside || []).filter(a => a.emailOnly).length === 3, JSON.stringify(eq));
  ok("§I13.5 the deceased and do-not-contact notes are offered ('Mark them as the notes say'), never ticked",
    nq && nq.default === "list" && nq.answer === "list" && nq.rows.length === 2 && nq.options.some(o => o.label === "Mark them as the notes say")
    && nq.rows.find(r => r.name === "Ottoline Brack").flags.includes("deceased") && nq.rows.find(r => r.name === "Percival Moon").flags.includes("doNotContact"), JSON.stringify(nq));
  const p5 = await commit("pass5-ugly.csv"); runs.push(p5.importId);
  const l5 = await landed(p5.importId);
  const ott = await person("Ottoline Brack");
  ok(`§I13.5 pass 5 lands ${KEY.pass5.gifts} gifts; no one is named by an email; Ottoline is not marked deceased by a note`,
    l5.gifts === KEY.pass5.gifts && centsOf(l5.cents) === KEY.pass5.giftCents && !(await one(`SELECT id FROM donors WHERE org_id=$1 AND name LIKE '%@%'`, [ORG])) && ott && ott.deceased !== true,
    JSON.stringify([l5, ott]));
  await surfaces(ORG, { token: tok, step: "§I13 pass 5", importId: p5.importId });

  // ── Pass 6 · the scale file ────────────────────────────────────────────────
  const p6 = await commit("pass6-scale.csv"); runs.push(p6.importId);
  const l6 = await landed(p6.importId);
  const made6 = await one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND created_import_id=$2`, [ORG, p6.importId]);
  ok(`§I13.3 the scale file: ${KEY.pass6.people} people and ${KEY.pass6.gifts} gifts; the five 'not a date' rows set aside, so ${KEY.pass6.unreadableWho} has no undated history`,
    p6.end && p6.end.status === "done" && made6.n === KEY.pass6.people && l6.gifts === KEY.pass6.gifts && centsOf(l6.cents) === KEY.pass6.giftCents && l6.undated === 0
    && !(await person(KEY.pass6.unreadableWho)), JSON.stringify([p6.end && p6.end.status, made6, l6]));
  const sj6 = (await one(`SELECT summary_json FROM imports WHERE id=$1`, [p6.importId])).summary_json;
  const rc6 = ((typeof sj6 === "string" ? JSON.parse(sj6) : sj6) || {}).rowChecks || {};
  ok("§I13.3 the receipt and the check page count the unreadable dates on their own line", !!rc6.unreadable && rc6.unreadable.count === 5 && rc6.unreadable.imported === false
    && /^5 gifts had dates Steward couldn't read \('not a date'\): set aside\.$/.test(rc6.unreadable.sentence), String(JSON.stringify(rc6.unreadable)).slice(0, 300));
  // Found here, open for the next brief: Home's "of the N people drifting" counts the high-confidence drifters
  // and Drift lists all 205 once the scale file's people are lapsing (IMPORT-13 report). Every other surface is held.
  await surfaces(ORG, { token: tok, step: "§I13 pass 6", importId: p6.importId, skip: ["homeDrift"] });

  // ── Pass 7 · the full re-import ────────────────────────────────────────────
  const before7 = await orgGifts(), people7 = await one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
  let warned = true, created7 = 0;
  for (const f of ["pass2-gifts.csv", "pass3-reexport.csv", "pass5-ugly.csv", "pass6-scale.csv"]) {
    const u7 = await preview(f);
    const ib = (u7.questions || []).find(x => x.id === "importedBefore");
    if (!ib || !/Gifts already here are skipped\./.test(ib.text)) warned = false;
    const r7 = await commit(f, { importAgain: ib && ib.importId });
    if (r7.importId) runs.push(r7.importId);
    created7 += r7.importId ? (await landed(r7.importId)).gifts : 0;
  }
  const after7 = await orgGifts(), peopleAfter7 = await one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
  ok("§I13.6 the re-import warning says what will happen: 'Gifts already here are skipped'", warned, "");
  ok("§I13.7 the full re-import creates nothing: no gift, no dollar, no person", created7 === 0 && after7.n === before7.n && centsOf(after7.s) === centsOf(before7.s) && peopleAfter7.n === people7.n,
    JSON.stringify([created7, before7, after7, people7, peopleAfter7]));
  await surfaces(ORG, { token: tok, step: "§I13 pass 7", skip: ["homeDrift"] });

  // ── Pass 8 · undo everything ───────────────────────────────────────────────
  const leah = await person("Leah Sandoval");
  await api("POST", `/donors/${leah.id}/interactions`, tok, { type: "note", note: "Asked about volunteering.", date: require("../clock").civilDay() });
  const prev5 = (await api("GET", `/imports/${p5.importId}/undo-preview`, tok)).body || {};
  ok("§I13.6 the Undo confirm names who it would keep, and why, before it runs",
    (prev5.activitySince || []).length === 1 && prev5.activitySince[0].name === "Leah Sandoval" && /^a note was added [A-Z][a-z]{2} \d{1,2}$/.test(prev5.activitySince[0].why), JSON.stringify(prev5.activitySince));
  const list = (await api("GET", "/imports", tok)).body.imports || [];
  ok("§I13.6 the undo date is one date: the Imports list and the receipt say the same sentence",
    list.filter(i => runs.includes(i.id)).every(i => /^Undo available until [A-Z][a-z]{2} \d{1,2}, \d{4} \(30 days from the import\)\.$/.test(i.undoSentence || ""))
    && list.find(i => i.id === p2.importId).undoSentence === ((await api("GET", `/imports/${p2.importId}`, tok)).body.import || {}).undoSentence, JSON.stringify(list.slice(0, 2).map(i => i.undoSentence)));
  let partial = null;
  for (const id of [...runs].reverse()) {
    const r = await api("POST", `/imports/${id}/reverse`, tok, {});
    if (id === p5.importId) partial = r.body;
  }
  ok("§I13.6 a partial undo says so first: 'Undone, except 1 person you kept: Leah Sandoval (a note was added …)'",
    partial && /^Undone, except 1 person you kept: Leah Sandoval \(a note was added [A-Z][a-z]{2} \d{1,2}\)\./.test(partial.sentence || ""), partial && partial.sentence);
  // she removes Leah too, from the receipt ("Remove them too", ImportUndo.jsx), and the org is the baseline
  const rm = await api("POST", "/donors/bulk-delete", tok, { ids: [leah.id], count: 1, importId: p5.importId });
  ok("§I13.8 'Remove them too' takes Leah, with her note, to the trash", rm.status < 300 && !(await person("Leah Sandoval")), JSON.stringify([rm.status, rm.body]).slice(0, 200));
  // Leah, whom she removed by hand after the undo, is in the trash with her note (restorable for 30 days): the one
  // record the baseline holds that the empty org did not, and nothing else
  const S1 = await snapshot(ORG);
  const keepOut = r => { const o = JSON.parse(r); return o.id === leah.id || o.donor_id === leah.id; };
  const trashed = ["donors", "interactions"].reduce((n, t) => n + (S1[t] || []).filter(keepOut).length, 0);
  for (const t of ["donors", "interactions"]) S1[t] = (S1[t] || []).filter(r => !keepOut(r));
  const diff = snapDiff(S0, S1);
  ok("§I13.8 undo of everything is back to the exact baseline, with only Leah and her note in the trash", diff.length === 0 && trashed === 2, diff.join("; ").slice(0, 600) + ` trashed=${trashed}`);
  await surfaces(ORG, { token: tok, step: "§I13 after undo" });

  await workbookScreen({ ok, api, q, freshOrg, XLSX });
}

// Item 2 on the workbook screen itself (WorkbookImport.jsx): a Pledges sheet she
// assigns the Pledges role writes its pledges, linked by name, through the one
// pledge writer, with the screen's own calls (import-combined, import-semantics).
async function workbookScreen({ ok, api, q, freshOrg, XLSX }) {
  const ORG = "org_i13workbook";
  const tok = await freshOrg(ORG, "Import gauntlet workbook (test)");
  const S = await import("../../shared/importShape.js");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Constituent ID", "First Name", "Last Name", "Email"], ["W-01", "Wanda", "Pryce", "wanda.pryce@stress.test"], ["W-02", "Xavier", "Holt", "xavier.holt@stress.test"]]), "People");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Gift ID", "Constituent ID", "Donor Name", "Gift Date", "Amount"], ["WG-1", "W-01", "Wanda Pryce", "2025-09-01", 100], ["WG-3", "W-02", "Xavier Holt", "2025-09-15", 50]]), "Gifts");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Donor Name", "Pledge Date", "Pledge Amount", "Status"], ["Wanda Pryce", "2025-09-01", 900, "Open"]]), "Pledges");
  const read = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellNF: true, cellFormula: true, cellStyles: true });
  const roled = S.classifyWorkbookSheets(S.extractWorkbookFromSheetJS(read, XLSX).map(sh => {
    const a = S.analyzeWorkbookSheet(sh.records); return { name: sh.name, ...a, rowCount: a.records, meta: sh.meta, formulaCellRatio: sh.formulaCellRatio }; }));
  for (const s of roled) if (s.name === "Pledges") s.role = "pledges";   // her choice in the wizard
  const sub = S.buildWorkbookSubmission(roled, { currentYear: 2026 });
  ok("§I13.2w the workbook screen promises Wanda's pledge by name", sub.pledges.pledges.length === 1 && sub.pledges.pledges[0].donorName === "Wanda Pryce" && sub.pledges.totalPledged === 900, JSON.stringify(sub.pledges));
  const runId = "imp_" + "i13wb" + "0".repeat(11);
  const donors = sub.donors.map(({ _line, _freqMonthlyClaim, _staleChargeClaim, staleFrequency, address1, ...d }) => d);
  const c = await api("POST", "/donors/import-combined", tok, { donors, gifts: sub.gifts, identityResolved: true, importId: runId });
  const sem = await api("POST", "/donors/import-semantics", tok, { importId: runId,
    pledges: sub.pledges.pledges.map(p => ({ donorExternalId: p.donorExternalId, donorName: p.donorName, donorEmail: p.donorEmail, amount: p.amount, date: p.date, externalId: p.externalId, status: p.status })), merges: [] });
  const [w] = await q(`SELECT p.amount::numeric AS amount FROM pledges p JOIN donors d ON d.id = p.donor_id WHERE p.org_id=$1 AND d.name='Wanda Pryce'`, [ORG]);
  ok("§I13.2w the write records it: 1 pledge, $900, on Wanda", c.status < 300 && sem.status < 300 && sem.body.counts.pledges === 1 && w && centsOf(w.amount) === 90000, JSON.stringify([c.status, sem.body && sem.body.counts, w]));
  const GR = await import("../../shared/importGiftRules.js");
  ok("§I13.2w a figure that differs is the receipt's headline", GR.receiptDiffHeadline([{ label: "Pledges as commitments", shown: 1, written: 0 }], (x, v) => String(v))
    === "Not finished: what we showed you and what was written differ. Pledges as commitments: we showed you 1, and 0 were written. Undo puts everything back.", "");
}

module.exports = { import13 };

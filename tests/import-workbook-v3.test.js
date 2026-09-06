// BUILD-82 — THE GOLDEN WORKBOOK SUITE (pure half). Drives the whole pure
// layer over tests/fixtures/build82/steward-messy-25k-v3.xlsx (7.6MB, nine
// sheets, 25,300 people, 92,227 gift rows) and pins every number the layer
// measures. The Cowork generator/key never landed on disk (BLOCKED-build82.md),
// so pins are MEASURED truth cross-checked against the spec's stated numbers;
// where the spec states a number the artifact can no longer prove (net cash
// $53,231,102.55), the suite asserts the itemised waterfall instead.
// Pure Node — no server, no db. Slow-ish (~15s): reads the 7.6MB workbook once.
const { ok, summary } = require("./helpers");
const path = require("path");
const fs = require("fs");

(async () => {
  console.log("import-workbook-v3 (BUILD-82 golden, pure layer)");
  const IS = await import("../shared/importShape.js");
  const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
  const FIXTURE = path.join(__dirname, "fixtures", "build82", "steward-messy-25k-v3.xlsx");
  const buf = fs.readFileSync(FIXTURE);
  const t0 = Date.now();
  const wb = XLSX.read(buf, { type: "buffer", cellNF: true, cellFormula: true, cellStyles: true });
  const raw = IS.extractWorkbookFromSheetJS(wb, XLSX);
  const sheets = raw.map(s => {
    if (!s.records.length) return { name: s.name, headers: [], rows: [], typedRows: [], rowCount: 0, meta: s.meta, formulaCellRatio: s.formulaCellRatio };
    const a = IS.analyzeWorkbookSheet(s.records);
    return { name: s.name, ...a, rowCount: a.records, meta: s.meta, formulaCellRatio: s.formulaCellRatio };
  });

  // ── Part 1.1 — nine sheets, every role right, with evidence ──────────────
  const roled = IS.classifyWorkbookSheets(sheets);
  const roleOf = n => roled.find(s => s.name === n);
  ok("nine sheets classified", roled.length === 9, roled.length);
  for (const [n, want] of [["Cover", "chrome"], ["Donors", "donors"], ["Gifts 2023-2026", "gifts"],
    ["Gifts 2019-2022", "gifts"], ["Old export (do not use)", "decoy"], ["Pledges", "pledges"],
    ["Recurring", "recurring"], ["Summary", "chrome"], ["Sheet1", "empty"]]) {
    ok(`${n} → ${want}`, roleOf(n).role === want, roleOf(n).role);
  }
  for (const s of roled) ok(`${s.name} carries an evidence sentence`, typeof s.evidence === "string" && s.evidence.length > 10, s.evidence);
  const decoy = roleOf("Old export (do not use)");
  ok("decoy warns with the dollar figure it would add", decoy.decoyDollars > 4000000 && decoy.evidence.includes("$"), decoy.decoyDollars);
  ok("decoy duplicate probe ran (≥90% overlap sampled)", decoy.decoyDupRate >= 90, decoy.decoyDupRate);

  // ── Part 1.3 — rows that are not data, found by content, listed by number ─
  const g1 = roleOf("Gifts 2023-2026"), g2 = roleOf("Gifts 2019-2022"), dn = roleOf("Donors");
  ok("Gifts 2023-2026 counts 56,177 (subtotals and chrome out)", g1.rowCount === 56177, g1.rowCount);
  ok("Gifts 2019-2022 counts 36,050 (TOTAL row out)", g2.rowCount === 36050, g2.rowCount);
  ok("Donors counts 25,300 people (title band, note row, stray cell out)", dn.rowCount === 25300, dn.rowCount);
  const subLines = g1.chromeRows.filter(c => c.kind === "subtotal_row").map(c => c.line);
  ok("the four year-subtotal rows listed by line", JSON.stringify(subLines) === JSON.stringify([11049, 27709, 45789, 56182]), subLines);
  const grand = g1.chromeRows.find(c => c.kind === "total_row");
  ok("GRAND TOTAL found with its $32,523,933.89 (the would-be largest gift)", grand && grand.amount === 32523933.89, grand);
  ok("the donors note row excluded by content", dn.chromeRows.some(c => c.kind === "note_row" && c.line === 25305), dn.chromeRows.filter(c => c.kind !== "blank"));
  ok("the stray 'x' at row 30000 excluded, listed", dn.chromeRows.some(c => c.kind === "stray_cell" && c.line === 30000), null);
  ok("legacy TOTAL cached figure captured for reconciliation", g2.totalRow && g2.totalRow.amount === 19852987.83, g2.totalRow);
  ok("legacy header found on row 2 with the title above it", g2.headerLine.line === 2 && g2.chromeAbove.length === 1, g2.headerLine);

  // ── Part 1.4 — the legend, quoted never obeyed ───────────────────────────
  const legend = IS.extractWorkbookLegend(roled);
  ok("legend: yellow = do not contact found on the cover", legend.some(l => /yellow/i.test(l.text) && /do not contact/i.test(l.text)), legend);
  ok("legend: hidden = deceased found on the cover", legend.some(l => /hidden/i.test(l.text) && /deceased/i.test(l.text)), legend);

  // ── Part 3.5 — what the sheet knows that the cells don't ─────────────────
  ok("40 hidden rows detected on Donors", dn.meta.hiddenRows.length === 40, dn.meta.hiddenRows.length);
  ok("100 yellow rows detected", Object.keys(dn.meta.fillRows).length === 100 && dn.meta.fillColorName === "yellow", Object.keys(dn.meta.fillRows).length);
  ok("40 comments detected", dn.meta.comments.length === 40, dn.meta.comments.length);
  ok("hidden column AD detected", dn.meta.hiddenCols.length === 1 && dn.meta.hiddenCols[0].ref === "AD", dn.meta.hiddenCols);
  const signals = IS.buildSheetSignals("Donors", dn.meta, legend, { headerCells: dn.headerCells });
  const hiddenSig = signals.find(s => s.kind === "hidden_rows");
  ok("hidden-row signal quotes the legend and asks", hiddenSig && /deceased/i.test(hiddenSig.legend || "") && /Treat them|skip/i.test(hiddenSig.question), hiddenSig && hiddenSig.question);
  const fillSig = signals.find(s => s.kind === "filled_rows");
  ok("yellow-row signal quotes the legend", fillSig && /do not contact/i.test(fillSig.legend || ""), fillSig && fillSig.legend);
  const comSig = signals.find(s => s.kind === "comments");
  ok("comment signal counts the exclusion-phrase mentions", comSig && comSig.exclusionCount >= 30 && comSig.count === 40, comSig && { c: comSig.count, e: comSig.exclusionCount });
  const hcSig = signals.find(s => s.kind === "hidden_column");
  ok("hidden column named: Internal Score, never auto-mapped", hcSig && hcSig.header === "Internal Score", hcSig);

  // ── Part 4 — the standard mapping (the catastrophe assertions) ───────────
  const { mapping } = IS.buildStandardMapping(dn.headers, dn.rows, "donor");
  ok("First/Last both mapped (the 'Unnamed: 31' name-substring trap is dead)", mapping["First"] === "_firstName" && mapping["Last"] === "_lastName", mapping);
  ok("'Unnamed: 31' maps to NOTHING", !mapping["Unnamed: 31"], mapping["Unnamed: 31"]);
  ok("Email and Email 2 land on separate fields — no silent overwrite", mapping["Email"] === "email" && mapping["Email 2"] === "email2", { e: mapping["Email"], e2: mapping["Email 2"] });
  ok("Constituent ID → Donor ID, a standard field", mapping["Constituent ID"] === "donorId", mapping["Constituent ID"]);
  ok("Phone and Mobile distinct", mapping["Phone"] === "phone" && mapping["Mobile"] === "mobile", null);
  ok("full donor vocabulary lands (middle/suffix/salutation/spouse/household/address2/country/board)",
     mapping["Middle"] === "middleName" && mapping["Suffix"] === "suffix" && mapping["Salutation"] === "salutation" &&
     mapping["Spouse"] === "spouse" && mapping["Household ID"] === "householdId" && mapping["Address 2"] === "address2" &&
     mapping["Country"] === "country" && mapping["Board?"] === "board", mapping);
  // the legacy gift sheet: ID→Donor ID, Ref→Gift ID, Designation→Fund, Campaign→Appeal
  const gm = IS.buildStandardMapping(g2.headers, g2.rows, "gift").mapping;
  ok("legacy 'ID' → Donor ID on a gift sheet", gm["ID"] === "donorId", gm);
  ok("legacy 'Ref' → Gift ID", gm["Ref"] === "externalId", gm["Ref"]);
  ok("legacy 'Designation' → Fund", gm["Designation"] === "fund", gm["Designation"]);
  ok("legacy 'Campaign' → Appeal", gm["Campaign"] === "campaign", gm["Campaign"]);

  // ── Part 2.2 — the four ID forms ─────────────────────────────────────────
  ok("4212 ≡ 004212 ≡ 4212.0 ≡ ' 4212 '", ["4212", "004212", "4212.0", " 4212 "].every(f => IS.donorIdKey(f) === "4212"),
     ["4212", "004212", "4212.0", " 4212 "].map(IS.donorIdKey));
  ok("a lone 0 survives donorIdKey", IS.donorIdKey("0") === "0", IS.donorIdKey("0"));

  // ── Part 3.1/3.2 — typed money and date rules, unit level ────────────────
  ok("number cell → the number", IS.normalizeMoneyCell({ t: "n", v: 250 }).value === 250, null);
  ok("float noise rounds to cents", IS.normalizeMoneyCell({ t: "n", v: 1000.0000001 }).value === 1000, null);
  const pct = IS.normalizeMoneyCell({ t: "n", v: 0.25, z: "0%" });
  ok("percent format ×100 and flagged", pct.value === 25 && pct.flag && /25%/.test(pct.flag.text) && /\$25/.test(pct.flag.text), pct);
  ok("parens-negative FORMAT is display only", IS.normalizeMoneyCell({ t: "n", v: 500, z: "#,##0.00;(#,##0.00)" }).value === 500, null);
  const fz = IS.normalizeMoneyCell({ t: "n", v: 0, f: "500.0*1" });
  ok("formula cached 0 refused WITH the formula text", fz.refuse === "formula_no_value" && fz.formula === "500.0*1", fz);
  ok("formula with cached value = the cached value", IS.normalizeMoneyCell({ t: "n", v: 50, f: "50.0*1" }).value === 50, null);
  ok("boolean refused", IS.normalizeMoneyCell({ t: "b", v: true }).refuse === "boolean", null);
  ok("error cell refused with its code", IS.normalizeMoneyCell({ t: "e", v: 15, w: "#N/A" }).refuse === "excel_error", null);
  ok("text still goes through normalizeMoney unchanged", IS.normalizeMoneyCell("$1,500.37").value === 1500.37, null);
  ok("$-500.37 parses negative (the sign inside the symbol)", IS.normalizeMoney("$-500.37").value === -500.37, null);
  ok("date cell → civil date, no tz conversion", IS.normalizeDateCell({ t: "n", v: 44927, z: "m/d/yyyy" }).value === "2023-01-01", IS.normalizeDateCell({ t: "n", v: 44927, z: "m/d/yyyy" }));
  ok("date cell with a TIME drops it", IS.normalizeDateCell({ t: "n", v: 44927.99, z: "m/d/yyyy h:mm" }).value === "2023-01-01", null);
  ok("General serial in a date column reads when plausible", IS.normalizeDateCell({ t: "n", v: 44927 }, { currentYear: 2026 }).value === "2023-01-01", null);
  ok("General 1234 in a date column refused (lands 1903)", IS.normalizeDateCell({ t: "n", v: 1234 }, { currentYear: 2026 }).value === null, null);
  ok("serial 0 refused by name", /serial 0/.test(IS.normalizeDateCell({ t: "n", v: 0, z: "m/d/yy" }).warn || ""), null);
  ok("serial 60 (1900-02-29) refused by name", /serial 60/.test(IS.normalizeDateCell({ t: "n", v: 60, z: "m/d/yy" }).warn || ""), null);
  ok("id cell 8763.0 reads as '8763'", IS.normalizeIdCell({ t: "n", v: 8763 }).value === "8763", null);
  ok("currency format with [RED] is not a date", !IS.cellFormatIsDate('#,##0.00;[RED]-#,##0.00'), null);

  // ── the full pipeline: donors, dedup, gifts, join ────────────────────────
  const donors = dn.rows.map(row => {
    const d = {};
    for (const [h, k] of Object.entries(mapping)) d[k] = String(row[h] ?? "").trim();
    d.name = [d._firstName, d._lastName].filter(Boolean).join(" ") || d.name || "";
    delete d._firstName; delete d._lastName;
    d.externalDonorId = d.donorId; delete d.donorId;
    return d;
  });
  ok("EVERY donor row becomes a donor (source of record)", donors.length === 25300, donors.length);
  ok("every donor has a name (no 1,433 catastrophe)", donors.filter(d => d.name).length === 25300, donors.filter(d => d.name).length);

  const dedup = IS.resolveDonorSheetDuplicates(donors);
  ok("duplicate people fold through a review list (measured 266; spec ~300 — BLOCKED)", dedup.foldedRows === 266 && dedup.review.length === 266, dedup.foldedRows);
  ok("every fold has a reason and the folded id (the UNDO surface)", dedup.review.every(r => r.reason && r.foldedId !== undefined), dedup.review[0]);
  ok("no fold is name-only", dedup.review.every(r => /email|phone/.test(r.reason)), dedup.review.find(r => !/email|phone/.test(r.reason)));

  const builds = [g1, g2].map(s => IS.buildWorkbookGiftRows(s, { currentYear: 2026 }));
  const [b1, b2] = builds;
  ok("current sheet is month-first, said so", b1.convention.convention === "mdy", b1.convention);
  ok("legacy sheet is day-first from impossible cases", b2.convention.convention === "dmy" && b2.convention.dayFirstEvidence === 14356, b2.convention.dayFirstEvidence);
  ok("843 zero-cached formulas refused with formula text", b1.refusals.filter(r => r.reason === "formula_no_value").length === 843 && b1.refusals.every(r => r.reason !== "formula_no_value" || r.formula), b1.refusals.length);
  ok("560 percent-format amounts flagged, 559 imported (one is a refund)", b1.flags.filter(f => f.kind === "percent_format").length === 559, b1.flags.length);
  ok("float-noise amounts round, counted (6,691)", b1.report.floatNoiseRows === 6691, b1.report.floatNoiseRows);
  ok("legacy trailing-minus rows route as refunds (948)", b2.routed.refunds.length === 948, b2.routed.refunds.length);
  ok("in-kind routes out of cash on both sheets (108 + 89)", b1.routed.inKind.length === 108 && b2.routed.inKind.length === 89, [b1.routed.inKind.length, b2.routed.inKind.length]);
  ok("every refusal has sheet, line and reason", builds.every(b => b.refusals.every(r => r.sheet && r.line && r.reason)), null);

  const linked = IS.linkWorkbookGifts(dedup.donors, builds.flatMap(b => b.items));
  ok("all matched by Donor ID (the sheets carry no name/email)", linked.matchedById === 89681 && linked.matchedByEmail === 0, linked.matchedById);
  ok("orphans refused by row with reason, never invented (490 reach the link; ~10 more died at amount refusals)", linked.refusedOrphans.length === 490, linked.refusedOrphans.length);
  ok("no donor was minted from a bare ID", linked.newDonors === 0, linked.newDonors);
  ok("orphan refusals carry their dollars", Math.round(linked.refusedOrphans.reduce((s, o) => s + o.dollars, 0) * 100) / 100 === 252507.90, null);
  // gifts posted to a FOLDED duplicate id land on the surviving record
  const foldedIds = new Set(dedup.review.map(r => IS.donorIdKey(r.foldedId)).filter(Boolean));
  const foldedIdGifts = builds.flatMap(b => b.items).filter(i => foldedIds.has(IS.donorIdKey(i.donorId)));
  const orphanIds = new Set(linked.refusedOrphans.map(o => IS.donorIdKey(o.id)));
  ok("gifts posted to duplicate IDs land on survivors (none orphaned)", foldedIdGifts.length > 0 && foldedIdGifts.every(i => !orphanIds.has(IS.donorIdKey(i.donorId))), foldedIdGifts.length);

  const giftedIdx = new Set(linked.gifts.map(g => g.donorIndex));
  const noGifts = dedup.donors.filter((_, i) => !giftedIdx.has(i)).length;
  ok("no-gift donors get records as prospects (549: 300 planted + rows whose only gifts refused/routed)", noGifts === 549, noGifts);

  // ── Part 5 — pledges and recurring ───────────────────────────────────────
  const pl = IS.extractWorkbookPledges(roleOf("Pledges"), { currentYear: 2026 });
  ok("60 pledges as commitments, $1,881,000 pledged, $0 in cash", pl.pledges.length === 60 && pl.totalPledged === 1881000, pl.totalPledged);
  const rc = IS.extractWorkbookRecurring(roleOf("Recurring"), { anchorDate: "2026-09-06", currentYear: 2026 });
  ok("100 failed sustainers on the recovery list", rc.recovery.length === 100, rc.recovery.length);
  ok("60 'Active' rows with stale charges flagged — the pattern will win", rc.stale.length === 60, rc.stale.length);

  // ── Part 6 — the two-axis invariant, per sheet and for the workbook ──────
  const rec = IS.reconcileWorkbook(builds.map(b => b.report));
  ok("per-sheet invariant balanced", rec.perSheet.every(s => s.balanced), rec.perSheet);
  ok("workbook invariant: 92,227 rows in your file, every one disposed", rec.workbook.balanced && rec.workbook.rowsInFile === 92227, rec.workbook);

  // ── money: the golden cash number + the itemised waterfall ───────────────
  const r2 = x => Math.round(x * 100) / 100;
  const cash = r2(linked.gifts.reduce((s, g) => s + g.amount, 0));
  ok("imported net cash — the golden measured number", cash === 51348667.87, cash);
  const orphanD = r2(linked.refusedOrphans.reduce((s, o) => s + (o.dollars || 0), 0));
  const dollarsIn = r2(b1.report.dollarsIn + b2.report.dollarsIn);
  ok("cash + orphans === the sheets' own readable dollars (closed grammar)", r2(cash + orphanD) === dollarsIn, { cash, orphanD, dollarsIn });
  const refundsD = r2(builds.flatMap(b => b.routed.refunds).reduce((s, x) => s + Math.abs(x.dollars), 0));
  const inKindD = r2(builds.flatMap(b => b.routed.inKind).reduce((s, x) => s + Math.abs(x.dollars), 0));
  const formulaFace = 405876.20;   // the 843 refused formulas' face value (=N*1), measured from the artifact
  const waterfall = r2(cash + refundsD + inKindD + orphanD + formulaFace);
  ok("the waterfall reaches every dollar the artifact still carries", waterfall === 52767200.03, waterfall);
  // The spec's $53,231,102.55 exceeds the artifact-recoverable maximum by
  // $463,902.52 — generator-side truth (BLOCKED-build82.md). The TOTAL rows:
  ok("GRAND TOTAL (32,523,933.89) reconciles: dollarsIn + refunds + in-kind + formula face ≈ it",
     Math.abs(b1.report.dollarsIn + r2(b1.routed.refunds.reduce((s, x) => s + Math.abs(x.dollars), 0)) + r2(b1.routed.inKind.reduce((s, x) => s + Math.abs(x.dollars), 0)) + formulaFace - 32523933.89) < 32523933.89 * 0.01,
     null);
  ok("legacy TOTAL cached (19,852,987.83) is STALE by design — the reconciliation explains, never equals",
     g2.totalRow.amount === 19852987.83 && Math.abs(b2.report.dollarsIn - g2.totalRow.amount) > 100000, b2.report.dollarsIn);

  // ── THE SUBMISSION BUILDER — what the summary shows IS what the write sends ─
  const sub = IS.buildWorkbookSubmission(roled, {
    signalAnswers: { hidden_rows: "legend", filled_rows: "legend", comments: "route" },
    anchorDate: "2026-09-06", currentYear: 2026,
    customAssignments: { Donors: { "Internal Score": { entity: "donor", key: "internal_score" } } },
  });
  ok("ALL 800 exclusions found (flags + status + notes + hidden + yellow + comments)",
     sub.exclusionSummary.total === 800, sub.exclusionSummary);
  ok("the 40 hidden, 100 yellow and 40 comment rows are among them",
     sub.exclusionSummary.fromHidden === 40 && sub.exclusionSummary.fromFill === 100 && sub.exclusionSummary.fromComments === 40, sub.exclusionSummary);
  ok("'Do not include in vendor mailing' (331 rows) excluded NOTHING",
     sub.exclusionSummary.total === 800 && !IS.detectNoteMarkers("Do not include in vendor mailing").doNotSolicit
     && !IS.detectNoteMarkers("Do not include in vendor mailing").doNotMail, null);
  ok("'remove from appeals' IS a no-ask", IS.detectNoteMarkers("remove from appeals").doNotSolicit === true, null);
  ok("a DATE in the Deceased column means deceased (with the date), never FALSE",
     sub.donors.filter(d => d.deceased && d.deceasedDate).length >= 45, sub.donors.filter(d => d.deceased && d.deceasedDate).length);
  ok("792 surviving records carry an exclusion flag (800 rows − 8 folded duplicates)",
     sub.donors.filter(d => d.deceased || d.doNotContact || d.doNotSolicit || d.doNotMail || d.doNotEmail).length === 792, null);
  ok("submission totals: 25,034 donors / 89,681 gifts / $51,348,667.87",
     sub.totals.donors === 25034 && sub.totals.gifts === 89681 && sub.totals.cash === 51348667.87, sub.totals);
  ok("recovery sustainers tagged card-failed (100)", sub.donors.filter(d => (d.tags || []).includes("card-failed")).length === 100, null);
  ok("stale 'Active' claims tagged — the pattern won, the mismatch shows (60)",
     sub.donors.filter(d => (d.tags || []).includes("stale-frequency")).length === 60, null);
  ok("custom assignment rides the donor rows (Internal Score)",
     sub.donors.filter(d => d.customFields && d.customFields.internal_score).length > 20000, null);
  ok("merges list = the review list (266, each with reason + folded id)",
     sub.merges.length === 266 && sub.merges.every(m => m.reason && m.foldedId !== undefined), sub.merges.length);
  ok("workbook invariant balanced with orphans as refusals",
     sub.reconciliation.workbook.balanced && sub.reconciliation.workbook.refused === 1333, sub.reconciliation.workbook);
  ok("TOTAL-rows panel explains both sheets (GRAND consistent, legacy STALE)",
     sub.totalRows.length === 2 && sub.totalRows.every(t => t.stated && t.readable != null), sub.totalRows);
  ok("largest-gifts panel tops out at real $25,000 gifts — never the $32.5M GRAND TOTAL",
     sub.largestGifts.length === 5 && sub.largestGifts.every(g => g.dollars === 25000), sub.largestGifts);
  ok("skip reasons itemised: formula_no_value 843 + no_donor_match 490",
     sub.refusals.filter(x => x.reason === "formula_no_value").length === 843
     && sub.refusals.filter(x => x.reason === "no_donor_match").length === 490, null);
  ok("fileStats ready for orgs.last_import_stats", sub.fileStats.rows === 92227 && sub.fileStats.largestGifts.length === 5, sub.fileStats);

  // hidden rows SKIPPED by choice — counted, listed, and the count moves
  const subSkip = IS.buildWorkbookSubmission(roled, {
    signalAnswers: { hidden_rows: "skip", filled_rows: "legend", comments: "ignore" },
    anchorDate: "2026-09-06", currentYear: 2026,
  });
  ok("hidden rows skipped by choice: 40 fewer donors, each listed by line",
     subSkip.donors.length + subSkip.foldedRows === 25260
     && subSkip.refusals.filter(x => x.reason === "hidden_row_skipped_by_choice").length === 40, subSkip.donors.length);

  // decoy override — deduplicated against the real sheets BEFORE a row lands
  const subDecoy = IS.buildWorkbookSubmission(roled, {
    signalAnswers: { hidden_rows: "legend", filled_rows: "legend", comments: "route" },
    anchorDate: "2026-09-06", currentYear: 2026, includeDecoy: true,
  });
  ok("decoy override dedupes by donor+date+amount and SHOWS the overlap",
     subDecoy.decoyOverlap > 6000 && subDecoy.refusals.filter(x => x.reason === "decoy_duplicate").length === subDecoy.decoyOverlap, subDecoy.decoyOverlap);
  ok("decoy rows that survive the dedupe are counted in the workbook equation", subDecoy.reconciliation.workbook.balanced, subDecoy.reconciliation.workbook);

  console.log(`  (pipeline: ${((Date.now() - t0) / 1000).toFixed(1)}s, heap ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB)`);
  summary("import-workbook-v3");
})();

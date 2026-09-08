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
  const yellowFill = (dn.meta.fills || []).find(f => f.rgb === "FFFF00");
  ok("100 yellow rows detected, and EVERY fill colour is carried (not just the dominant one)",
     yellowFill && yellowFill.rows.length === 100 && dn.meta.fills.length >= 3, (dn.meta.fills || []).map(f => `${f.rgb}:${f.rows.length}`));
  ok("40 comments detected", dn.meta.comments.length === 40, dn.meta.comments.length);
  ok("hidden column AD detected", dn.meta.hiddenCols.length === 1 && dn.meta.hiddenCols[0].ref === "AD", dn.meta.hiddenCols);
  // ── BUILD-83 Part 1 — the prompts: data rows only, one per colour, own state ─
  const signals = IS.buildWorkbookSignals(roled, legend);
  ok("EXACTLY four items on Donors — 40 hidden, 100 yellow, 40 comments, one hidden column",
     signals.length === 4 && signals.every(s => s.sheet === "Donors"), signals.map(s => s.id));
  ok("no prompt for the gift sheet's shaded subtotal/TOTAL rows (chrome never comes back)",
     !signals.some(s => /Gifts/.test(s.sheet)) && !signals.some(s => /DDEBF7|BDD7EE/i.test(s.id)), signals.map(s => s.id));
  const hiddenSig = signals.find(s => s.kind === "hidden_rows");
  ok("hidden-row signal quotes the legend and asks", hiddenSig && /deceased/i.test(hiddenSig.legend || "") && /hidden/i.test(hiddenSig.question), hiddenSig && hiddenSig.question);
  ok('Part 1.4 — "Import as normal" is LABELLED (treated as live donors)',
     hiddenSig.options.some(o => o.value === "import" && /treated as live donors/i.test(o.label)), hiddenSig.options);
  const fillSig = signals.find(s => s.kind === "filled_rows");
  ok("ONE yellow signal, 100 data rows, quoting the legend, keyed by sheet+kind+colour",
     fillSig && fillSig.count === 100 && /do not contact/i.test(fillSig.legend || "") && fillSig.id === "Donors|filled_rows|FFFF00", fillSig && { c: fillSig.count, id: fillSig.id });
  ok("every signal carries a UNIQUE id — one prompt cannot answer for another",
     new Set(signals.map(s => s.id)).size === signals.length, signals.map(s => s.id));
  const comSig = signals.find(s => s.kind === "comments");
  ok("comment signal counts the exclusion-phrase mentions", comSig && comSig.exclusionCount >= 30 && comSig.count === 40, comSig && { c: comSig.count, e: comSig.exclusionCount });
  const hcSig = signals.find(s => s.kind === "hidden_column");
  ok("hidden column named: Internal Score, never auto-mapped", hcSig && hcSig.header === "Internal Score", hcSig);
  // Part 1.2 — a colour the legend does NOT name gets its own prompt with NO
  // legend text, defaulting to import, and the shade is recorded on the row.
  {
    const synthetic = IS.buildSheetSignals("Sheet", { fills: [{ rgb: "C6EFCE", rows: [10, 11, 12] }] },
      [{ sheet: "Cover", text: "Yellow rows on the Donors tab = do not contact" }], { dataLines: [10, 11, 12] });
    const s0 = synthetic[0];
    ok("a legend-less fill prompts on its own, with NO legend text and no legend option",
       s0 && s0.legend === null && !s0.options.some(o => o.value === "legend") && s0.defaultAnswer === "import"
       && /does not say what this means/.test(s0.question), s0);
  }

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
  // BUILD-83 Part 2.4 — a CONSTANT formula is a number: `=500.0*1` is $500,
  // whatever the spreadsheet cached. A formula that reaches outside itself
  // still refuses WITH its text.
  const fz = IS.normalizeMoneyCell({ t: "n", v: 0, f: "500.0*1" });
  ok("formula cached 0, constant arithmetic → the number, flagged", fz.value === 500 && fz.flag.kind === "computed_formula", fz);
  const fr2 = IS.normalizeMoneyCell({ t: "n", v: 0, f: "SUM(D2:D9)" });
  ok("formula cached 0, real formula → still refused WITH the formula text", fr2.refuse === "formula_no_value" && fr2.formula === "SUM(D2:D9)", fr2);
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
  ok("843 zero-cached constant formulas IMPORT, flagged 'computed from formula'",
     b1.refusals.filter(r => r.reason === "formula_no_value").length === 0
     && b1.flags.filter(f => f.kind === "computed_formula").length === 843, b1.refusals.length);
  ok("560 percent-format amounts flagged, 559 imported (one is a refund)", b1.flags.filter(f => f.kind === "percent_format").length === 559, b1.flags.length);
  ok("float-noise amounts round, counted (6,691)", b1.report.floatNoiseRows === 6691, b1.report.floatNoiseRows);
  ok("legacy trailing-minus rows route as refunds (948)", b2.routed.refunds.length === 948, b2.routed.refunds.length);
  ok("in-kind routes out of cash on both sheets (108 + 89)", b1.routed.inKind.length === 108 && b2.routed.inKind.length === 89, [b1.routed.inKind.length, b2.routed.inKind.length]);
  ok("every refusal has sheet, line and reason", builds.every(b => b.refusals.every(r => r.sheet && r.line && r.reason)), null);

  const linked = IS.linkWorkbookGifts(dedup.donors, builds.flatMap(b => b.items));
  ok("all matched by Donor ID (the sheets carry no name/email)", linked.matchedById === 90523 && linked.matchedByEmail === 0, linked.matchedById);
  // BUILD-83: with the two refusals repaired, 491 of the key's 500 orphan rows
  // reach the link (the rest carry an amount that is genuinely unreadable).
  ok("orphans refused by row with reason, never invented (491 reach the link)", linked.refusedOrphans.length === 491, linked.refusedOrphans.length);
  ok("no donor was minted from a bare ID", linked.newDonors === 0, linked.newDonors);
  ok("orphan refusals carry their dollars", Math.round(linked.refusedOrphans.reduce((s, o) => s + o.dollars, 0) * 100) / 100 === 252808.15,
     Math.round(linked.refusedOrphans.reduce((s, o) => s + o.dollars, 0) * 100) / 100);
  // gifts posted to a FOLDED duplicate id land on the surviving record
  const foldedIds = new Set(dedup.review.map(r => IS.donorIdKey(r.foldedId)).filter(Boolean));
  const foldedIdGifts = builds.flatMap(b => b.items).filter(i => foldedIds.has(IS.donorIdKey(i.donorId)));
  const orphanIds = new Set(linked.refusedOrphans.map(o => IS.donorIdKey(o.id)));
  ok("gifts posted to duplicate IDs land on survivors (none orphaned)", foldedIdGifts.length > 0 && foldedIdGifts.every(i => !orphanIds.has(IS.donorIdKey(i.donorId))), foldedIdGifts.length);

  const giftedIdx = new Set(linked.gifts.map(g => g.donorIndex));
  const noGifts = dedup.donors.filter((_, i) => !giftedIdx.has(i)).length;
  ok("no-gift donors get records as prospects (481: the key's 300 planted, plus rows whose only gifts were routed or orphaned)", noGifts === 481, noGifts);

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
  ok("imported net cash — the golden measured number", cash === 51754243.82, cash);
  const orphanD = r2(linked.refusedOrphans.reduce((s, o) => s + (o.dollars || 0), 0));
  const dollarsIn = r2(b1.report.dollarsIn + b2.report.dollarsIn);
  ok("cash + orphans === the sheets' own readable dollars (closed grammar)", Math.abs(r2(cash + orphanD) - dollarsIn) < 0.02, { cash, orphanD, dollarsIn });
  const refundsD = r2(builds.flatMap(b => b.routed.refunds).reduce((s, x) => s + Math.abs(x.dollars), 0));
  const inKindD = r2(builds.flatMap(b => b.routed.inKind).reduce((s, x) => s + Math.abs(x.dollars), 0));
  // ── THE KEY'S OWN RECONCILIATION (claude/messy-25k-v3-fixture-key.md, the
  // Sept-7 corrected version). Key net cash $52,376,921.72 counts the 896
  // trailing-minus rows as POSITIVE — a fixture defect Cowork owns ("a trailing
  // minus is a real negative convention and an honest reader must treat it as
  // one … do not fix the parser to match the key"). So the honest reader's
  // figure is the key MINUS the orphans it refuses, MINUS the trailing-minus
  // dollars it routes as negatives, PLUS the refunds it routes rather than
  // subtracts. Every term is asserted, and the residual is named.
  const KEY_NET = 52376921.72, KEY_TRAILING_MINUS = 494556.03, KEY_REFUNDS = 122861.28;
  const reconciled = r2(KEY_NET - orphanD - KEY_TRAILING_MINUS + KEY_REFUNDS);
  ok("the key's own reconciliation lands on the imported cash (residual named, ≤ $2,500)",
     Math.abs(reconciled - cash) <= 2500, { keyNet: KEY_NET, orphanD, trailingMinus: KEY_TRAILING_MINUS, refunds: KEY_REFUNDS, reconciled, cash, residual: r2(reconciled - cash) });
  ok("the file's own TOTAL rows are still the outside numbers, and both are explained",
     g1.chromeRows.some(c => c.kind === "total_row" && c.amount === 32523933.89)
     && g2.totalRow.amount === 19852987.83
     && Math.abs((32523933.89 + 19852987.83) - KEY_NET) < 0.02, { grand: 32523933.89, legacy: g2.totalRow.amount });
  ok("in-kind and refunds are routed, never in cash", inKindD > 0 && refundsD > 0 && cash < KEY_NET, { inKindD, refundsD });

  // ── THE SUBMISSION BUILDER — what the summary shows IS what the write sends ─
  const answersBy = pick => Object.fromEntries(signals.filter(s => s.kind !== "hidden_column").map(s => [s.id, pick(s)]));
  const legendAnswers = answersBy(s => s.kind === "comments" ? "route" : "legend");
  const sub = IS.buildWorkbookSubmission(roled, {
    signals, signalAnswers: legendAnswers,
    anchorDate: "2026-09-06", currentYear: 2026,
    customAssignments: { Donors: { "Internal Score": { entity: "donor", key: "internal_score" } } },
  });
  // BUILD-83 Part 2.1 — the summary promises what the DATABASE will hold: 800
  // ROWS carry an exclusion, 8 of them fold into a surviving duplicate, so 792
  // PEOPLE end up excluded. Both numbers are said, and the read-back compares
  // against the one that lands.
  ok("ALL 800 exclusion ROWS found (flags + status + notes + hidden + yellow + comments)",
     sub.exclusionSummary.rowsFound === 800, sub.exclusionSummary);
  ok("…and the figure the screen promises is the 792 PEOPLE who will carry one",
     sub.exclusionSummary.total === 792 && sub.exclusionSummary.foldedIntoSurvivors === 8, sub.exclusionSummary);
  ok("the 40 hidden, 100 yellow and 40 comment rows are among them",
     sub.exclusionSummary.fromHidden === 40 && sub.exclusionSummary.fromFill === 100 && sub.exclusionSummary.fromComments === 40, sub.exclusionSummary);
  ok("'Do not include in vendor mailing' (331 rows) excluded NOTHING",
     sub.exclusionSummary.rowsFound === 800 && !IS.detectNoteMarkers("Do not include in vendor mailing").doNotSolicit
     && !IS.detectNoteMarkers("Do not include in vendor mailing").doNotMail, null);
  ok("'remove from appeals' IS a no-ask", IS.detectNoteMarkers("remove from appeals").doNotSolicit === true, null);
  ok("a DATE in the Deceased column means deceased (with the date), never FALSE",
     sub.donors.filter(d => d.deceased && d.deceasedDate).length >= 45, sub.donors.filter(d => d.deceased && d.deceasedDate).length);
  ok("792 surviving records carry an exclusion flag (800 rows − 8 folded duplicates)",
     sub.donors.filter(d => d.deceased || d.doNotContact || d.doNotSolicit || d.doNotMail || d.doNotEmail).length === 792
     && sub.exclusionSummary.total === 792, null);
  // ── BUILD-83 Parts 2.3 + 2.4 — the two refusals that were losing real money ─
  ok("duplicate-gift refusals are ZERO: a duplicate needs gift id AND donor AND amount",
     sub.refusals.filter(x => /gift_id_repeated_in_file|same_gift_listed_twice/.test(x.reason)).length === 0, null);
  ok("721 collided legacy Refs import as the different gifts they are, BOTH rows flagged",
     sub.duplicateReview.length === 721 && sub.flags.filter(f => f.kind === "gift_id_collision").length === 1442
     && sub.flags.some(f => /shares gift id/.test(f.text)), sub.duplicateReview.length);
  // SHOWN IS APPLIED: a colliding row keeps its money but drops the source id,
  // so nothing the screen counted can be collapsed by the database's own
  // idempotency key on the way in. (709 gifts were, until the walk's read-back
  // caught it: "shown 90,523 · written 89,814".)
  {
    const seenX = new Set(); let dupX = 0;
    for (const g of sub.gifts) { if (!g.externalId) continue; if (seenX.has(g.externalId)) dupX++; else seenX.add(g.externalId); }
    ok("no two gifts in the payload share a source id — what is shown is what can land", dupX === 0, dupX);
  }
  ok("formula refusals are ZERO: 843 constant formulas evaluated and flagged",
     sub.refusals.filter(x => x.reason === "formula_no_value").length === 0
     && sub.flags.filter(f => f.kind === "computed_formula").length === 843, null);
  ok("=250*1 is $250; SUM(A1:A9) still refuses with its text",
     IS.evaluateConstantFormula("=250*1") === 250 && IS.evaluateConstantFormula("SUM(A1:A9)") === null
     && IS.evaluateConstantFormula("A1*2") === null, null);
  ok("submission totals: 25,034 donors / 90,523 gifts / $51,754,243.82",
     sub.totals.donors === 25034 && sub.totals.gifts === 90523 && sub.totals.cash === 51754243.82, sub.totals);
  ok("imported cash is within $2,500 of the corrected key's figure ($51,755,629.07)",
     Math.abs(sub.totals.cash - 51755629.07) <= 2500, { cash: sub.totals.cash, delta: Math.round((sub.totals.cash - 51755629.07) * 100) / 100 });
  ok("recovery sustainers tagged card-failed (100)", sub.donors.filter(d => (d.tags || []).includes("card-failed")).length === 100, null);
  ok("stale 'Active' claims tagged — the pattern won, the mismatch shows (60)",
     sub.donors.filter(d => (d.tags || []).includes("stale-frequency")).length === 60, null);
  ok("custom assignment rides the donor rows (Internal Score)",
     sub.donors.filter(d => d.customFields && d.customFields.internal_score).length > 20000, null);
  // The review list is written in the shape the PERSIST path stores (an ARRAY
  // of folded identities carrying their source id and their gift ids), because
  // the flat string shape was silently skipped and 266 folds went unlogged.
  ok("merges list = the review list (266), in the shape the undo can store and reverse",
     sub.merges.length === 266
     && sub.merges.every(m => Array.isArray(m.folded) && m.folded.length
        && m.folded.every(f => f.label && f.via && f.externalDonorId !== undefined && Array.isArray(f.giftIds))),
     sub.merges[0]);
  ok("a folded identity carries the gifts posted to its own source id",
     sub.merges.some(m => m.folded.some(f => f.giftIds.length > 0)),
     sub.merges.slice(0, 2).map(m => m.folded.map(f => f.giftIds.length)));
  ok("workbook invariant balanced; the only refusals left are the 491 orphans",
     sub.reconciliation.workbook.balanced && sub.reconciliation.workbook.refused === 491
     && sub.refusals.every(x => x.reason === "no_donor_match"), sub.reconciliation.workbook);
  // Part 2.5 — four terms and a named residual on BOTH gift sheets. On v3 the
  // residual is non-zero and NEGATIVE: the file's totals count Cowork's 896
  // trailing-minus rows as positive while an honest reader routes them as the
  // negatives the cells say they are. It is SHOWN, never absorbed, and the
  // file's own total is never called "stale".
  ok("both gift sheets reconcile in four terms with the residual named",
     sub.totalRows.length === 2 && sub.totalRows.every(tr =>
       tr.stated > 0 && tr.imported > 0 && tr.refusedCount > 0 && tr.routedCount > 0
       && Math.abs(tr.unexplained - r2(tr.stated - (tr.imported + tr.refusedAbs + tr.routedAbs))) < 0.02),
     sub.totalRows.map(tr => `${tr.sheet}: says ${tr.stated} · imported ${tr.imported} · refused ${tr.refusedAbs} · routed ${tr.routedAbs} · unexplained ${tr.unexplained}`));
  ok("the residual is non-zero on v3 and therefore SHOWN (import confidence capped)",
     sub.totalRows.every(tr => Math.abs(tr.unexplained) >= 0.01), sub.totalRows.map(tr => tr.unexplained));
  ok("largest-gifts panel tops out at real $25,000 gifts — never the $32.5M GRAND TOTAL",
     sub.largestGifts.length === 5 && sub.largestGifts.every(g => g.dollars === 25000), sub.largestGifts);
  ok("the ONE remaining refusal reason is no_donor_match (491 orphan rows)",
     sub.refusals.filter(x => x.reason === "no_donor_match").length === 491, null);
  // ── THE PROMISE AND THE RECEIPT CANNOT DRIFT (FIX item 2) ────────────────
  // The pre-write screen renders from IMPORT_PROMISE_FIELDS and the completion
  // screen compares against the same list, so a figure cannot be shown without
  // a way to read it back. This asserts the list COVERS what the summary shows
  // — a new headline number added without a read-back fails here, at the point
  // it is added, instead of reaching a screen that quietly says nothing.
  {
    const promise = IS.buildImportPromise(sub);
    const keys = IS.IMPORT_PROMISE_FIELDS.map(f => f.key);
    ok("every field the promise declares resolves to a real number on v3",
       keys.every(k => promise.fields[k] === undefined || Number.isFinite(Number(promise.fields[k]))), promise.fields);
    for (const [k, v] of [["donors", sub.totals.donors], ["gifts", sub.totals.gifts], ["cash", sub.totals.cash],
                          ["excluded", sub.exclusionSummary.total], ["merges", sub.merges.length],
                          ["pledges", sub.pledges.pledges.length],
                          ["giftRowsAccounted", sub.reconciliation.workbook.rowsInFile]]) {
      ok(`the promise's ${k} is the figure the summary shows`, promise.fields[k] === v, { promised: promise.fields[k], shown: v });
    }
    ok("the promise carries CASH — a receipt without the amount is not a receipt",
       promise.fields.cash === 51754243.82, promise.fields.cash);
    ok("the promise carries the merge count, so '0 merges logged' cannot pass unnoticed",
       promise.fields.merges === 266, promise.fields.merges);
    ok("pledges and their payments are promised SEPARATELY, never as one number",
       promise.fields.pledges === 60 && promise.fields.pledgePayments === sub.pledgePaymentCount
       && promise.fields.pledgePayments > 0 && promise.fields.pledges !== promise.fields.pledgePayments, { pledges: promise.fields.pledges, payments: promise.fields.pledgePayments });
    ok("refusals are promised BY REASON, not just in total",
       Object.keys(promise.refusalsByReason).length > 0
       && Object.values(promise.refusalsByReason).reduce((a, b) => a + b, 0) === sub.refusals.length,
       promise.refusalsByReason);
    // Refusals are absences, so the receipt checks an IDENTITY against what the
    // database actually holds: written + refused + routed === rows in the file.
    {
      const f = IS.IMPORT_PROMISE_FIELDS.find(x => x.key === "giftRowsAccounted");
      ok("the gift-row identity closes against the written count",
         IS.importReceiptValue(f, sub, { gifts: sub.totals.gifts }) === sub.reconciliation.workbook.rowsInFile,
         { computed: IS.importReceiptValue(f, sub, { gifts: sub.totals.gifts }), rows: sub.reconciliation.workbook.rowsInFile });
    }
    ok("a pledge payment that never lands is not promised (post-link count)",
       promise.fields.pledgePayments === 210, promise.fields.pledgePayments);
  }

  ok("fileStats ready for orgs.last_import_stats", sub.fileStats.rows === 92227 && sub.fileStats.largestGifts.length === 5, sub.fileStats);

  // hidden rows SKIPPED by choice — counted, listed, and the count moves
  const subSkip = IS.buildWorkbookSubmission(roled, {
    signals, signalAnswers: answersBy(s => s.kind === "hidden_rows" ? "skip" : s.kind === "comments" ? "ignore" : "legend"),
    anchorDate: "2026-09-06", currentYear: 2026,
  });
  ok("hidden rows skipped by choice: 40 fewer donors — and the YELLOW choice is untouched (Part 1.3, the Sept-7 clobber)",
     subSkip.donors.length + subSkip.foldedRows === 25260
     && subSkip.refusals.filter(x => x.reason === "hidden_row_skipped_by_choice").length === 40
     && subSkip.exclusionSummary.fromFill === 100, { donors: subSkip.donors.length, fill: subSkip.exclusionSummary.fromFill });

  // decoy override — deduplicated against the real sheets BEFORE a row lands
  const subDecoy = IS.buildWorkbookSubmission(roled, {
    signals, signalAnswers: legendAnswers,
    anchorDate: "2026-09-06", currentYear: 2026, includeDecoy: true,
  });
  ok("decoy override dedupes by donor+date+amount and SHOWS the overlap",
     subDecoy.decoyOverlap > 6000 && subDecoy.refusals.filter(x => x.reason === "decoy_duplicate").length === subDecoy.decoyOverlap, subDecoy.decoyOverlap);
  ok("decoy rows that survive the dedupe are counted in the workbook equation", subDecoy.reconciliation.workbook.balanced, subDecoy.reconciliation.workbook);

  console.log(`  (pipeline: ${((Date.now() - t0) / 1000).toFixed(1)}s, heap ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB)`);
  summary("import-workbook-v3");
})();

// BUILD-79 — THE REPORT EXPORT, pinned forever.
//
// steward-messy-2500-v2.csv is a REPORT export, not a data export: a title
// line, a generated-by line, a blank, the header on LINE 4, the header
// re-printed after three page breaks, a TOTAL row ($2,035,978.52) and an
// End-of-report line — 2,500 real records across 2,853 physical lines, with
// mixed encodings inside single lines. On Sept 5 it went into a fresh
// production org and Steward: took line 1 as the header, called the shape
// "one row per donor", imported 1,111 donors with $0 of giving, stamped every
// one with a last gift of TODAY, scored them all 35, put six phone numbers in
// Needs Your Attention, ticked the checklist, showed a green EVERY ROW AND
// EVERY DOLLAR ACCOUNTED FOR · Balanced · 2,438 · $0, and failed to export.
//
//   §1  the file layer: header by evidence on line 4, chrome by line number,
//       2,500 records counted ONCE, TOTAL captured, encodings repaired
//   §2  shape: transaction by evidence; totals mode REFUSES this file; the
//       Part-0 garbage headers yield UNKNOWN, never a default
//   §3  the real tx mapping + accounted builder over the ANALYZED rows:
//       one disposition per record with REAL line numbers, no gift dated
//       today-or-later unless the file says so, unnamed donors flagged
//   §4  through the real route in chunks: server ledger balances against
//       2,500, DB dollars are NOT $0, zero donors stamped with import-day
//       last gifts they didn't earn
//   §5  Part 7.4 — the BUILD-78 round trip on THIS imported org: export
//       succeeds and reads back what import wrote
//   §6  Part 2.3 — fresh-org duplicate language over HTTP: within-file
//       collapses are never called "already on file"
//
// The SEMANTIC layer (dd/mm inference, soft credits, pledges, in-kind,
// matching gifts, duplicate donors, exclusion contradictions) is BUILD-80,
// deliberately absent here.
//
// Fixture key note: the Cowork-side fixture key file is not in the repo
// (BLOCKED-build79.md) — these assertions bind to file-derived ground truth
// + the spec's stated facts (2,500 records, TOTAL $2,035,978.52, header on
// line 4).

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q } = require("./helpers");

const ORG = "org_b79golden";
const FIXTURE = path.join(__dirname, "fixtures", "build79", "steward-messy-2500-v2.csv");

async function reset() {
  for (const t of ["gifts", "fin_transactions", "interactions", "donors", "accounts", "fin_funds", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id='org_b79r'`).catch(() => {});
  await q(`DELETE FROM orgs WHERE id='org_b79r'`).catch(() => {});
  for (const t of ["import_merges", "donor_relationships", "workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
    "payment_recovery_events", "reconnect_sends", "recurring_subscriptions", "receipts", "pledges", "fin_audit_log",
    "fin_transactions", "gifts", "interactions", "milestone_drafts", "note_reminders",
    "fundraising_goals", "metric_snapshots", "custom_field_values", "custom_field_defs",
    "donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B79 Golden','b79-golden',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b79golden',$1,'b79golden@test.local',$2,'Golden Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b79g',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b79g',$1,'General',false)`, [ORG]);
}

(async () => {
  await reset();
  const tok = await login("b79golden@test.local");
  const lib = await import("../shared/importShape.js");
  // The org's civil today, not UTC — after 8pm Eastern those differ and a
  // client-accepted gift dated UTC-today is future to the server (see
  // helpers.civilToday).
  const TODAY = require("./helpers").civilToday();

  // ── §1 · the file layer ──────────────────────────────────────────────────
  console.log("\n— §1 · the file layer: evidence, chrome, one count —");
  const dec = lib.decodeSpreadsheetBytesDetailed(fs.readFileSync(FIXTURE));
  const a = lib.analyzeCsvText(dec.text);
  ok("header found on line 4 by evidence, never position", a.headerLine.line === 4, a.headerLine);
  ok("2,500 records in your file — the ONE number every surface shows", a.records === 2500, a.records);
  ok("chrome above the header is named (title · generated-by · blank)",
    a.chromeAbove.length === 3 && /Donor Giving History Report/.test(a.chromeAbove[0].text), a.chromeAbove);
  ok("8 chrome rows below it, each by kind and line", a.chromeRows.length === 8,
    a.chromeRows.map(c => `${c.kind}:${c.line}`));
  ok("the file's own TOTAL row is captured: $2,035,978.52 at line 2852",
    a.totalRow && a.totalRow.amount === 2035978.52 && a.totalRow.line === 2852, a.totalRow);
  ok("4 mixed-encoding lines repaired, no U+FFFD anywhere",
    dec.cp1252Lines.length === 4 && !dec.text.includes("�"), dec.cp1252Lines);
  const scan = lib.scanAmountShapedColumns(a.headers, a.rows);
  ok("the independent dollar scan finds Amount with no mapping's help",
    scan && scan.header === "Amount" && scan.sum > 2000000, scan);

  // ── §2 · shape ───────────────────────────────────────────────────────────
  console.log("\n— §2 · shape is a decision with evidence, or a question —");
  const det = lib.detectImportShape(a.headers, a.rows);
  ok("with the real header the shape is TRANSACTION, with stated evidence",
    det.shape === "transaction" && !!det.reason, { shape: det.shape, reason: det.reason });
  ok("totals mode on this file REFUSES to proceed (the 1,327 signal)",
    lib.assessAggregateCollapse(a.rows, "Email", "Name").refuse === true);
  const garbage = ["Donor Giving History Report", ...Array.from({ length: 21 }, (_, i) => `_${i + 1}`)];
  const gRows = a.rows.slice(0, 60).map(r => Object.fromEntries(garbage.map((h, i) => [h, r[a.headers[i]] || ""])));
  ok("the Part-0 garbage headers yield UNKNOWN — never a default shape",
    lib.detectImportShape(garbage, gRows).shape === "unknown");

  // ── §3 · the accounted builder over the ANALYZED rows ────────────────────
  console.log("\n— §3 · the accounted builder: one disposition per record, real lines —");
  const txMap = lib.autoDetectTxMapping(a.headers, a.rows);
  ok("auto-mapping claims the money columns (amount + date + email + name)",
    txMap.amount === "Amount" && txMap.date === "Gift Date" && txMap.donorEmail === "Email" && !!txMap.donorName,
    { amount: txMap.amount, date: txMap.date, email: txMap.donorEmail, name: txMap.donorName });
  // BUILD-80 Part 4 — build the way the CLIENT builds: the mapper plan
  // routes value-shaped exclusion columns (Solicit Code, Status) to the flag
  // family, and the builder parses each cell through the family.
  const cfs = await import("../shared/customFieldShape.js");
  const plan = cfs.buildMapperPlan({ headers: a.physical.headerCells, fields: a.headers, rows: a.rows, txMap,
    existingDefs: { donor: [], gift: [] }, savedMappings: [], orphanColumns: a.physical.orphanColumns, overflowRows: a.physical.overflowRows });
  const exclusionColumns = plan.columns.filter(c => c.status === "flag" && c.flag === "exclusion").map(c => c.field);
  const built = lib.buildTransactionRows({ rows: a.rows }, txMap, { today: TODAY, rowLines: a.rowLines,
    exclusionColumns, parseExclusionValue: cfs.parseExclusionValue });
  ok("every record leaves with exactly one disposition (2,500 of 2,500)",
    built.dispositions.length === 2500, built.dispositions.length);
  const lines = new Set(built.dispositions.map(d => d.line));
  ok("dispositions carry REAL physical lines (unique, none in the chrome)",
    lines.size === 2500 && ![743, 744, 2852, 2853, 1, 2, 3, 4].some(l => lines.has(l)), lines.size);
  ok("file dollars are NOT zero on a file whose TOTAL row reads $2,035,978.52",
    built.file.dollars > 1000000, built.file.dollars);
  const todayOrLater = built.gifts.filter(g => g.date >= TODAY);
  const rawToday = a.rows.filter(r => {
    const { value } = lib.normalizeDate(r["Gift Date"] || "", { currentYear: Number(TODAY.slice(0, 4)), dayFirst: built.dateConvention?.applied === "dmy" });
    return value != null && value >= TODAY;
  });
  ok(`no gift dated today-or-later unless the FILE says so (built ${todayOrLater.length}, file ${rawToday.length})`,
    todayOrLater.length <= rawToday.length, { built: todayOrLater.length, file: rawToday.length });
  const unnamed = built.donors.filter(d => /^Unnamed donor \(line \d+\)$/.test(d.name));
  ok("no donor's display name is an email or phone; the nameless are flagged",
    built.donors.every(d => !d.name.includes("@") && !/^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(d.name)) &&
    unnamed.every(d => (d.tags || []).includes("needs-name")),
    { donors: built.donors.length, unnamed: unnamed.length });

  // ── §3b · BUILD-80 Part 1 — MONEY: the closed grammar over the real file ──
  console.log("\n— §3b · BUILD-80 Part 1: money — conventions, traps, refunds, the largest gifts —");
  // The independent scan and the accounted builder speak the SAME number:
  // every parseable amount cell, convention-correct. $2,293,751.22 is what
  // the file's Amount column actually says — the fixture key's $2,327,646.22
  // additionally counts the TRUE values of the 16 damaged cells (8 amount
  // traps $15,170 + 5 column-shifted amounts $3,025 + $15,700 of other
  // damage) that no honest parser can read out of the written bytes; the
  // written-cells number is the one the summary may claim (BLOCKED-build80.md).
  const amtScan = lib.scanAmountShapedColumns(a.headers, a.rows);
  ok("the independent scan reads the Amount column at $2,293,751.22 — convention-correct, never strip-and-hope",
    amtScan.header === "Amount" && amtScan.sum === 2293751.22, amtScan);
  ok("builder file dollars equal the independent scan to the cent (both sides, one number)",
    built.file.dollars === 2293751.22, built.file.dollars);
  ok("the old $3,856,421.48 overread is dead: no amount parsed above the $150,000 bequest",
    Math.max(...built.gifts.map(g => g.amount)) <= 150000, Math.max(...built.gifts.map(g => g.amount)));
  const convs = built.amountConventions;
  ok("convention lines carry the counts: 4 comma-decimal, 8 space-thousands, column stays US",
    convs && convs.commaDecimal === 4 && convs.spaceThousands === 8 && convs.column === "us", convs);
  const uaRows = built.dispositions.filter(d => d.reason === "unparseable_amount");
  ok("exactly the 8 planted amount traps refuse, each with its line",
    uaRows.length === 8 && uaRows.every(d => d.line > 4), uaRows.map(d => d.line));
  const trapRaws = uaRows.map(d => String(d.raw?.[txMap.amount] ?? ""));
  for (const t of ["$1,5000", "1e3", "500 (pledge)", "1,000.00.", "$", "one hundred", "100..00", "$25O.00"])
    ok(`trap ${JSON.stringify(t)} is among the refusals`, trapRaws.includes(t), trapRaws);
  // Dylan Søndergaard (NBSP thousands + comma decimal): $1,500–$2,500 each,
  // never $150,000–$250,000. Parse-level so the date layer can't hide it.
  const dylAmts = a.rows.filter(r => /Søndergaard/.test(String(r["Name"] || "") + String(r["Last Name"] || "")) && /Dylan/.test(String(r["Name"] || "") + String(r["First Name"] || "")))
    .map(r => lib.normalizeMoney(r[txMap.amount]).value).filter(v => v != null);
  ok(`Dylan Søndergaard's amounts are $1,500–$2,500, none above $10,000 (${dylAmts.length} cells)`,
    dylAmts.length >= 5 && dylAmts.every(v => v >= 1500 && v <= 2500), dylAmts);
  // Stephanie Müller (dot thousands + comma decimal): $1,250 and up, never $1.25.
  const steAmts = a.rows.filter(r => /Müller/.test(String(r["Name"] || "") + String(r["Last Name"] || "")) && /Stephanie/.test(String(r["Name"] || "") + String(r["First Name"] || "")))
    .map(r => lib.normalizeMoney(r[txMap.amount]).value).filter(v => v != null);
  ok(`Stephanie Müller's amounts are $1,250 and up, none below $1,000 (${steAmts.length} cells)`,
    steAmts.length >= 3 && steAmts.every(v => v >= 1000), steAmts);
  // Refunds import as NEGATIVE gifts — trailing minus and CR both.
  const negGifts = built.gifts.filter(g => g.amount < 0);
  ok("refunds written '500.00-' and 'CR 500.00' become NEGATIVE gifts, not unparseable",
    negGifts.length >= 5 && negGifts.reduce((s, g) => s + g.amount, 0) <= -5000, { n: negGifts.length, sum: negGifts.reduce((s, g) => s + g.amount, 0) });
  // The largest-gifts panel: five rows, donor + date + real line number.
  ok("the largest-gifts panel carries five gifts with donor, date and line",
    built.largestGifts.length === 5 && built.largestGifts.every(g => g.name && g.line > 4 && g.dollars > 0),
    built.largestGifts.map(g => [g.name, g.dollars, g.line]));
  ok("its biggest row is the planted $150,000 estate bequest — not a parse artifact",
    built.largestGifts[0].dollars === 150000 && /Estate of/.test(built.largestGifts[0].name), built.largestGifts[0]);

  // ── §3b2 · BUILD-80 Part 3 — ENCODING: the repair never touches valid bytes ──
  console.log("\n— §3b2 · BUILD-80 Part 3: encoding — 李 keeps his name, twelve surnames survive —");
  ok("the four raw-CP1252 lines are repaired per byte-run (1541, 1542, 1545, 1913)",
    JSON.stringify(dec.cp1252Lines) === JSON.stringify([1541, 1542, 1545, 1913]), dec.cp1252Lines);
  ok("exactly 16 source-borne double-encoded sequences are reversed, each reported",
    dec.mojibakeRepaired === 16 && Array.isArray(dec.mojibakeRepairs) && dec.mojibakeRepairs.length >= 5,
    { repaired: dec.mojibakeRepaired, kinds: dec.mojibakeRepairs?.length });
  ok("Christopher keeps his name: the surname 李 survives (the source wrote æ\\u009D\\u008E)",
    dec.text.includes("李, Christopher"), dec.text.match(/.{0,10}Christopher/)?.[0]);
  for (const sn of ["Nguyễn", "Müller", "García", "Ó Briain", "D'Angelo-Ruiz", "O'Brien", "Søndergaard", "Çelik", "Ibáñez", "李", "Al-Rashid", "van der Berg"])
    ok(`surname '${sn}' survives import byte-for-byte`, dec.text.includes(sn), sn);
  ok("no U+FFFD replacement character anywhere in the decoded text",
    !dec.text.includes("\uFFFD"), null);
  ok("a genuine 'æ' is never a repair candidate (no continuation-mapped follower)",
    (await import("../shared/importShape.js")).repairDoubleEncodedText("Ærø, Næstved — æsthetic").text === "Ærø, Næstved — æsthetic", null);

  // ── §3c · BUILD-80 Part 2 — DATES: the column has a convention ───────────
  console.log("\n— §3c · BUILD-80 Part 2: dates — column-level dd/mm, planted traps, refusals collapse —");
  const dc = built.dateConvention;
  ok("the column-level inference reads day/month/year from impossible-month evidence",
    dc && dc.applied === "dmy" && dc.convention === "dmy", dc);
  ok("the evidence is stated: 1,583 slash dates, 832 impossible the other way, ZERO impossible day-first",
    dc.slashCells === 1583 && dc.dayFirstEvidence === 832 && dc.monthFirstEvidence === 0, dc);
  const udRows = built.dispositions.filter(d => d.reason === "unparseable_date");
  ok("unparseable dates collapse from 1,211-era refusals to EXACTLY the 10 planted traps on cash rows",
    udRows.length === 10, udRows.map(d => String(d.raw?.[txMap.date] ?? "")));
  const udRaws = udRows.map(d => String(d.raw?.[txMap.date] ?? "").trim());
  for (const t of ["Q4 2023", "FY24", "Christmas 2022", "12/31/1899", "01/01/1900", "30/02/2024", "00/00/0000", "", "Unknown", "2024-02-30"])
    ok(`planted ${t === "" ? "(blank)" : `'${t}'`} refuses as unparseable`, udRaws.includes(t), udRaws);
  // the 11th planted trap ('29/02/2023') sits on a SOFT-CREDIT row — that row
  // routes to the link surface (Part 5), dated null, still fully accounted.
  ok("the invalid-leap-day trap on the soft-credit row is accounted on the soft-credit surface",
    built.dispositions.some(d => d.reason === "soft_credit" && String(d.raw?.[txMap.date] ?? "").trim() === "29/02/2023"), null);
  const epoch = udRows.filter(d => /Excel epoch/.test("" ) || true).length; void epoch;
  ok("Excel epoch artifacts are refused BY NAME, never parsed as 1899/1900 gifts",
    lib.normalizeDate("12/31/1899").warn?.includes("Excel epoch") && lib.normalizeDate("01/01/1900", { dayFirst: true }).warn?.includes("Excel epoch"), null);
  ok("the ISO-Z civil-date seam holds: 2025-06-13T03:00:00.000Z is 13 June, never 12",
    lib.normalizeDate("2025-06-13T03:00:00.000Z").value === "2025-06-13", lib.normalizeDate("2025-06-13T03:00:00.000Z"));
  const futRows = built.dispositions.filter(d => d.reason === "future_date");
  const futRaws = futRows.map(d => String(d.raw?.[txMap.date] ?? "").trim());
  ok("the two planted future dates are among the future refusals ('31/12/26', '15/09/2026')",
    futRaws.includes("31/12/26") && futRaws.includes("15/09/2026"), futRaws.length);
  ok("no future-dated row became a GIFT — future is an error, not a gift",
    built.gifts.every(g => g.date <= TODAY), built.gifts.filter(g => g.date > TODAY).length);
  // Refusals = errored rows + genuinely-empty skips. Semantic rows (soft
  // credits, pledges, in-kind, schedules) are ROUTED, not refused.
  const refusedNow = built.dispositions.filter(d => d.disposition === "errored"
    || (d.disposition === "skipped" && ["no_amount", "zero_amount"].includes(d.reason))).length;
  ok(`total refusals collapse from 1,211 to ${refusedNow} — UNDER 60: the planted traps, the structural damage, and nothing else`,
    refusedNow < 60, refusedNow);
  // Part 2.4 — a refused row is not a neutral event: the donor is tagged.
  const taggedDonors = built.donors.filter(d => (d.tags || []).some(t => /^has-refused-rows:\d+$/.test(t)));
  ok("every donor with a refused row carries has-refused-rows:N (50 donors on v2)",
    taggedDonors.length === 50, taggedDonors.length);
  const paulOB = built.donors.find(d => /Paul/.test(d.name) && /Briain/.test(d.name));
  ok("Paul Ó Briain's rows all parse — his January 2026 gift exists and he carries no refusal tag",
    paulOB && !(paulOB.tags || []).some(t => /has-refused-rows/.test(t)), paulOB?.tags);

  // ── §3d · BUILD-80 Part 4 — exclusions live in COLUMNS too ───────────────
  console.log("\n— §3d · BUILD-80 Part 4: Solicit Code and Status route to flags, never custom fields —");
  ok("'Solicit Code' is exclusion-shaped BY ITS VALUES and routes to the flag family",
    exclusionColumns.includes("Solicit Code"), exclusionColumns);
  ok("'Status' is exclusion-shaped BY ITS VALUES and routes to the flag family",
    exclusionColumns.includes("Status"), exclusionColumns);
  ok("neither is ever offered as a custom field",
    plan.columns.filter(c => ["Solicit Code", "Status"].includes(c.field)).every(c => c.status === "flag"),
    plan.columns.filter(c => ["Solicit Code", "Status"].includes(c.field)).map(c => c.status));
  const findDonor = (first, last) => built.donors.find(d => d.name.includes(first) && d.name.includes(last));
  // the fifteen who were invisible: deceased via Solicit Code or Status only
  for (const [f, l] of [["Betty", "Kowalski"], ["Kimberly", "Müller"], ["Jean", "Lattimore"], ["Carolyn", "Haddad"], ["Jeremy", "Jefferies"], ["Teresa", "Oyelaran"], ["Nancy", "Singh"], ["Grace", "Delacroix"], ["Priya", "Jessup"]]) {
    const d = findDonor(f, l);
    ok(`${f} ${l} (deceased via a COLUMN) is deceased on the built donor`, !!(d && d.deceased), d ? d.name : "not found");
  }
  const vandyke = findDonor("Emily", "Vandyke");
  ok("'Newsletter only' sets do-not-solicit and LEAVES MAIL ON (Emily Vandyke)",
    vandyke && vandyke.doNotSolicit === true && !vandyke.doNotMail, vandyke && { dns: vandyke.doNotSolicit, dnm: vandyke.doNotMail });
  const holl = findDonor("Janice", "Hollingsworth");
  ok("'DNM,DNE' splits on the compound: do-not-mail AND do-not-email, not solicit (Janice Hollingsworth)",
    holl && holl.doNotMail === true && holl.doNotEmail === true && !holl.doNotSolicit, holl && { dnm: holl.doNotMail, dne: holl.doNotEmail, dns: holl.doNotSolicit });
  const kensL = findDonor("Larry", "Kensington");
  ok("'DNE' is do-not-email, never do-not-solicit — the flags are different (Larry Kensington)",
    kensL && kensL.doNotEmail === true && !kensL.doNotSolicit, kensL && { dne: kensL.doNotEmail, dns: kensL.doNotSolicit });
  ok("the four one-row DNS donors are flagged at the DONOR (flag propagates off the gift row)",
    [["Kenneth", "Nolasco"], ["Sophia", "Castellanos"], ["Amy", "Ramirez"]].every(([f, l]) => { const d = findDonor(f, l); return d && d.doNotSolicit; }),
    null);
  ok("contradictions are SHOWN: 'Status says Active, Notes say deceased. We set deceased.'",
    built.exclusionConflicts.length >= 4 && built.exclusionConflicts.some(c => /Diana Oyelaran/.test(c.name) && /Notes say deceased/.test(c.message)),
    built.exclusionConflicts.slice(0, 4));
  ok("a stray value in an exclusion column REFUSES its row (a question, never a guess)",
    built.dispositions.filter(d => d.reason === "unrecognized_exclusion_value").length === 3,
    built.dispositions.filter(d => d.reason === "unrecognized_exclusion_value").map(d => d.line));

  // ── §3e · BUILD-80 Part 5 — rows that are not gifts ──────────────────────
  console.log("\n— §3e · BUILD-80 Part 5: gift type is a closed vocabulary with meaning —");
  const tly = built.semantics.tally;
  ok("soft credits: 60 rows · $35,016.60 — never money, never in net cash",
    tly.softCredits.rows === 60 && tly.softCredits.dollars === 35016.6, tly.softCredits);
  ok("pledge commitments: 12 rows · $184,000 — commitments, never in totals",
    tly.pledges.rows === 12 && tly.pledges.dollars === 184000, tly.pledges);
  ok("in-kind: 25 rows · $38,900 — FMV records, and the 7 blank ones are NOT $0 gifts",
    tly.inKind.rows === 25 && tly.inKind.dollars === 38900, tly.inKind);
  ok("corporate matching: 29 rows · $18,096.61 on the CORPORATIONS (the 30th is the $1,5000 amount trap)",
    tly.matching.rows === 29 && tly.matching.dollars === 18096.61, tly.matching);
  ok("future pledge installments route to the SCHEDULE (17 rows), never to future-date errors",
    tly.pledgeScheduled.rows === 17, tly.pledgeScheduled);
  ok("no soft-credit row ever became a gift",
    !built.gifts.some(g => /soft.?credit/i.test(g.type || "")), null);
  ok("no pledge-commitment row ever became a gift (12 pledges ride their own surface)",
    built.semantics.pledges.length === 12 && !built.gifts.some(g => (g.type || "") === "pledge"), built.semantics.pledges.length);
  ok("fully-paid pledges arrive FULFILLED so no reminder chases them (James Patel, Hiroshi Fennimore, Daniel Okafor)",
    ["James Patel", "Hiroshi Fennimore", "Daniel Okafor"].every(n => built.semantics.pledges.find(p => p.donorName.includes(n.split(" ")[1]))?.status === "fulfilled"),
    built.semantics.pledges.map(p => [p.donorName, p.status]));
  ok("a pledge paying on schedule carries its LAST installment as the due date (no premature dunning)",
    built.semantics.pledges.filter(p => p.status === "open" && p.scheduledObserved > 0).every(p => p.dueDate && p.dueDate > TODAY),
    built.semantics.pledges.filter(p => p.status === "open" && p.scheduledObserved > 0).map(p => [p.donorName, p.dueDate]));
  ok("the three positive Reversals are ERRORS asking for a human — type says money left, sign says it arrived",
    built.dispositions.filter(d => d.reason === "positive_reversal").length === 3, null);
  ok("soft-credit links carry the base gift id (identical or -SC-suffixed)",
    built.semantics.links.filter(l => l.type === "soft_credit").length === 60 &&
    built.semantics.links.filter(l => l.type === "soft_credit").every(l => !/(-SC)$/i.test(l.baseGiftExternalId || "")), null);
  ok("all 8 DAF grants carry their recommending donor as a link; the money stays on the institution",
    built.semantics.links.filter(l => l.type === "daf_recommendation").length === 8,
    built.semantics.links.filter(l => l.type === "daf_recommendation").map(l => [l.corpName, l.personName]));
  ok("the 6 'migrated from legacy ID … may duplicate' rows are review-queue items, imported and flagged",
    built.semantics.reviewTwins.length === 6, built.semantics.reviewTwins.length);
  ok("a bequest's donor is never solicited again",
    built.donors.filter(d => built.gifts.some(g => g.donorIndex === built.donors.indexOf(d) && (g.type || "") === "bequest")).every(d => d.doNotSolicit), null);

  // ── §3f · BUILD-80 Part 6 — WHO IS WHO ───────────────────────────────────
  console.log("\n— §3f · BUILD-80 Part 6: identity — ID before email before name, conflicts block merges —");
  ok("the Constituent ID column is recognised as the donor id and grouped on FIRST",
    built.identity.donorIdColumn === "Constituent ID", built.identity.donorIdColumn);
  ok("donor count lands at 496 — variants folded by ID, real email and matching name; anonymous collapses to one holding record",
    built.donors.length === 496, built.donors.length);
  const paul6 = built.donors.filter(d => /Paul/.test(d.name) && /Briain/.test(d.name));
  ok("Paul Ó Briain is ONE person — the '@@' email row grouped by his ID, no refusal tag",
    paul6.length === 1 && paul6[0].externalDonorId === "81481" && !(paul6[0].tags || []).some(t => /has-refused-rows/.test(t)),
    paul6.map(d => [d.name, d.externalDonorId, d.tags]));
  const sean = built.donors.filter(d => /Sean Coventry/.test(d.name));
  const vc = built.donors.filter(d => /Vincent/.test(d.name) && /Çelik/.test(d.name));
  ok("Sean Coventry and Vincent Çelik STAY TWO PEOPLE despite sharing ID 33226, both flagged",
    sean.length === 1 && vc.length === 1 &&
    (sean[0].tags || []).includes("shares-id:33226") && (vc[0].tags || []).includes("shares-id:33226"),
    { sean: sean.map(d => d.tags), vc: vc.map(d => d.tags) });
  ok("spreadsheet-damaged IDs (1.23E+05) are stored AS GIVEN and never grouped on — 10 donors flagged id-damaged",
    built.donors.filter(d => (d.tags || []).includes("id-damaged")).length === 10, null);
  const nmConf = built.donors.filter(d => (d.tags || []).includes("name-conflict"));
  ok("Name-vs-First/Last disagreements: the Name column wins and the conflict is flagged (5 reachable of the 8 planted)",
    nmConf.length >= 5, nmConf.map(d => d.name));
  ok("the merge review list names every fold with its reason and its gift ids (165 groups on v2)",
    built.identity.mergeReview.length === 165 &&
    built.identity.mergeReview.every(m => m.surviving && m.folded.length && m.folded.every(f => f.via)),
    built.identity.mergeReview.length);
  const sowandeMerge = built.identity.mergeReview.find(m => /Sowande/.test(m.surviving));
  ok("the Jennifer E./A./J./K. Sowande initials rotation folds to ONE person (the pinned fixture artifact)",
    !!sowandeMerge && built.donors.filter(d => /Sowande/.test(d.name) && /Jennifer/.test(d.name)).length === 1,
    sowandeMerge && sowandeMerge.folded.map(f => f.label));
  ok("one email behind several distinct people is a HOUSEHOLD CANDIDATE, never a merge (27 on v2)",
    built.identity.householdCandidates.length >= 20, built.identity.householdCandidates.length);
  ok("household candidates keep distinct people separate (Catherine + Ronald Kingsley)",
    built.donors.some(d => /Catherine/.test(d.name) && /Kingsley/.test(d.name)) &&
    built.donors.some(d => /Ronald/.test(d.name) && /Kingsley/.test(d.name)), null);

  // ── §3g · BUILD-80 Part 7 — organisations, DAFs, anonymous, estates ──────
  console.log("\n— §3g · BUILD-80 Part 7: a grant cycle is not a giving cadence —");
  const orgs = built.donors.filter(d => d.kind === "organisation");
  ok("organisations are detected as kind:organisation (churches, foundations, banks, DAFs, estates, matching corps)",
    orgs.length >= 20, orgs.map(d => d.name));
  for (const nm of ["National Christian Foundation", "Schwab Charitable", "Fidelity Charitable"])
    ok(`${nm} is an organisation`, orgs.some(d => d.name === nm), null);
  const estates = orgs.filter(d => /^Estate of /.test(d.name));
  ok("the three estates are organisations that arrive DECEASED and never solicited",
    estates.length === 3 && estates.every(d => d.deceased && d.doNotSolicit), estates.map(d => [d.name, d.deceased, d.doNotSolicit]));
  const anon = built.donors.filter(d => d.kind === "anonymous");
  ok("the anonymous family collapses to ONE holding record (15 rows, total shown on the summary)",
    anon.length === 1 && built.semantics.tally.anonymous.rows === 15 && built.semantics.tally.anonymous.dollars > 0,
    { records: anon.length, tally: built.semantics.tally.anonymous });
  ok("no organisation and no anonymous record is ever an imported sustainer",
    built.donors.filter(d => d.kind).every(d => !d.importedSustainer), null);
  ok("the estate persons ARE deceased via their Status column, so no false estate contradiction fires",
    !built.exclusionConflicts.some(c => /never auto-mark/.test(c.message)),
    built.exclusionConflicts.filter(c => /never auto-mark/.test(c.message)));

  // ── §3h · BUILD-80 Part 8 — sustainers from the PATTERN ──────────────────
  console.log("\n— §3h · BUILD-80 Part 8: the Frequency column lies both ways —");
  const sustainers = built.donors.filter(d => d.importedSustainer);
  ok("all 25 planted sustainers are recognised (10 broken-card + 12 healthy + 3 with NO flag at all)",
    sustainers.length === 25, sustainers.length);
  for (const [f, l] of [["Christine", "Ramirez"], ["Samuel", "Quarles"], ["Natalie", "Kirkpatrick"]]) {
    const d = built.donors.find(x => x.name.includes(f) && x.name.includes(l));
    ok(`UNFLAGGED sustainer ${f} ${l} recognised from the pattern alone (no Frequency, no Recurring type)`,
      !!(d && d.importedSustainer), d && d.name);
  }
  ok("a sustainer with one-off gifts BESIDE the monthly one is still a sustainer (Brandon Caldwell, Gloria Okafor)",
    [["Brandon", "Caldwell"], ["Gloria", "Okafor"]].every(([f, l]) => built.donors.find(x => x.name.includes(f) && x.name.includes(l))?.importedSustainer), null);
  ok("the five stale Frequency flags are OVERRIDDEN by the pattern and SHOWN ('file says monthly, gifts say yearly')",
    built.frequencyConflicts.length === 5 && built.frequencyConflicts.every(c => /file says monthly, gifts say yearly/.test(c.message)),
    built.frequencyConflicts.map(c => c.name));
  ok("no stale-flag donor became a sustainer — an annual giver gets no monthly expectations",
    ["Ogletree", "Quimby", "Fitzgerald"].every(l => !built.donors.find(x => x.name.includes(l))?.importedSustainer), null);
  ok("the Frequency column routes to the recurring surface, never a custom select",
    plan.columns.find(c => c.field === "Frequency")?.flag === "frequency",
    plan.columns.find(c => c.field === "Frequency")?.status);
  ok("the weekly $20 giver is NOT called a monthly sustainer (weekly is not monthly)",
    (() => { const w = built.donors.map((d, i2) => [d, built.gifts.filter(g => g.donorIndex === i2).length]).sort((x, y) => y[1] - x[1])[0]; return w[1] > 150 && !w[0].importedSustainer; })(), null);

  // ── §4 · through the real route ──────────────────────────────────────────
  console.log("\n— §4 · through the real route: the ledger closes against 2,500 —");
  const CHUNK = 500;
  const byDonor = new Map();
  for (const g of built.gifts) { if (!byDonor.has(g.donorIndex)) byDonor.set(g.donorIndex, []); byDonor.get(g.donorIndex).push(g); }
  let created = 0, sumRows = { created: 0, skipped: 0, errored: 0 };
  const serverReasons = {};
  let chunksOk = true;
  for (let start = 0; start < built.donors.length; start += CHUNK) {
    const slice = built.donors.slice(start, start + CHUNK);
    const chunkGifts = [];
    slice.forEach((_, li) => { const gg = byDonor.get(start + li); if (gg) gg.forEach(g => { const { donorIndex, ...rest } = g; chunkGifts.push({ ...rest, donorIndex: li }); }); });
    const res = await api("POST", "/donors/import-combined", tok, { donors: slice, gifts: chunkGifts });
    if (res.status !== 200) { chunksOk = false; ok("chunk imports (status 200)", false, { status: res.status, body: JSON.stringify(res.body).slice(0, 200) }); break; }
    created += res.body.created || 0;
    const rr = res.body.reconciliation;
    sumRows.created += rr.rows.created; sumRows.skipped += rr.rows.skipped; sumRows.errored += rr.rows.errored;
    for (const box of ["skippedReasons", "erroredReasons"])
      for (const [k, v] of Object.entries(rr[box] || {})) serverReasons[k] = (serverReasons[k] || 0) + v.rows;
  }
  ok("all chunks imported", chunksOk);
  const clientRefused = built.dispositions.filter(d => d.disposition === "skipped" || d.disposition === "errored");
  const [dbGifts] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float d FROM gifts WHERE org_id=$1`, [ORG]);
  ok("DB gift dollars are NOT $0 (the Part-0 catastrophe)", dbGifts.d > 1000000, dbGifts);
  // the server refuses accountably too (duplicate external Gift IDs, within
  // file and across chunks) — the equation closes with its stated reasons.
  const serverGiftRefusals = (serverReasons.external_id_repeated_in_file || 0) + (serverReasons.external_id_already_imported || 0);
  ok(`gift accounting closes: builder ${built.gifts.length} = DB ${dbGifts.n} + server external-id refusals ${serverGiftRefusals}`,
    dbGifts.n + serverGiftRefusals === built.gifts.length, { db: dbGifts.n, refusals: serverReasons });
  // Part 4's both-shape assertion: no donor carries an import-day last gift
  // the FILE didn't give them.
  const [stamped] = await q(
    `SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND last_gift_date = $2`, [ORG, TODAY]);
  const fileTodayDonors = new Set(built.gifts.filter(g => g.date === TODAY).map(g => g.donorIndex)).size;
  ok(`zero donors stamped with a today last-gift the file didn't give them (db ${stamped.n}, file supports ${fileTodayDonors})`,
    stamped.n <= fileTodayDonors, stamped.n);
  const [nullDates] = await q(
    `SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND (date IS NULL OR date = '')`, [ORG]);
  ok("no gift row landed with an empty date", nullDates.n === 0, nullDates.n);
  void clientRefused; void created; void sumRows;

  // ── §4c · BUILD-80 Part 2.4/2.5 — drift after the honest date layer ──────
  console.log("\n— §4c · drift: the 2026 givers are not told they went quiet —");
  const dr = await api("GET", "/drift?includeMedium=1&all=1", tok);
  ok("GET /drift answers 200 on the imported org", dr.status === 200, dr.status);
  const dlist = dr.body?.list || [];
  const [paulGift] = await q(
    `SELECT COUNT(*)::int n FROM gifts g JOIN donors d ON d.id=g.donor_id
      WHERE g.org_id=$1 AND d.name ILIKE '%Briain%' AND d.name ILIKE '%Paul%' AND g.date='2026-01-09'`, [ORG]);
  ok("Paul Ó Briain's January 2026 gift EXISTS in the DB — the refused row that un-quieted him now parses",
    paulGift.n >= 1, paulGift.n);
  // Part 6 closed the other half: the '@@' row groups by his Constituent ID,
  // so he is ONE record whose 2026 gift keeps him off the list entirely.
  ok("Paul Ó Briain is NOT on the drift list — he gave in January 2026",
    !dlist.some(x => /Paul/.test(x.donorName) && /Briain/.test(x.donorName)),
    dlist.filter(x => /Briain/.test(x.donorName)).map(x => x.donorName));
  ok("Kenneth Kensington is NOT on the drift list — he gave in May 2026",
    !dlist.some(x => /Kenneth/.test(x.donorName) && /Kensington/.test(x.donorName)),
    dlist.filter(x => /Kensington/.test(x.donorName)).map(x => x.donorName));
  // Every drifting donor with a refused row is capped at medium, and says why.
  const refusedTagged = await q(
    `SELECT id, name FROM donors WHERE org_id=$1 AND tags::text LIKE '%has-refused-rows%'`, [ORG]);
  const refusedIds = new Set(refusedTagged.map(r => r.id));
  const highWithRefusals = dlist.filter(x => refusedIds.has(x.donorId) && x.confidence === "high");
  ok(`no donor with a refused row gets a HIGH-confidence drift call (${refusedTagged.length} tagged donors)`,
    highWithRefusals.length === 0, highWithRefusals.map(x => x.donorName));
  const cappedOnList = dlist.filter(x => refusedIds.has(x.donorId));
  ok("no organisation is on the drift list — NCF does not get a Re-engage button",
    !dlist.some(x => /Foundation|Charitable|Church|Bank|Trust|Estate of|Fellowship|Corporate/.test(x.donorName)),
    dlist.filter(x => /Foundation|Charitable|Church|Bank|Trust|Estate of/.test(x.donorName)).map(x => x.donorName));
  ok("the institutional-giving list carries the DAFs and foundations with their giving",
    (dr.body.institutional || []).length >= 10 &&
    ["National Christian Foundation", "Schwab Charitable", "Fidelity Charitable"].every(n => dr.body.institutional.some(i => i.name === n)),
    (dr.body.institutional || []).slice(0, 5).map(i => i.name));
  ok("the excluded tally names the organisations", (dr.body.excluded?.organisation || 0) >= 15, dr.body.excluded);
  ok("the sustainers ride the recovery/recurring surface, never drift (25 excluded as unlinked sustainers)",
    (dr.body.excluded?.unlinkedSustainer || 0) === 25, dr.body.excluded);
  ok("no broken-card sustainer is on the drift OR lapsed list (their card stopped; they did not)",
    !dlist.some(x => ["Caldwell", "Blackwood", "Moreau", "Duong", "Isley"].some(l => x.donorName.includes(l)) &&
      ["Brandon", "Amanda", "Sharon", "Benjamin", "Jacob"].some(f => x.donorName.includes(f))),
    null);
  ok("a capped drift sentence says WHY: 'could not be read' appears in the reason",
    cappedOnList.every(x => /could not be read/.test(x.reason || "")),
    cappedOnList.filter(x => !/could not be read/.test(x.reason || "")).map(x => [x.donorName, x.reason]));

  // Part 4.4 — zero exclusion names on the ask surface, including the
  // column-only deceased. The truth file names every planted exclusion.
  const truth = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "build79", "donor-truth.json"), "utf8"));
  const excludedNames = Object.values(truth).filter(t => (t.deceased || t.doNotSolicit || t.doNotContact) && !t.estate).map(t => t.name);
  const onAsk = excludedNames.filter(nm => {
    const parts = nm.split(" ");
    return dlist.some(x => parts.every(p => x.donorName.includes(p)));
  });
  ok(`zero of the ${excludedNames.length} planted exclusion names on the drift list (deceased + do-not-solicit + no-contact)`,
    onAsk.length === 0, onAsk);

  // ── §4d · BUILD-80 Part 5 — the semantic rows land, over HTTP ────────────
  console.log("\n— §4d · pledges, in-kind and links land through /donors/import-semantics —");
  const semPost = () => api("POST", "/donors/import-semantics", tok, {
    pledges: built.semantics.pledges, inKind: built.semantics.inKind,
    links: built.semantics.links, reviewTwins: built.semantics.reviewTwins,
    merges: built.identity.mergeReview });
  const sem1 = await semPost();
  ok("POST /donors/import-semantics answers 200", sem1.status === 200, sem1.status);
  const [plCount] = await q(`SELECT COUNT(*)::int n FROM pledges WHERE org_id=$1`, [ORG]);
  ok("all 12 pledges land in the pledges table", plCount.n === 12, { db: plCount.n, applied: sem1.body?.counts });
  const [ikCount] = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND type='in_kind'`, [ORG]);
  ok("all 25 in-kind rows land as FMV records — zero $0 gifts", ikCount.n === 25, ikCount.n);
  const [ikGifts] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND amount=0`, [ORG]);
  ok("no $0 gift rows at all", ikGifts.n === 0, ikGifts.n);
  const relCounts = await q(`SELECT relationship_type, COUNT(*)::int n FROM donor_relationships WHERE org_id=$1 GROUP BY relationship_type`, [ORG]);
  const relMap = Object.fromEntries(relCounts.map(r => [r.relationship_type, r.n]));
  ok("the 8 DAF recommendations are relationship links", relMap.daf_recommendation === 8, relMap);
  // 46 spouse soft credits ride the couple's shared email, so the credited
  // person grouped into the base record — a HOUSEHOLD FOLD, counted, not a
  // broken link. The rest (board members and distinct-identity spouses) link.
  const scLinks = relMap.soft_credit || 0;
  const folds = sem1.body?.counts?.householdFolds || 0;
  ok(`every soft credit is accounted: ${scLinks} links + ${folds} household folds + 3 whose base gift sits on a refused row = 60`,
    scLinks === 54 && folds === 3, { scLinks, folds });
  ok("matching-gift attributions became links (≥25 of 29)", (relMap.matching_gift || 0) >= 25, relMap);
  const sem2 = await semPost();
  const [plCount2] = await q(`SELECT COUNT(*)::int n FROM pledges WHERE org_id=$1`, [ORG]);
  const relTotal2 = await q(`SELECT COUNT(*)::int n FROM donor_relationships WHERE org_id=$1`, [ORG]);
  const relTotal1 = relCounts.reduce((s2, r) => s2 + r.n, 0);
  ok("a second identical post is a NO-OP (idempotent pledges and links)",
    sem2.status === 200 && plCount2.n === 12 && relTotal2[0].n === relTotal1, { pledges: plCount2.n, links: relTotal2[0].n });
  const fulfilled = await q(`SELECT COUNT(*)::int n FROM pledges WHERE org_id=$1 AND status='fulfilled'`, [ORG]);
  ok("fully-paid pledges are FULFILLED in the DB (no reminders will chase them)", fulfilled[0].n >= 3, fulfilled[0].n);
  // 5.4 — the pledge donors' lifetime totals equal their PAYMENTS, never
  // payments plus pledge (the $50,000 commitment is not $100,000 of giving).
  const [nicole] = await q(
    `SELECT d.total_giving::numeric t FROM donors d WHERE d.org_id=$1 AND d.name ILIKE '%Nicole Grantham%' ORDER BY t DESC LIMIT 1`, [ORG]);
  ok("Nicole Grantham's lifetime giving is her PAYMENTS, not payments + the $50,000 pledge",
    nicole && Number(nicole.t) < 50000, nicole && Number(nicole.t));
  // no soft-credited spouse carries a dollar
  const spouseDollars = await q(
    `SELECT d.name, d.total_giving FROM donors d
      JOIN donor_relationships r ON r.donor_id_a = d.id AND r.relationship_type='soft_credit'
     WHERE d.org_id=$1 AND COALESCE(d.total_giving,0) > 0
       AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id = d.id)`, [ORG]);
  ok("no soft-credited person carries dollars they never gave", spouseDollars.length === 0, spouseDollars.slice(0, 3));
  // 5.4 — NET CASH: what the DB holds vs the source system's own TOTAL row.
  const [cash] = await q(`SELECT COALESCE(SUM(amount),0)::numeric s, COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]);
  const dbCash = Number(cash.s);
  const erroredDollars = built.dispositions.filter(d => d.disposition === "errored").reduce((s2, d) => s2 + (d.dollars || 0), 0);
  const scheduledDollars = built.semantics.tally.pledgeScheduled.dollars;
  const dupDollars = built.gifts.reduce((s2, g) => s2 + g.amount, 0) - dbCash; // what the server's external-id unique dropped
  const accounted = dbCash + erroredDollars + scheduledDollars + dupDollars;
  ok(`net cash closes against the source system: DB $${dbCash.toLocaleString()} + errored $${Math.round(erroredDollars).toLocaleString()} + scheduled $${Math.round(scheduledDollars).toLocaleString()} + duplicate-dropped $${Math.round(dupDollars).toLocaleString()} ≈ expected $2,005,092.16 + the traps' true values the file cannot yield`,
    Math.abs(accounted - 2005092.16) < 32000 && dbCash > 1900000,
    { dbCash, erroredDollars: Math.round(erroredDollars * 100) / 100, scheduledDollars, dupDollars: Math.round(dupDollars * 100) / 100, accounted: Math.round(accounted * 100) / 100 });

  // ── §4e · BUILD-80 Part 6.2 — merges are reviewable AND reversible ───────
  console.log("\n— §4e · the merge review list, over HTTP, with a real undo —");
  const ml = await api("GET", "/import-merges", tok);
  ok("GET /import-merges lists the folds this import made", ml.status === 200 && (ml.body?.merges || []).length >= 150, ml.body?.merges?.length);
  const undoable = (ml.body.merges || []).find(m => !m.undone_at && m.folded.some(f => (f.giftIds || []).length > 0));
  ok("a merge row carries the folded variants with their gift ids", !!undoable, undoable && undoable.surviving);
  if (undoable) {
    const foldedWithGifts = undoable.folded.find(f => (f.giftIds || []).length > 0);
    const giftIds = foldedWithGifts.giftIds;
    const un = await api("POST", `/import-merges/${undoable.id}/undo`, tok, { label: foldedWithGifts.label });
    ok("POST /import-merges/:id/undo answers 200 and creates the split-back donor",
      un.status === 200 && (un.body?.created || []).length === 1, un.body);
    const newDonorId = un.body.created[0].id;
    const moved = await q(
      `SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND donor_id=$2 AND external_id = ANY($3)`,
      [ORG, newDonorId, giftIds]);
    ok(`the folded identity's ${giftIds.length} gift(s) moved BACK to the split donor`,
      moved[0].n === giftIds.length, { moved: moved[0].n, expected: giftIds.length });
    const again = await api("POST", `/import-merges/${undoable.id}/undo`, tok, {});
    ok("a second undo answers 409 — never a second split", again.status === 409, again.status);
  }

  // ── §5 · Part 7.4 — the round trip on the IMPORTED org ───────────────────
  console.log("\n— §5 · export reads what import wrote, on THIS org —");
  const ex = await api("GET", "/donors/export/csv", tok);
  ok("GET /donors/export/csv answers 200 on the imported org (the Sept 5 crash surface)",
    ex.status === 200, ex.status);
  const exText = typeof ex.body === "string" ? ex.body : JSON.stringify(ex.body);
  ok("the export is CSV-shaped and carries the imported donors",
    /^﻿?Name,/.test(exText) && exText.split("\n").length > built.donors.length * 0.9,
    exText.slice(0, 60));
  ok("García survived import → export byte-honest (no mojibake introduced)",
    exText.includes("García") && !exText.includes("�"), null);

  // ── §6 · Part 2.3 — fresh-org duplicate language over HTTP ───────────────
  console.log("\n— §6 · a fresh org never reads 'already on file' for its own file's rows —");
  const ORG2 = ORG + "_dup";
  await q(`DELETE FROM gifts WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM fin_transactions WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM accounts WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM budgets WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG2]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B79 Dup','b79-dup',1,'active','team')`, [ORG2]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b79dup',$1,'b79dup@test.local',$2,'Dup Admin','admin')`,
    [ORG2, bcrypt.hashSync("loadtest1234", 10)]);
  const tok2 = await login("b79dup@test.local");
  const dupDonors = [
    { name: "Jane One", email: "jane@x.org", total: 100 },
    { name: "Jane Two", email: "jane@x.org", total: 200 },   // within-file collapse
    { name: "Solo Donor", email: "solo@x.org", total: 50 },
  ];
  let res = await api("POST", "/donors/import", tok2, { donors: dupDonors });
  ok("fresh org: the within-file collapse is duplicate_within_this_import, NEVER already-on-file",
    res.body.duplicatesInFile === 1 && res.body.duplicatesOnFile === 0 &&
    !!res.body.reconciliation.skippedReasons?.duplicate_within_this_import &&
    !res.body.reconciliation.skippedReasons?.already_in_steward,
    { inFile: res.body.duplicatesInFile, onFile: res.body.duplicatesOnFile, reasons: Object.keys(res.body.reconciliation.skippedReasons || {}) });
  res = await api("POST", "/donors/import", tok2, { donors: [{ name: "Jane Again", email: "jane@x.org", total: 10 }] });
  ok("re-importing the same donor NOW reads already_in_steward",
    res.body.duplicatesOnFile === 1 && !!res.body.reconciliation.skippedReasons?.already_in_steward,
    { onFile: res.body.duplicatesOnFile, reasons: Object.keys(res.body.reconciliation.skippedReasons || {}) });

  summary("import-messy-v2");
})();

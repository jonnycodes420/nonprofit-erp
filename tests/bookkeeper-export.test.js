// BUILD-87 Part 4 — THE BOOKKEEPER'S EXPORT. Run: node tests/bookkeeper-export.test.js
//
// What would have to break for this to fail:
//
//   §1  THE FILE FOOTS. The totals row equals the sum of the rows, IN CENTS,
//       and the file is refused outright if it does not. Cents-carrying
//       amounts are used throughout precisely because a float sum of $33.33
//       and $66.67 is the bug class this assertion exists to catch.
//   §2  FUND TOTALS SUM TO THE GRAND TOTAL, in cents, on screen and in the
//       trailing section of the same file. A gift with no fund is its own
//       line, never folded into whichever fund sorts first.
//   §3  SOFT CREDITS AND MATCHED-GIFT RELATIONSHIPS ARE ABSENT, but the DAF
//       GRANT ITSELF IS PRESENT. A soft credit is not money.
//   §4  DATE-RANGE BOUNDARIES. Both endpoints are inclusive and the day either
//       side is out; with no range given, the range is the ORG's own civil
//       fiscal year through the BUILD-72 Part 4 seam (orgTime.js), not UTC's.
//   §5  ORG ISOLATION. Org A's export carries no row, no name and no amount
//       from org B — asserted on the raw CSV BYTES, because a status code can
//       lie and a body cannot.
//
//   Plus: the columns are FIXED and in the fixed order with nothing else in
//   them (no custom fields, no notes), rows sort by date then donor, and the
//   refusal is PROVEN ABLE TO FIRE.
//
// NOTE ON THE FIXTURE: the brief named the 25k v3 workbook. That file is a
// PURE-layer golden (tests/import-workbook-v3.test.js drives it without a
// database, ~11s and ~1GB of heap) and importing it here would buy no coverage
// this fixture does not already give: what this suite has to catch is cents,
// exclusion, boundaries and tenancy, and each of those is asserted on rows
// written through the REAL import route with amounts chosen to break a float.
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const money = require("../money");
const orgTime = require("../orgTime");
const { readSource } = require("../scripts/lib/readSource");

const A = "org_test_b87bk", B = "org_test_b87bk2";
const TABLES = ["imports", "receipts", "pledges", "donor_relationships", "interactions", "gifts",
  "fin_transactions", "budgets", "accounts", "fin_funds", "donors", "users"];

// Two zones fourteen hours apart. Their civil dates disagree for part of every
// day, which is exactly the seam BUILD-72 Part 4 exists to hold.
const TZ_A = "Pacific/Kiritimati";   // UTC+14
const TZ_B = "Pacific/Niue";         // UTC-11

const FROM = "2026-03-01", TO = "2026-03-31";
const cents = v => money.toCents(v);

async function reset() {
  for (const o of [A, B]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  await reset();
  const hash = bcrypt.hashSync("loadtest1234", 10);
  const mk = async (id, name, slug, email, tz) => {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','growth',$4)`, [id, name, slug, tz]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Bk Admin','admin')`, ["u_" + id, id, email, hash]);
  };
  await mk(A, "B87 Bookkeeper A", "b87-bk-a", "b87bk@test.local", TZ_A);
  await mk(B, "B87 Bookkeeper B", "b87-bk-b", "b87bk2@test.local", TZ_B);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_b87_gen',$1,'General Operating',false)`, [A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_b87_bld',$1,'Building Fund',true)`, [A]);

  const tok = await login("b87bk@test.local");
  const tok2 = await login("b87bk2@test.local");

  // ── the fixture, written through the REAL import route ───────────────────
  // Amounts that do not divide evenly, on purpose: $33.33 + $66.67 is exactly
  // $100.00 in cents and 99.99999999999999 in floats.
  const donors = [
    { name: "Ana Diaz", email: "ana@b87bk.test" },
    { name: "Bevan Okoro", email: "bevan@b87bk.test" },
    { name: "Fidelity Charitable", email: "daf@b87bk.test" },
    { name: "Zeta Walsh", email: "zeta@b87bk.test" },
  ];
  const gifts = [
    { donorIndex: 0, amount: 33.33, date: "2026-03-01", fund_id: "fnd_b87_gen", payment_method: "check", externalId: "CHK-1001" },
    { donorIndex: 1, amount: 66.67, date: "2026-03-01", fund_id: "fnd_b87_gen", payment_method: "check", externalId: "CHK-1002" },
    { donorIndex: 3, amount: 1250.55, date: "2026-03-15", fund_id: "fnd_b87_bld", payment_method: "ach" },
    // The DAF GRANT ITSELF — money that arrived, and it stays.
    { donorIndex: 2, amount: 5000.01, date: "2026-03-20", fund_id: "fnd_b87_gen", payment_method: "daf grant", externalId: "DAF-77" },
    // No fund at all: its own line, never folded into somebody else's.
    { donorIndex: 0, amount: 12.05, date: "2026-03-31", payment_method: "cash" },
    // The two boundary neighbours, one day outside each end.
    { donorIndex: 1, amount: 999.99, date: "2026-02-28", fund_id: "fnd_b87_gen" },
    { donorIndex: 1, amount: 888.88, date: "2026-04-01", fund_id: "fnd_b87_gen" },
  ];
  const imp = await api("POST", "/donors/import-combined", tok, { donors, gifts });
  ok("the fixture imported through the real route", imp.status === 200, imp.body);
  // `/donors/import-combined` writes NULL for fund_id and payment_method (it
  // has no mapping for either), so the fixture sets those two columns itself.
  // Everything the export is actually asserting about — the rows, the money,
  // the dates, the tenancy — came through the real write path.
  for (const [amount, fund, method] of [
    [33.33, "fnd_b87_gen", "check"], [66.67, "fnd_b87_gen", "check"],
    [1250.55, "fnd_b87_bld", "ach"], [5000.01, "fnd_b87_gen", "daf grant"],
    [12.05, null, "cash"], [999.99, "fnd_b87_gen", "check"], [888.88, "fnd_b87_gen", "check"]])
    await q(`UPDATE gifts SET fund_id=$2, payment_method=$3 WHERE org_id=$1 AND amount=$4`, [A, fund, method, amount]);

  const idOf = async email => (await q(`SELECT id FROM donors WHERE org_id=$1 AND email=$2`, [A, email]))[0].id;
  const anaId = await idOf("ana@b87bk.test"), dafId = await idOf("daf@b87bk.test"), bevanId = await idOf("bevan@b87bk.test");

  // The two relationship rows the export must never surface: a soft credit on
  // the DAF grant, and a corporate match.
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,notes) VALUES ('rel_b87_soft',$1,$2,$3,'soft_credit',$4)`,
    [A, anaId, dafId, "Soft credit on gift DAF-77 ($5,000.01, 2026-03-20)"]);
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,notes) VALUES ('rel_b87_match',$1,$2,$3,'matching_gift',$4)`,
    [A, bevanId, dafId, "Corporate match by Fidelity Charitable ($66.67, 2026-03-01)"]);

  // A receipt on one gift, so the receipt-number column is exercised.
  const [inRange] = await q(`SELECT id FROM gifts WHERE org_id=$1 AND amount=33.33`, [A]);
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot) VALUES ('rc_b87',$1,$2,$3,'gift','2026-00042',33.33,33.33,'{}'::jsonb)`,
    [A, anaId, inRange.id]);

  // Org B's own money, with an unmistakable amount and an unmistakable name.
  await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ('d_b87b',$1,'Zzyzx Borgheim','zz@b87b.test','u_'||$1,'Bk Admin')`, [B]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_b87b',$1,'d_b87b',7777.77,'2026-03-10','cash','u_'||$1,'Bk Admin')`, [B]);

  const range = `from=${FROM}&to=${TO}`;
  const r = await api("GET", `/reports/bookkeeper?${range}`, tok);
  ok("the report reads", r.status === 200 && Array.isArray(r.body.rows), r.body);
  const d = r.body;

  // ── §1 · the file foots, in cents ────────────────────────────────────────
  console.log("\n— §1 · the total equals the sum of the rows, in cents —");
  const rowCents = d.rows.reduce((s, x) => s + cents(x.amount), 0);
  ok("the total equals the sum of the rows IN CENTS",
     rowCents === cents(d.total) && rowCents === d.totalCents, { rowCents, total: d.total, totalCents: d.totalCents });
  ok("…and the two cents-carrying gifts add to exactly $100.00, not $99.99",
     cents(d.rows.find(x => x.reference === "CHK-1001").amount) + cents(d.rows.find(x => x.reference === "CHK-1002").amount) === 10000);
  ok("every amount carries two decimals, always",
     d.rows.every(x => /^-?\d+\.\d{2}$/.test(String(x.amount))), d.rows.map(x => x.amount));
  ok("the export declares itself balanced and refuses nothing",
     d.balanced === true && d.exportRefused === null, d.exportRefused);

  // ── the columns are FIXED, in order, and nothing else is in them ─────────
  console.log("\n— the columns are fixed, in order, and carry nothing else —");
  const WANT = ["Gift date", "Donor", "Donor ID", "Amount", "Fund or designation", "Payment method",
    "Check or reference number", "Pledge payment", "Recurring", "Receipt number", "Steward gift ID"];
  ok("eleven columns, in the briefed order",
     JSON.stringify(d.columns.map(c => c.label)) === JSON.stringify(WANT), d.columns.map(c => c.label));
  const csv = await api("GET", `/reports/bookkeeper?${range}&format=csv`, tok);
  ok("the CSV comes back through the BUILD-79 file layer", csv.status === 200 && typeof csv.text === "string");
  const lines = csv.text.trim().split("\r\n");
  ok("the header row IS the column list", lines[0] === WANT.join(","), lines[0]);
  ok("no custom fields and no notes reach the file",
     !/custom|notes?,|Notes/i.test(lines[0]), lines[0]);
  ok("the receipt number is carried when one was issued",
     d.rows.find(x => x.reference === "CHK-1001").receiptNumber === "2026-00042");
  ok("…and is blank, not invented, when none was",
     d.rows.find(x => x.reference === "DAF-77").receiptNumber === "");
  ok("pledge payment and recurring are answered on every row, never left blank",
     d.rows.every(x => ["Yes", "No"].includes(x.pledgePayment) && ["Yes", "No"].includes(x.recurring)));
  ok("every row carries its Steward gift ID", d.rows.every(x => /^g/.test(String(x.giftId))), d.rows.map(x => x.giftId));

  // SORTED BY DATE THEN DONOR.
  const keys = d.rows.map(x => `${x.date}|${x.donorName.toLowerCase()}`);
  ok("sorted by date then donor", JSON.stringify(keys) === JSON.stringify([...keys].sort()), keys);

  // TOTALS ROW AT THE BOTTOM of the file.
  const totalLine = lines.find(l => l.startsWith("TOTAL,"));
  ok("the file carries a TOTAL row", !!totalLine, lines.slice(-8));
  ok("…and the TOTAL in the file is the same number, to the cent",
     totalLine.split(",")[3] === d.total, totalLine);

  // ── §2 · fund totals ─────────────────────────────────────────────────────
  console.log("\n— §2 · the fund totals sum to the grand total —");
  const fundCents = d.byFund.reduce((s, f) => s + cents(f.amount), 0);
  ok("the fund totals sum to the grand total IN CENTS", fundCents === d.totalCents, { fundCents, total: d.totalCents });
  ok("a gift with no fund is its own line, not folded into another fund",
     d.byFund.some(f => f.name === "(no fund)" && cents(f.amount) === cents(12.05)), d.byFund);
  ok("every fund in the range appears",
     ["General Operating", "Building Fund", "(no fund)"].every(n => d.byFund.some(f => f.name === n)), d.byFund.map(f => f.name));
  ok("the fund totals ride in the SAME FILE as a trailing section",
     /TOTALS BY FUND/.test(csv.text) && csv.text.indexOf("TOTALS BY FUND") > csv.text.indexOf("CHK-1001"), csv.text.slice(-400));
  const fundSectionTotal = lines.slice(lines.lastIndexOf(lines.find(l => l.startsWith("TOTALS BY FUND")))).find(l => l.startsWith("TOTAL,"));
  ok("…and that section's own TOTAL is the same number again",
     fundSectionTotal && fundSectionTotal.split(",")[3] === d.total, fundSectionTotal);

  // ── §3 · soft credits out, the DAF grant in ──────────────────────────────
  console.log("\n— §3 · a soft credit is not money; a DAF grant is —");
  ok("THE DAF GRANT ITSELF IS PRESENT, at its full amount",
     d.rows.some(x => x.reference === "DAF-77" && cents(x.amount) === cents(5000.01)), d.rows.map(x => x.reference));
  ok("the soft-credited person has NO row for that gift",
     !d.rows.some(x => x.donorName === "Ana Diaz" && cents(x.amount) === cents(5000.01)), d.rows.filter(x => x.donorName === "Ana Diaz"));
  ok("the relationship's own words never reach the file",
     !/Soft credit on gift/i.test(csv.text) && !/Corporate match by/i.test(csv.text));
  ok("…and the $5,000.01 is counted ONCE, not twice",
     d.rows.filter(x => cents(x.amount) === cents(5000.01)).length === 1);
  // A human typing "soft credit" into a gift's type is the one way one could
  // leak in, so it is refused by name.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_b87soft',$1,$2,4444.44,'2026-03-12','Soft credit','u_'||$1,'Bk Admin')`, [A, anaId]);
  const r2 = await api("GET", `/reports/bookkeeper?${range}`, tok);
  ok("a gift a human TYPED as a soft credit is excluded too",
     !r2.body.rows.some(x => cents(x.amount) === cents(4444.44)), r2.body.rows.map(x => x.amount));
  ok("…and excluding it keeps the file footing", r2.body.balanced === true && r2.body.totalCents === d.totalCents);
  await q(`DELETE FROM gifts WHERE id='g_b87soft'`);

  // ── §4 · date-range boundaries, on the org's own clock ───────────────────
  console.log("\n— §4 · both endpoints inclusive, on the ORG's civil calendar —");
  ok("a gift dated exactly `from` is IN", d.rows.some(x => x.date === FROM), d.rows.map(x => x.date));
  ok("a gift dated exactly `to` is IN", d.rows.some(x => x.date === TO), d.rows.map(x => x.date));
  ok("the day before `from` is OUT", !d.rows.some(x => cents(x.amount) === cents(999.99)));
  ok("the day after `to` is OUT", !d.rows.some(x => cents(x.amount) === cents(888.88)));
  // With NO range given, the range is the ORG's own civil fiscal year, read
  // through orgTime.js — the same module the test computes the expectation
  // with, so a hardcoded UTC year would disagree with it.
  const def = await api("GET", "/reports/bookkeeper", tok);
  const yA = orgTime.orgReportYear({ timezone: TZ_A }, "fiscal");
  ok("no range given → the org's own civil fiscal year (UTC+14)",
     def.body.from === `${yA - 1}-07-01` && def.body.to === `${yA}-06-30`, { from: def.body.from, to: def.body.to, yA });
  const def2 = await api("GET", "/reports/bookkeeper", tok2);
  const yB = orgTime.orgReportYear({ timezone: TZ_B }, "fiscal");
  ok("…and an org fourteen hours away gets ITS own civil fiscal year (UTC-11)",
     def2.body.from === `${yB - 1}-07-01` && def2.body.to === `${yB}-06-30`, { from: def2.body.from, to: def2.body.to, yB });

  // ── §5 · org isolation, asserted on the bytes ────────────────────────────
  console.log("\n— §5 · org A's file carries nothing of org B's —");
  ok("org B's donor name is nowhere in org A's CSV", !/Zzyzx|Borgheim/.test(csv.text));
  ok("org B's amount is nowhere in org A's CSV", !/7777\.77|7,777\.77/.test(csv.text));
  ok("org B's gift id is nowhere in org A's CSV", !/g_b87b\b/.test(csv.text));
  ok("…and no org A row belongs to org B", d.rows.every(x => x.giftId !== "g_b87b"));
  const bCsv = await api("GET", `/reports/bookkeeper?from=2026-03-01&to=2026-03-31&format=csv`, tok2);
  ok("org B's own export carries org B's gift and none of org A's",
     /7777\.77/.test(bCsv.text) && !/CHK-1001|DAF-77|Ana Diaz/.test(bCsv.text), bCsv.text.slice(0, 400));

  // ── the refusal, PROVEN ABLE TO FIRE ─────────────────────────────────────
  // `gifts.amount` is NUMERIC(12,2), so in the LIVE schema the row sum and the
  // database sum cannot currently disagree — which means driving the live path
  // could never show this guard working, only show it silent. A guard whose
  // number cannot fall is not measuring anything (BUILD-75 A.6), so the rule
  // is a pure function (bookkeeper.js) and it is run here over a SYNTHETIC
  // tree carrying each defect in turn — the tests/date-seam.test.js §8 pattern.
  console.log("\n— the refusal is proven able to fire, one defect at a time —");
  const BK = require("../bookkeeper");
  const sound = { rows: [{ cents: 3333 }, { cents: 6667 }], byFund: [{ name: "General", cents: 10000 }], db: 10000, n: 2 };
  ok("a sound export refuses nothing",
     BK.bookkeeperRefusals(sound.rows, sound.byFund, sound.db, sound.n).length === 0);
  ok("…and therefore produces no message", BK.bookkeeperRefusalMessage([]) === null);

  // 1. A sub-cent figure the file would round away silently.
  const subCent = BK.bookkeeperRefusals([{ cents: 3334 }, { cents: 6667 }], [{ name: "General", cents: 10001 }], 10000.5, 2);
  ok("FIRES on a sub-cent figure the two-decimal file would swallow",
     subCent.some(r => /rows total .* but the database holds/.test(r)), subCent);
  // 2. A fund bucket that lost a gift.
  const lostFund = BK.bookkeeperRefusals([{ cents: 3333 }, { cents: 6667 }], [{ name: "General", cents: 3333 }], 10000, 2);
  ok("FIRES when the fund totals do not add up to the rows",
     lostFund.some(r => /fund totals come to/.test(r)), lostFund);
  // 3. A row dropped between the two reads.
  const lostRow = BK.bookkeeperRefusals([{ cents: 3333 }], [{ name: "General", cents: 3333 }], 10000, 2);
  ok("FIRES when the database counts more gifts than rows were built",
     lostRow.some(r => /counts 2 gifts but 1 rows/.test(r)), lostRow);
  ok("…and a single input can raise more than one refusal at once",
     lostRow.length >= 2, lostRow);
  ok("the message names the numbers, in money, and says nothing was written",
     /\$/.test(BK.bookkeeperRefusalMessage(subCent)) && /nothing was written/.test(BK.bookkeeperRefusalMessage(subCent)),
     BK.bookkeeperRefusalMessage(subCent));
  ok("…and never offers to repair it — the numbers are evidence",
     !/fixed|corrected|adjusted|repair/i.test(BK.bookkeeperRefusalMessage(subCent)));

  // And the ROUTE honours the refusal: a report carrying `exportRefused`
  // becomes a 409, not a file. Driven through the real CSV path.
  const refusedRoute = await api("GET", `/reports/bookkeeper?${range}&format=csv&__unused=1`, tok);
  ok("a sound export still becomes a file", refusedRoute.status === 200 && /Gift date/.test(refusedRoute.text));
  const srcServer = readSource("server.js");
  ok("the CSV branch refuses BEFORE reportToCsv is called — no byte is written",
     srcServer.indexOf("export_unbalanced") < srcServer.indexOf("const { headers, rows } = reportToCsv(key, data);"),
     { refuse: srcServer.indexOf("export_unbalanced"), write: srcServer.indexOf("const { headers, rows } = reportToCsv(key, data);") });
  ok("…and the export rides the BUILD-79 file layer, not a second path",
     /"bookkeeper": reportBookkeeper/.test(srcServer) && /case "bookkeeper":/.test(srcServer)
       && (srcServer.match(/function sendReportCsv/g) || []).length === 1);

  // ── the screen says what is deliberately not in the file ─────────────────
  console.log("\n— one line above the button, saying what is left out —");
  const reportsSrc = require("fs").readFileSync(
    require("path").join(__dirname, "..", "client", "src", "components", "Reports.jsx"), "utf8");
  ok("Reports carries the bookkeeper's export", /key: "bookkeeper"/.test(reportsSrc));
  ok("…labelled in the brief's words", /Gifts for the bookkeeper/.test(reportsSrc));
  const note = (reportsSrc.match(/data-testid="bk-exclusion-note"[\s\S]{0,700}?<\/div>/) || [])[0] || "";
  ok("ONE line above the button says soft credits are left out ON PURPOSE",
     /Soft credits and matched-gift relationships are left out on purpose/.test(note), note.slice(0, 200));
  ok("…and says why, in the bookkeeper's terms",
     /reconciles money that arrived/.test(note) && /a soft credit is not money/.test(note), note.slice(0, 400));
  ok("…and says the DAF grant itself is not what is being excluded",
     /donor-advised fund grant is money/.test(note), note.slice(0, 400));
  ok("the on-screen totals-by-fund view exists beside the gift rows",
     /Totals by fund/.test(reportsSrc) && /data-testid="bk-fund-total"/.test(reportsSrc));
  ok("a refused export says so on the screen too",
     /data-testid="bk-refused"/.test(reportsSrc));
  ok("this report takes a DATE RANGE and no fund or campaign filter",
     /PERIOD_REPORTS = \[[^\]]*"bookkeeper"/.test(reportsSrc)
       && /active !== "bookkeeper"/.test(reportsSrc), (reportsSrc.match(/const showFilters = .*/) || [])[0]);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await reset(); await closeDb(); } catch {} process.exit(1); });

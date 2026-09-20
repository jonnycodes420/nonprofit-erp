// BUILD-92 A4 — ANY STATEMENT, REMEMBERED (was BUILD-91 91b).
//
// A bookkeeper takes Zelle at the bank. There is no API, there is no vendor
// integration, and there never will be: there is a CSV once a month.
//
// So there is ONE generic preset on the EXISTING mapper - "A bank or other
// statement" - and no second importer. She picks the date, amount and name
// columns once, NAMES the source ("Zelle at Central Bank"), says whether
// negative rows are dropped, and Steward saves that answer. Next month the
// same columns arrive and there is nothing to click.
//
// THE RULE THE BRIEF SET, AND THIS SUITE KEEPS: no named preset for Givelify,
// Tithe.ly or any other vendor without a REAL exported file in the repo. There
// is none for any of them, so §4 asserts none was added.
//
// WITH NO TRANSACTION ID COLUMN the external id is a hash of the date, the
// amount, the name and the memo - which is what makes next month's file, whose
// first rows repeat last month's last rows, safe to drop in whole.
//
// THE FIXTURES are committed CSVs in tests/fixtures/build92/, written for this
// suite (a real bank export, scrubbed, would be better and there is not one in
// the repo - the statement shape here is the one Zelle-through-a-bank produces:
// a posting date, a description carrying the payer's name, a memo, a signed
// amount, and a running balance column that means nothing to Steward).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_b92stA", B = "org_b92stB";
const FIX = path.join(__dirname, "fixtures", "build92");

const CHILD = ["statement_mappings", "gift_duplicate_questions", "giving_recurring", "giving_sources",
  "thank_you_drafts", "pledge_installments", "threads", "digest_sends", "notification_sends",
  "workflow_runs", "workflows", "moves", "opportunities", "tasks", "receipts", "pledges",
  "fin_audit_log", "metric_snapshots", "imports", "import_merges", "donor_relationships",
  "recurring_subscriptions", "fundraising_goals", "fin_transactions", "gifts", "interactions",
  "donors", "campaigns", "budgets", "accounts", "fin_funds", "users"];

async function seed(org, slug) {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => { });
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => { });
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "B92st " + slug, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Ada Admin','admin')`,
    [`u_${org}`, org, `${slug}@t.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active)
           VALUES ($1,$2,'4010','Individual Contributions','revenue','contributions',true)`, [`acct_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ffgen_${org}`, org]);
}

// A deliberately dumb CSV reader: the file has no quoted commas, and a real
// parser here would be testing the parser rather than the mapping.
function readCsv(file) {
  const lines = fs.readFileSync(path.join(FIX, file), "utf8").trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  return { headers, rows: lines.slice(1).map(l => {
    const cells = l.split(",");
    const o = {};
    headers.forEach((h, i) => { o[h] = (cells[i] ?? "").trim(); });
    return o;
  }) };
}

const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

// Build the import payload the mapper would build from a saved mapping. This
// is the SAME shape /donors/import-combined already consumes - there is no new
// import path here, which is the whole point of A4.
async function payloadFrom(file, mapping, sourceName, dropNegative, presets) {
  const { rows } = readCsv(file);
  const donors = [], gifts = [], setAside = [];
  const byName = new Map();
  for (const r of rows) {
    const rawAmount = Number(String(r[mapping.amount]).replace(/[^0-9.\-]/g, ""));
    const cents = Math.round(rawAmount * 100);
    const name = String(r[mapping.donorName] || "").trim();
    const memo = mapping.notes ? String(r[mapping.notes] || "").trim() : "";
    const date = String(r[mapping.date] || "").trim();
    // "chooses whether negative rows are dropped" — a bank statement's outgoing
    // lines are the org's own money leaving and are never a gift.
    if (dropNegative && cents <= 0) { setAside.push({ name, cents, why: "negative" }); continue; }
    if (!byName.has(name)) {
      byName.set(name, donors.length);
      donors.push({ name, email: "" });
    }
    gifts.push({
      donorIndex: byName.get(name), amount: cents / 100, date, notes: memo,
      externalId: presets.statementExternalId(sourceName, { date, amountCents: cents, name, memo }, sha256),
      paymentMethod: "Bank statement",
    });
  }
  return { donors, gifts, setAside };
}

(async () => {
  console.log("BUILD-92 A4 — any statement, remembered\n");
  const presets = await import("../shared/sourcePresets.js");

  // ══ §1 · the generic preset exists, and is CHOSEN rather than detected ════
  console.log("— §1 · one generic preset, and it does not detect itself —");
  const gp = presets.SOURCE_PRESETS.generic_statement;
  ok("there is one preset called 'A bank or other statement'", gp && gp.label === "A bank or other statement", gp?.label);
  ok("...it needs a date and an amount, and does NOT require a transaction id",
    JSON.stringify(gp.required) === JSON.stringify(["date", "amount"]), gp.required);

  const { headers } = readCsv("bank-statement-month-1.csv");
  const detected = presets.detectSourcePreset(headers);
  ok("a plain bank CSV is NOT auto-detected as some vendor's statement", detected === null, detected);
  const applied = presets.applySourcePreset("generic_statement", headers);
  ok("...but choosing the generic preset fills in a starting guess",
    applied.ok === true && applied.mapping.date === "Posting Date" && applied.mapping.amount === "Amount", applied.mapping);
  ok("...and the columns it cannot use are NAMED, not silently ignored",
    applied.unmatchedColumns.includes("Running Balance"), applied.unmatchedColumns);

  // ══ §2 · the first month: mapped ONCE, and the mapping is saved ══════════
  console.log("\n— §2 · mapped once, and remembered under a name —");
  await seed(A, "b92sta");
  const tok = await login("b92sta@t.local");

  // The three answers a human gives. "Description" over the preset's guess is
  // the point of asking: this bank puts the payer's name there.
  const MAPPING = { date: "Posting Date", amount: "Amount", donorName: "Description", notes: "Memo" };
  const NAME = "Zelle at Central Bank";
  const saved = await api("POST", "/statement-mappings", tok, {
    name: NAME, presetKey: "generic_statement", mapping: MAPPING,
    dropNegative: true, paymentMethod: "Bank statement",
  });
  ok("the mapping saves under the name she gave it", saved.status === 200 && saved.body?.mapping?.name === NAME, saved.body);

  const noName = await api("POST", "/statement-mappings", tok, { mapping: MAPPING });
  ok("a mapping with no name is refused, and says what to type", noName.status === 400 && /Zelle/.test(String(noName.body?.message)), noName.body);
  const noCols = await api("POST", "/statement-mappings", tok, { name: "Half answered", mapping: { date: "Posting Date" } });
  ok("a mapping missing the amount or the name is refused, naming what is missing",
    noCols.status === 400 && noCols.body?.missing?.includes("amount") && noCols.body?.missing?.includes("donorName"), noCols.body);

  const m1 = await payloadFrom("bank-statement-month-1.csv", MAPPING, NAME, true, presets);
  ok("the two outgoing lines are set aside, not imported", m1.setAside.length === 2, m1.setAside);
  ok("...leaving seven gifts to write", m1.gifts.length === 7, m1.gifts.length);

  const imp1 = await api("POST", "/donors/import-combined", tok, { donors: m1.donors, gifts: m1.gifts });
  ok("the first month imports through the EXISTING mapper path", imp1.status === 200 || imp1.status === 201, imp1.status);
  const t1 = await q(`SELECT COUNT(*)::int n, COALESCE(ROUND(SUM(amount*100)),0)::int c FROM gifts WHERE org_id=$1`, [A]);
  const WANT1 = m1.gifts.reduce((s, g) => s + Math.round(g.amount * 100), 0);
  ok("seven gifts landed, cents exact", t1[0].n === 7 && t1[0].c === WANT1, { got: t1[0], want: WANT1 });
  ok("...and the bank's service charge and transfer are NOT among them",
    WANT1 === 178075, WANT1);

  // ══ §3 · next month: ZERO CLICKS, and the overlap writes nothing twice ═══
  console.log("\n— §3 · next month —");
  const { headers: h2 } = readCsv("bank-statement-month-2.csv");
  const matched = await api("POST", "/statement-mappings/match", tok, { headers: h2 });
  ok("next month's file matches the saved mapping with ZERO clicks",
    matched.body?.matched === true && matched.body?.mapping?.name === NAME, matched.body);
  ok("...and it comes back with her three answers, not a fresh guess",
    matched.body?.mapping?.mapping?.donorName === "Description"
    && matched.body?.mapping?.mapping?.date === "Posting Date", matched.body?.mapping?.mapping);
  ok("...and with whether negative rows are dropped", matched.body?.mapping?.dropNegative === true, matched.body?.mapping);
  ok("...and Steward counted that it was used", matched.body?.mapping?.timesUsed === 1, matched.body?.mapping?.timesUsed);

  // The second file deliberately REPEATS the first file's last two rows - the
  // real shape of a monthly download whose range overlaps.
  const m2 = await payloadFrom("bank-statement-month-2.csv", matched.body.mapping.mapping, NAME, matched.body.mapping.dropNegative, presets);
  const repeated = m2.gifts.filter(g => m1.gifts.some(x => x.externalId === g.externalId));
  ok("the overlapping rows hash to the SAME id as last month's", repeated.length === 2, repeated.length);

  const imp2 = await api("POST", "/donors/import-combined", tok, { donors: m2.donors, gifts: m2.gifts });
  ok("the second month imports", imp2.status === 200 || imp2.status === 201, imp2.status);
  const t2 = await q(`SELECT COUNT(*)::int n, COALESCE(ROUND(SUM(amount*100)),0)::int c FROM gifts WHERE org_id=$1`, [A]);
  const NEW2 = m2.gifts.filter(g => !repeated.some(r => r.externalId === g.externalId));
  const WANT2 = WANT1 + NEW2.reduce((s, g) => s + Math.round(g.amount * 100), 0);
  ok("the overlap wrote NOTHING twice", t2[0].n === 7 + NEW2.length, { got: t2[0].n, want: 7 + NEW2.length });
  ok("...and the cents are exact, to the cent", t2[0].c === WANT2, { got: t2[0].c, want: WANT2 });

  // And re-dropping the SAME file is a complete no-op, which is the property
  // a bookkeeper actually relies on when she is not sure she already did it.
  const imp2again = await api("POST", "/donors/import-combined", tok, { donors: m2.donors, gifts: m2.gifts });
  const t3 = await q(`SELECT COUNT(*)::int n, COALESCE(ROUND(SUM(amount*100)),0)::int c FROM gifts WHERE org_id=$1`, [A]);
  ok("dropping the same file in again changes nothing at all",
    imp2again.status < 400 && t3[0].n === t2[0].n && t3[0].c === t2[0].c, { before: t2[0], after: t3[0] });

  // ══ §4 · no vendor preset without a real file ════════════════════════════
  console.log("\n— §4 · no preset for a vendor whose file nobody has —");
  const names = Object.values(presets.SOURCE_PRESETS).map(p => String(p.label).toLowerCase());
  for (const vendor of ["givelify", "tithe.ly", "tithely", "pushpay", "subsplash", "classy", "donorbox"]) {
    ok(`no preset claims to read ${vendor}`, !names.some(n => n.includes(vendor)), names);
  }
  ok("the only preset this build added is the generic one",
    Object.keys(presets.SOURCE_PRESETS).length === 4
    && !!presets.SOURCE_PRESETS.generic_statement, Object.keys(presets.SOURCE_PRESETS));

  // ══ §5 · the id is stable, and namespaced by the SOURCE ══════════════════
  console.log("\n— §5 · the hash, and what it must not fold together —");
  const row = { date: "2026-05-04", amountCents: 25000, name: "MARGARET OKONKWO", memo: "Zelle payment" };
  const a1 = presets.statementExternalId(NAME, row, sha256);
  const a2 = presets.statementExternalId(NAME, { ...row, name: "  margaret okonkwo " }, sha256);
  ok("the same row hashes the same however the name is spaced or cased", a1 === a2, { a1, a2 });
  ok("...a different amount is a different row",
    presets.statementExternalId(NAME, { ...row, amountCents: 25001 }, sha256) !== a1);
  ok("...a different date is a different row",
    presets.statementExternalId(NAME, { ...row, date: "2026-05-05" }, sha256) !== a1);
  ok("...and a different memo is a different row (two $40s on one day are two gifts)",
    presets.statementExternalId(NAME, { ...row, memo: "second one" }, sha256) !== a1);
  ok("TWO BANKS ARE TWO SOURCES: the same line at another bank is a different gift",
    presets.statementExternalId("Zelle at Second Bank", row, sha256) !== a1);

  // ══ §6 · the mapping belongs to the org that saved it ════════════════════
  console.log("\n— §6 · the org wall —");
  await seed(B, "b92stb");
  const tokB = await login("b92stb@t.local");
  const bList = await api("GET", "/statement-mappings", tokB);
  ok("org B sees none of org A's saved mappings", (bList.body?.mappings || []).length === 0, bList.body);
  const bMatch = await api("POST", "/statement-mappings/match", tokB, { headers: h2 });
  ok("...and the same file matches nothing for org B", bMatch.body?.matched === false, bMatch.body);
  const bDelete = await api("DELETE", `/statement-mappings/${saved.body.mapping.id}`, tokB);
  ok("...and org B cannot delete org A's mapping", bDelete.status === 404, bDelete.status);
  const [aStill] = await q(`SELECT COUNT(*)::int n FROM statement_mappings WHERE org_id=$1`, [A]);
  ok("...org A still has its mapping", aStill.n === 1, aStill);

  // Saving the SAME name twice corrects it, never mints a second.
  const corrected = await api("POST", "/statement-mappings", tok, {
    name: NAME.toLowerCase(), mapping: { ...MAPPING, notes: "" }, dropNegative: false,
  });
  ok("saving the same name again corrects the mapping", corrected.status === 200, corrected.body);
  const [oneStill] = await q(`SELECT COUNT(*)::int n FROM statement_mappings WHERE org_id=$1`, [A]);
  ok("...and there is still exactly ONE mapping by that name", oneStill.n === 1, oneStill);

  for (const t of CHILD) { await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => { }); await q(`DELETE FROM ${t} WHERE org_id=$1`, [B]).catch(() => { }); }
  await q(`DELETE FROM orgs WHERE id IN ($1,$2)`, [A, B]).catch(() => { });
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

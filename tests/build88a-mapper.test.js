// BUILD-88a A.7 — THE MAPPER, CORRECTED. Run: node tests/build88a-mapper.test.js
//
// BUILD-87 found it on a real org's receipt: "Fund → new custom field" and
// "Payment Method → type". Both were true, and the cause was one line —
// /donors/import-combined hardcoded NULL for a gift's fund_id and never had a
// payment_method column in its INSERT at all. So the standard columns were
// never written, the CSV mapper had no standard target to offer, and the
// fallback (a custom field) took over. Every imported gift in every org has no
// fund and no payment method.
//
// This suite imports the REAL 2,502-row file into a FRESH org through the real
// route and asks the database what it holds.
//
//   §1  the mapper: every column with a standard home is CLAIMED as standard —
//       Fund, Payment Method, Donor Type and Legacy ID included; exactly one
//       column (Source) is left for a custom field, and it is a genuine select
//   §2  the money columns actually land: fifteen funds as FUNDS, fund_id on
//       every gift that named one, payment_method on every gift that had one,
//       and the gift TYPE is never a payment method
//   §3  a household is two people: "Mr. and Mrs. Gerald Kane" + "Marilyn Kane"
//       behind one family email is two records, never one merged person
//   §4  a pledge payment implies a pledge: Yeardley's seven payments on ONE
//       pledge shell, twelve promised
//   §5  the file still reconciles, to the cent, and the bookkeeper's export
//       from BUILD-87 Part 4 now shows a fund on every row
//
// Local scratch server + Postgres (tests/README.md recipe).

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_b88a";
const FIXTURE = path.join(__dirname, "fixtures", "build77", "steward-messy-2500.csv");
// The file's own parsed net, over every disposition — the number A.7 names and
// the one that must not move when columns find their real homes.
const FILE_DOLLARS = 3137012.96;
const PHYSICAL_ROWS = 2502;

function parseCsv(t) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function reset() {
  for (const t of ["import_merges", "donor_relationships", "workflow_runs", "workflows", "digest_sends", "moves",
    "opportunities", "tasks", "payment_recovery_events", "reconnect_sends", "recurring_subscriptions", "receipts",
    "pledges", "fin_audit_log", "fin_transactions", "gifts", "interactions", "milestone_drafts", "note_reminders",
    "fundraising_goals", "metric_snapshots", "import_field_mappings", "custom_field_events", "custom_field_defs",
    "donors", "campaigns", "fin_funds", "accounts", "budgets", "imports", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B88a Fresh','b88a-fresh',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88a',$1,'b88a@test.local',$2,'Fresh Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b88a',$1,'4010','Contributions','revenue')`, [ORG]);
  // A fresh org arrives with exactly ONE fund — the unrestricted operating fund
  // every org is provisioned with (db.js seedOrgData / ensureOrgLedger).
  await q(`INSERT INTO fin_funds (id,org_id,name,description,restricted)
           VALUES ('ff_b88a',$1,'General Operating','General unrestricted operating fund',false)`, [ORG]);
}

(async () => {
  await reset();
  const tok = await login("b88a@test.local");
  const lib = await import("../shared/importShape.js");
  const cf = await import("../shared/customFieldShape.js");
  const TODAY = civilToday();

  const text = fs.readFileSync(FIXTURE, "utf8");
  const raw = parseCsv(text);
  const headerCells = raw[0];
  const headers = headerCells.map(h => String(h).trim());
  const bodyRows = raw.slice(1).filter(r => r.some(c => String(c).trim() !== ""))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  ok(`the file is ${PHYSICAL_ROWS} physical rows, counted once`, bodyRows.length === PHYSICAL_ROWS, bodyRows.length);

  // ── §1 · the mapper ──────────────────────────────────────────────────────
  console.log("\n— §1 · a column with a standard home never falls through to custom —");
  const txMap = lib.autoDetectTxMapping(headers, bodyRows.slice(0, 10));
  for (const [role, col] of [["fund", "Fund"], ["paymentMethod", "Payment Method"],
    ["donorType", "Donor Type"], ["externalId", "Legacy ID"], ["campaign", "Campaign"]]) {
    ok(`${col} → the standard ${role} field`, txMap[role] === col, { role, got: txMap[role] });
  }
  ok("Payment Method is NOT the gift type — this file has no Gift Type column, so `type` is unmapped",
    txMap.type === "", { got: txMap.type });
  // The two aliases A.7 names that this file does not carry, proved on their own.
  ok("a Designation column maps to the standard Fund field too",
    lib.autoDetectTxMapping(["Name", "Amount", "Designation"], []).fund === "Designation", null);
  for (const idHdr of ["Gift ID", "Ref", "Transaction ID", "Legacy ID"]) {
    ok(`"${idHdr}" maps to the standard external Gift ID`,
      lib.autoDetectTxMapping(["Name", "Amount", idHdr], []).externalId === idHdr, null);
  }
  ok("a bare \"Donor ID\" is still NEVER taken as the gift id (it is the donor key)",
    lib.autoDetectTxMapping(["Donor ID", "Amount"], []).externalId === "", null);
  // "Spring Appeal" is an appeal wherever it lands.
  {
    const rows = [{ Name: "A", Date: "2024-01-02", Amount: "10", Campaign: "Spring Appeal", Method: "Check" },
                  { Name: "B", Date: "2024-01-03", Amount: "20", Campaign: "", Method: "Spring Appeal" },
                  { Name: "C", Date: "2024-01-04", Amount: "30", Campaign: "Gala", Method: "Spring Appeal" }];
    const m = lib.autoDetectTxMapping(["Name", "Date", "Amount", "Campaign", "Method"], rows);
    const b = lib.buildTransactionRows({ rows }, m, { today: TODAY });
    const g = b.gifts.find(x => x.amount === 20);
    ok("\"Spring Appeal\" in a Type/Method column routes to Campaign, and is not stored as a method",
      g && g.campaign === "Spring Appeal" && !g.paymentMethod, g);
    const g3 = b.gifts.find(x => x.amount === 30);
    ok("…and it never overwrites an appeal the row already names — it is just not a payment method",
      g3 && g3.campaign === "Gala" && !g3.paymentMethod, g3);
    const g1 = b.gifts.find(x => x.amount === 10);
    ok("a real payment method is untouched", g1 && g1.paymentMethod === "Check", g1);
  }

  const phys = cf.countPhysicalColumns(text, bodyRows);
  const plan = cf.buildMapperPlan({ headers: headerCells, fields: headers, rows: bodyRows, txMap,
    existingDefs: { donor: [], gift: [] }, savedMappings: [],
    orphanColumns: phys.orphanColumns, overflowRows: phys.overflowRows });
  const proposed = plan.columns.filter(c => c.status === "custom-proposed");
  ok("exactly ONE column is proposed as a custom field, and it is Source",
    proposed.length === 1 && String(proposed[0].header).trim() === "Source", proposed.map(c => c.header));
  for (const hdr of ["Fund", "Legacy ID", "Donor Type", "Payment Method"]) {
    const c = plan.columns.find(x => String(x.header).trim() === hdr);
    ok(`${hdr} is claimed CORE — never offered as a custom field`, c && c.status === "core", c && c.status);
  }
  const src = proposed[0];
  ok("Source is a genuine select with its seven values",
    src.proposal.type === "select" && src.proposal.options.length === 7, src.proposal.options);
  // ONE dropdown per column: the plan has exactly one entry per physical column.
  ok(`one decision per physical column (${phys.total}), no column offered twice`,
    plan.columns.length === phys.total && new Set(plan.columns.map(c => c.index)).size === phys.total,
    { columns: plan.columns.length, physical: phys.total });

  // ── §2 · the real import ─────────────────────────────────────────────────
  console.log("\n— §2 · through the real route: what the database actually holds —");
  const ledger = cf.buildColumnLedger(plan, { [src.index]: { action: "accept", entity: src.entity,
    type: src.proposal.type, label: src.proposal.label, options: src.proposal.options } });
  const colSummary = cf.summarizeColumnLedger(phys.total, ledger);
  ok("the column ledger balances before a byte is written", colSummary.balanced, colSummary);

  const created = (await api("POST", "/custom-fields", tok, {
    entity: src.entity, label: src.proposal.label, type: src.proposal.type,
    options: src.proposal.options, source: "import of steward-messy-2500.csv",
  })).body;
  ok(`the ONE custom field is created: ${created.label} (${created.entity}/${created.type})`,
    created.key === "source" && created.type === "select", created);
  const cfColumns = [{ field: "Source", entity: created.entity, key: created.key, def: created }];
  const fieldMappings = [{ entity: created.entity, header: "Source", fieldId: created.id }];

  const built = lib.buildTransactionRows({ rows: bodyRows }, txMap, { today: TODAY, cfColumns,
    coerceCustomValue: cf.coerceCustomValue, parseBoolValue: cf.parseBoolValue });

  const CHUNK = 500;
  const byDonor = new Map();
  for (const g of built.gifts) { if (!byDonor.has(g.donorIndex)) byDonor.set(g.donorIndex, []); byDonor.get(g.donorIndex).push(g); }
  const recon = { rows: { created: 0, skipped: 0, errored: 0 }, dollars: { created: 0, skipped: 0, errored: 0 } };
  let fundsCreated = 0, balancedEveryChunk = true;
  for (let start = 0; start < built.donors.length; start += CHUNK) {
    const slice = built.donors.slice(start, start + CHUNK);
    const chunkGifts = [];
    slice.forEach((_, li) => { const gg = byDonor.get(start + li); if (gg) gg.forEach(g => { const { donorIndex, ...rest } = g; chunkGifts.push({ ...rest, donorIndex: li }); }); });
    const res = await api("POST", "/donors/import-combined", tok,
      { donors: slice, gifts: chunkGifts, columns: { inFile: phys.total, ledger }, fieldMappings,
        // exactly what the CSV importer sends: this path already ran the
        // BUILD-80 Part 6 identity pass, so the server's blunt email fold is off.
        identityResolved: true });
    if (res.status !== 200) { ok("chunk imports (200)", false, { status: res.status, body: JSON.stringify(res.body).slice(0, 300) }); break; }
    fundsCreated += res.body.fundsCreated || 0;
    const rr = res.body.reconciliation;
    for (const k of ["created", "skipped", "errored"]) { recon.rows[k] += rr.rows[k]; recon.dollars[k] += rr.dollars[k]; }
    if (rr.balanced === false) balancedEveryChunk = false;
  }
  // the semantic follow-up the client always makes (pledges, in-kind, links)
  const sem = await api("POST", "/donors/import-semantics", tok, {
    pledges: built.semantics.pledges, inKind: built.semantics.inKind,
    links: built.semantics.links, reviewTwins: built.semantics.reviewTwins,
    merges: built.identity?.mergeReview || [],
  });
  ok("the semantic follow-up call succeeds", sem.status === 200, sem.status);

  // FUNDS — fifteen, and fund_id on every gift that named one.
  const funds = await q(`SELECT name, restricted FROM fin_funds WHERE org_id=$1 ORDER BY name`, [ORG]);
  ok(`the org has FIFTEEN funds: its own General Operating + the fourteen the file named (import created ${fundsCreated})`,
    funds.length === 15 && fundsCreated === 14, funds.map(f => f.name));
  ok("a fund created by import arrives UNRESTRICTED — a restriction is a board decision, not a column",
    funds.filter(f => f.name !== "General Operating").every(f => f.restricted === false), null);
  ok("no fund is named after a NUMBER (the shifted row's \"500.00\" is not a restriction)",
    !funds.some(f => /^[$]?[\d.,]+$/.test(f.name)), funds.map(f => f.name));
  const wantFund = built.gifts.filter(g => g.fund).length;
  const [gf] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND fund_id IS NOT NULL`, [ORG]);
  ok(`fund_id is set on every gift that named a fund (${wantFund}) — it was NULL on all of them`,
    gf.n === wantFund && wantFund > 2000, { got: gf.n, want: wantFund });
  const [orphanFund] = await q(
    `SELECT COUNT(*)::int n FROM gifts g LEFT JOIN fin_funds f ON f.id=g.fund_id
       WHERE g.org_id=$1 AND g.fund_id IS NOT NULL AND f.id IS NULL`, [ORG]);
  ok("every fund_id points at a real fund of this org", orphanFund.n === 0, orphanFund.n);

  // PAYMENT METHOD — written, and never the gift type.
  const wantMethod = built.gifts.filter(g => g.paymentMethod).length;
  const [pm] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND COALESCE(payment_method,'') <> ''`, [ORG]);
  ok(`payment_method is set on every gift that had one (${wantMethod}) — the column did not exist in the INSERT`,
    pm.n === wantMethod && wantMethod > 2000, { got: pm.n, want: wantMethod });
  const types = await q(`SELECT DISTINCT LOWER(type) t FROM gifts WHERE org_id=$1 ORDER BY 1`, [ORG]);
  const typeSet = types.map(r => r.t);
  ok("the gift TYPE is never a payment method (no venmo/wire/stock/daf/check in the type column)",
    !typeSet.some(t => ["venmo", "wire", "stock", "daf", "check", "cc", "credit card", "online", "ach"].includes(t)), typeSet);
  ok("gift types come from the Notes vocabulary instead: cash, recurring, pledge payment",
    typeSet.sort().join("|") === ["cash", "pledge payment", "recurring"].join("|"), typeSet);
  // DAF — the BUILD-80 rule: a DAF grant is money that arrived and it stays.
  const [daf] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float d
                           FROM gifts WHERE org_id=$1 AND LOWER(payment_method)='daf'`, [ORG]);
  ok("DAF rows are money that arrived and STAYS, recorded as a payment method",
    daf.n > 100 && daf.d > 0, daf);

  // DONOR TYPE — a standard donor field.
  const [dt] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND COALESCE(donor_type,'') <> ''`, [ORG]);
  ok(`donor_type is set from the Donor Type column (${dt.n} donors)`, dt.n > 400, dt.n);

  // CUSTOM FIELDS — exactly one, and none of the four that have a standard home.
  const defs = [...(await api("GET", "/custom-fields?entity=donor", tok)).body,
                ...(await api("GET", "/custom-fields?entity=gift", tok)).body];
  ok("exactly ONE custom field exists on this org", defs.length === 1, defs.map(d => `${d.entity}/${d.label}`));
  for (const banned of ["Fund", "Legacy ID", "Donor Type", "Payment Method"]) {
    ok(`no custom field named "${banned}" was created`,
      !defs.some(d => String(d.label).trim().toLowerCase() === banned.toLowerCase()), defs.map(d => d.label));
  }
  const srcDef = defs[0];
  ok("…and it is Source: a select with seven values, so it filters instead of reading as free text",
    srcDef.label === "Source" && srcDef.type === "select" && (srcDef.options || []).length === 7, srcDef);
  const srcVals = await q(
    `SELECT DISTINCT custom_fields->>'source' v FROM gifts WHERE org_id=$1 AND custom_fields ? 'source' ORDER BY 1`, [ORG]);
  const stored = srcVals.map(r => r.v);
  ok("every stored Source value is one of the seven options — a filter on any of them finds its gifts",
    stored.length > 0 && stored.every(v => srcDef.options.includes(v)), stored);
  const [srcFiltered] = await q(
    `SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND custom_fields->>'source' = 'Mail'`, [ORG]);
  ok("filtering gifts by Source = Mail returns its rows", srcFiltered.n > 100, srcFiltered.n);

  // ── §3 · a household is two people ───────────────────────────────────────
  console.log("\n— §3 · \"Mr. and Mrs. X\" plus \"X\" behind one email is a household, not a merge —");
  const kane = await q(`SELECT name, email FROM donors WHERE org_id=$1 AND name ILIKE '%Kane%' ORDER BY name`, [ORG]);
  ok("the Kanes are TWO people behind their family email, not one merged person",
    kane.length === 2 && kane.map(k => k.name).sort().join("|") === "Gerald Kane|Marilyn Kane"
    && new Set(kane.map(k => k.email)).size === 1, kane);
  const kirk = await q(`SELECT name FROM donors WHERE org_id=$1 AND email='robertkirkpatrick@gmail.example.com' ORDER BY name`, [ORG]);
  ok("the Kirkpatricks behind one email are two records — the couple's record does not swallow the person's",
    kirk.length === 2, kirk.map(k => k.name));
  ok("the household is OFFERED, not decided: both names come back as candidates behind that one email",
    (built.identity.householdCandidates || []).some(h => h.email === "robertkirkpatrick@gmail.example.com" && h.names.length === 2)
    && (built.identity.householdCandidates || []).some(h => h.email === "kanefamily59@gmail.example.com" && h.names.length === 2),
    (built.identity.householdCandidates || []).filter(h => /kane|kirkpatrick/i.test(h.email)));
  // The rule it replaced, still true for a household form that names NOBODY.
  ok("a surname-only household form (\"Mr. and Mrs. Kane\") still matches the person it can only mean",
    lib.matchNamesCompatible(lib.matchNameKey("Mr. and Mrs. Kane"), lib.matchNameKey("Gerald Kane")) === true, null);
  ok("…but one that NAMES a person matches only that person",
    lib.matchNamesCompatible(lib.matchNameKey("Mr. and Mrs. Gerald Kane"), lib.matchNameKey("Marilyn Kane")) === false
    && lib.matchNamesCompatible(lib.matchNameKey("Mr. and Mrs. Gerald Kane"), lib.matchNameKey("Gerald Kane")) === true, null);

  // ── §4 · a pledge payment implies a pledge ───────────────────────────────
  console.log("\n— §4 · seven payments, one pledge —");
  const yPledges = await q(
    `SELECT p.id, p.amount::float amount, p.status, p.notes FROM pledges p JOIN donors d ON d.id=p.donor_id
       WHERE p.org_id=$1 AND d.name ILIKE '%Adam Yeardley%'`, [ORG]);
  ok("Adam Yeardley has exactly ONE pledge — a shell, created from the payments the file carried",
    yPledges.length === 1, yPledges);
  ok("the shell is the schedule the notes state: twelve installments of $1,000 = $12,000, still open",
    yPledges.length === 1 && yPledges[0].amount === 12000 && yPledges[0].status === "open"
    && /12 installments/.test(yPledges[0].notes || ""), yPledges[0]);
  const yGifts = await q(
    `SELECT g.amount::float amount, g.pledge_id FROM gifts g JOIN donors d ON d.id=g.donor_id
       WHERE g.org_id=$1 AND d.name ILIKE '%Adam Yeardley%' ORDER BY g.date`, [ORG]);
  ok("…and all SEVEN of his payments are linked to it, none left as an unrelated gift",
    yGifts.length === 7 && yGifts.every(g => g.pledge_id === yPledges[0].id), yGifts);
  const [unlinked] = await q(
    `SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND LOWER(type)='pledge payment' AND pledge_id IS NULL`, [ORG]);
  ok("no gift of type 'pledge payment' is left without a pledge", unlinked.n === 0, unlinked.n);

  // ── §5 · the file still reconciles, and the bookkeeper's file has funds ──
  console.log("\n— §5 · the money did not move, and the bookkeeper can see the fund —");
  const clientRefused = built.dispositions.filter(d => d.disposition !== "gift");
  const accountedRows = recon.rows.created + recon.rows.skipped + recon.rows.errored + clientRefused.length;
  ok(`the file-level equation closes: ${PHYSICAL_ROWS} rows accounted (${accountedRows})`,
    accountedRows === PHYSICAL_ROWS, { server: recon.rows, clientRefused: clientRefused.length });
  ok("every chunk's reconciliation invariant held", balancedEveryChunk, null);
  const fileDollars = Math.round(built.dispositions.reduce((s, d) => s + (d.dollars || 0), 0) * 100) / 100;
  ok(`the file's parsed total is unchanged at $${FILE_DOLLARS.toLocaleString()} — columns found homes, money did not move`,
    Math.abs(fileDollars - FILE_DOLLARS) < 0.01, fileDollars);
  const [dbCash] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float d FROM gifts WHERE org_id=$1`, [ORG]);
  const giftDollars = Math.round(built.dispositions.filter(d => d.disposition === "gift").reduce((s, d) => s + d.dollars, 0) * 100) / 100;
  ok("the database holds every gift row the builder sent, to the cent",
    dbCash.n === built.gifts.length && Math.abs(dbCash.d - giftDollars) < 0.02, { db: dbCash, sent: built.gifts.length, dollars: giftDollars });

  // The report enforces a ten-year window; the file's oldest gifts are 2018.
  const bkFrom = `${Number(TODAY.slice(0, 4)) - 9}-01-01`;
  const bk = await api("GET", `/reports/bookkeeper?from=${bkFrom}&to=${TODAY}`, tok);
  ok("the bookkeeper's export builds (it refuses rather than write a file that does not foot)", bk.status === 200, bk.status);
  const bkRows = (bk.body && bk.body.rows) || [];
  ok(`the bookkeeper's file has rows (${bkRows.length})`, bkRows.length > 2000, bkRows.length);
  // The blank Fund cells in the file are the only blanks in the export, and
  // the check is exact: every row in the window whose gift named a fund shows
  // it. Before A.7 this column was blank on EVERY row of every export.
  const noFund = bkRows.filter(r => !String(r.fund || "").trim());
  const [dbNoFund] = await q(
    `SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND fund_id IS NULL AND date >= $2 AND date <= $3
       AND LOWER(COALESCE(type,'')) <> 'soft credit'`, [ORG, bkFrom, TODAY]);
  ok(`the Fund column is filled on every row whose gift named a fund (${bkRows.length - noFund.length} of ${bkRows.length}; ${noFund.length} blank, and the database has exactly ${dbNoFund.n} fundless gifts in this window)`,
    noFund.length === dbNoFund.n && bkRows.length - noFund.length > 2000,
    { blank: noFund.length, dbFundless: dbNoFund.n });
  const bkMethods = new Set(bkRows.map(r => String(r.paymentMethod || "").trim()).filter(Boolean));
  ok("…and so is the Payment method column", bkMethods.size >= 10, [...bkMethods].slice(0, 12));
  const bkPledge = bkRows.filter(r => r.pledgePayment);
  ok("the bookkeeper's file marks the pledge payments as pledge payments", bkPledge.length >= 7, bkPledge.length);

  // ── §6 · the orgs that already imported ──────────────────────────────────
  console.log("\n— §6 · a run made before the fix says so, and says what to do —");
  const NOTICE = "Funds and payment methods from this import were not stored. Re-import the file to fill them.";
  const mk = await api("POST", "/imports", tok, { name: "Before the fix", sourceFilename: "old.csv", shape: "transaction",
    rowsIn: 10, giftsCreated: 10, donorsCreated: 5, rowsSetAside: 0, rowsErrored: 0, dollarsIn: 100, dollarsCreated: 100,
    summary: { rowsIn: 10, giftsCreated: 10, donorsCreated: 5, rowsSetAside: 0, rowsErrored: 0, dollarsIn: 100, dollarsCreated: 100 } });
  ok("an import run is recorded", mk.status === 200 && !!mk.body.id, { status: mk.status, body: mk.body });
  const oldId = mk.body.id;
  await q(`UPDATE imports SET committed_at = TIMESTAMPTZ '2026-09-01 10:00:00+00' WHERE id=$1`, [oldId]);
  const listAfter = (await api("GET", "/imports", tok)).body.imports;
  const oldRow = listAfter.find(r => r.id === oldId);
  const newRows = listAfter.filter(r => r.id !== oldId);
  ok("the pre-fix run carries the notice, in those words",
    oldRow && (oldRow.notices || []).includes(NOTICE), oldRow && oldRow.notices);
  ok("a run made after the fix carries none — the notice is a fact about WHEN, not a banner on every row",
    newRows.every(r => (r.notices || []).length === 0), newRows.map(r => r.notices));
  const receipt = (await api("GET", `/imports/${oldId}`, tok)).body.import;
  ok("…and it is on the stored receipt too", (receipt.notices || []).includes(NOTICE), receipt.notices);
  ok("nothing was back-filled by guessing: the notice is the whole remedy",
    (receipt.findings || []).length === 0, receipt.findings);

  summary("build88a-mapper");
  await closeDb();
})();

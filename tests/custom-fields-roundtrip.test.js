// BUILD-78 Part 6 — THE ROUND TRIP IS THE PROOF. The export rendering
// (renderCustomValue, per the 1.3 table) and the import coercion
// (coerceCustomValue) are two implementations by the same author; this suite
// is the first place they can disagree in public — and if they do, the
// export is presumed right until proven otherwise (the caveat from the spec
// holds: shared authorship can share a blind spot, so every type is asserted
// against a hand-written expected value, not only against itself).
//
//   §1  org A: all eight types defined, values through the seam
//   §2  the donor CSV export: one column per live field, current labels,
//       rendered per type — parsed back and asserted against hand-written
//       expectations (money 2dp no symbol, dates ISO, checkbox true/false,
//       multi-select delimiter-joined)
//   §3  a FRESH org B imports the export through the real mapper plan + the
//       real route: definitions match by key/type/options, every value
//       matches by KEY (never label), money to the cent, dates civil, and
//       BOTH axes of the invariant balance on the re-import
//   §4  gift values ride the same loop via the JSON export's typed values
//       rendered per 1.3 and re-imported
//
// Local scratch server + Postgres (tests/README.md recipe).
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_b78rtA", B = "org_b78rtB";

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

async function resetOrg(org) {
  for (const t of ["import_field_mappings", "custom_field_events", "custom_field_defs",
    "fin_audit_log", "fin_transactions", "budgets", "accounts", "fin_funds", "metric_snapshots",
    "gifts", "interactions", "tasks", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,$2,$3,1,'active','team')`, [org, `B78 RT ${org.slice(-1)}`, org.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'RT Admin','admin')`,
    [`u_${org}`, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 10)]);
}

(async () => {
  console.log("custom-fields-roundtrip (BUILD-78 Part 6)");
  await resetOrg(A); await resetOrg(B);
  const tokA = await login(`${A}@test.local`);
  const tokB = await login(`${B}@test.local`);
  const cf = await import("../client/src/lib/customFieldShape.js");
  const lib = await import("../client/src/lib/importShape.js");

  // ── §1 · org A: the full type matrix, values through the seam ────────────
  console.log("\n— §1 · all eight types on org A —");
  const defsSpec = [
    ["Preferred Name", "text"], ["Bio", "long_text"], ["Household Size", "number"],
    ["Pledged Capacity", "money"], ["Last Contact", "date"],
    ["Gift Level", "select", ["Bronze", "Silver", "Gold"]],
    ["Interests", "multi_select", ["Gala", "Newsletter", "Volunteering"]],
    ["Board Member", "checkbox"],
  ];
  const aDefs = {};
  for (const [label, type, options] of defsSpec) {
    const r = await api("POST", "/custom-fields", tokA, { entity: "donor", label, type, options: options || [] });
    aDefs[r.body.key] = r.body;
  }
  const gDef = (await api("POST", "/custom-fields", tokA, { entity: "gift", label: "Appeal Code", type: "text" })).body;
  const gMoney = (await api("POST", "/custom-fields", tokA, { entity: "gift", label: "Match Amount", type: "money" })).body;
  ok("ten definitions on org A (8 donor + 2 gift)", Object.keys(aDefs).length === 8 && gDef.key === "appeal_code" && gMoney.key === "match_amount", null);

  await q(`INSERT INTO donors (id,org_id,name,email) VALUES
    ('d_rt1',$1,'Nadia Ellison','nadia@rt.example'),
    ('d_rt2',$1,'Piotr Lozano','piotr@rt.example')`, [A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES
    ('g_rt1',$1,'d_rt1',250.25,'2025-03-16','cash'),
    ('g_rt2',$1,'d_rt2',75,'2024-11-02','check')`, [A]);
  const w1 = await api("PUT", "/donors/d_rt1/custom-fields", tokA, { values: {
    preferred_name: "Nadi", bio: "Long-time — “quoted” supporter.", household_size: "5",
    pledged_capacity: "1,234.56", last_contact: "3/16/2020", gift_level: "Gold",
    interests: "Gala; Volunteering", board_member: "yes",
  } });
  const w2 = await api("PUT", "/donors/d_rt2/custom-fields", tokA, { values: {
    household_size: "2", pledged_capacity: "10.05", last_contact: "2024-02-29",
    gift_level: "bronze", interests: "Newsletter", board_member: "no",
  } });
  ok("values landed through the seam", w1.status === 200 && w2.status === 200, [w1.body, w2.body]);
  await api("PUT", "/gifts/g_rt1/custom-fields", tokA, { values: { appeal_code: "FY25-XY100", match_amount: "500.50" } });
  await api("PUT", "/gifts/g_rt2/custom-fields", tokA, { values: { appeal_code: "FY24-ZQ775" } });

  // ── §2 · the CSV export renders per the 1.3 table ────────────────────────
  console.log("\n— §2 · export rendering vs hand-written expectations —");
  const csv = await api("GET", "/donors/export/csv", tokA);
  const grid = parseCsv(csv.text);
  const hdr = grid[0];
  for (const [label] of defsSpec) ok(`export carries a "${label}" column`, hdr.includes(label), hdr);
  const rowOf = name => { const i = hdr.indexOf("Name"); return grid.find(r => r[i] === name); };
  const cell = (name, label) => rowOf(name)[hdr.indexOf(label)];
  const EXPECT = [
    ["Nadia Ellison", "Preferred Name", "Nadi"],
    ["Nadia Ellison", "Bio", "Long-time — “quoted” supporter."],
    ["Nadia Ellison", "Household Size", "5"],
    ["Nadia Ellison", "Pledged Capacity", "1234.56"],   // 2dp, no symbol, no thousands separator
    ["Nadia Ellison", "Last Contact", "2020-03-16"],    // ISO civil date
    ["Nadia Ellison", "Gift Level", "Gold"],
    ["Nadia Ellison", "Interests", "Gala; Volunteering"],
    ["Nadia Ellison", "Board Member", "true"],
    ["Piotr Lozano", "Pledged Capacity", "10.05"],
    ["Piotr Lozano", "Last Contact", "2024-02-29"],     // a leap day survives as a civil date
    ["Piotr Lozano", "Gift Level", "Bronze"],           // canonical option, not the case the writer typed
    ["Piotr Lozano", "Board Member", "false"],
  ];
  for (const [name, label, want] of EXPECT) {
    ok(`${name} · ${label} renders "${want}"`, cell(name, label) === want, JSON.stringify(cell(name, label)));
  }

  // ── §3 · a fresh org B imports the export ────────────────────────────────
  console.log("\n— §3 · the re-import: defs by key/type/options, values by KEY, both axes balanced —");
  // org B's definitions from org A's export manifest (the JSON export carries
  // key/type/options; POSTing the same labels regenerates the same keys)
  const manifest = (await api("GET", "/org/export", tokA)).body;
  ok("the JSON export carries the definitions (key/type/options)",
    Array.isArray(manifest.custom_field_defs) && manifest.custom_field_defs.length === 10, manifest.custom_field_defs?.length);
  for (const def of manifest.custom_field_defs.filter(d => d.entity === "donor")) {
    const made = (await api("POST", "/custom-fields", tokB, { entity: def.entity, label: def.label, type: def.type, options: def.options })).body;
    ok(`org B def ${def.key}: key + type + options match`, made.key === def.key && made.type === def.type
      && JSON.stringify(made.options) === JSON.stringify(def.options), made);
  }

  // the mapper plan over the exported CSV: every custom column resolves to
  // org B's defs BY LABEL MATCH, core columns claim their roles, and the
  // column axis balances with zero human intervention needed beyond discards
  const bDefs = { donor: (await api("GET", "/custom-fields?entity=donor", tokB)).body, gift: [] };
  const bodyRows = grid.slice(1).filter(r => r.some(c => String(c).trim() !== ""))
    .map(r => Object.fromEntries(hdr.map((h, i) => [h, r[i] ?? ""])));
  const txMap = lib.autoDetectTxMapping(hdr, bodyRows);
  const plan = cf.buildMapperPlan({ headers: hdr, fields: hdr, rows: bodyRows, txMap, existingDefs: bDefs, savedMappings: [] });
  const custom = plan.columns.filter(c => c.status === "custom-existing");
  ok("every custom column resolves to org B's existing fields (zero new)", custom.length === 8, plan.columns.filter(c => c.status === "custom-proposed").map(c => c.header));
  // remaining donor-record columns (Stage, Total giving, …) are aggregate
  // metadata this transaction-less import discards deliberately
  const decisions = {};
  for (const c of plan.columns) if (c.status === "custom-proposed") decisions[c.index] = { action: "discard" };
  const ledger = cf.buildColumnLedger(plan, decisions);
  const colSummary = cf.summarizeColumnLedger(hdr.length, ledger);
  ok("the COLUMN axis balances on the re-import", colSummary.balanced, colSummary);

  const cfColumns = custom.map(c => ({ field: c.field, entity: "donor", key: c.def.key, def: c.def }));
  const built = lib.buildTransactionRows({ rows: bodyRows }, { ...txMap, amount: "", date: "" }, {
    cfColumns, coerceCustomValue: cf.coerceCustomValue, parseBoolValue: cf.parseBoolValue });
  ok("the ROW axis balances on the re-import (every row one disposition)",
    built.dispositions.length === bodyRows.length && built.donors.length === 2, built.file);
  const res = await api("POST", "/donors/import-combined", tokB, {
    donors: built.donors, gifts: [], columns: { inFile: hdr.length, ledger } });
  ok("org B import lands (200, balanced columns echoed)", res.status === 200 && res.body.columns && res.body.columns.balanced, res.body.columns);

  for (const name of ["Nadia Ellison", "Piotr Lozano"]) {
    const [aRow] = await q(`SELECT custom_fields FROM donors WHERE org_id=$1 AND name=$2`, [A, name]);
    const [bRow] = await q(`SELECT custom_fields FROM donors WHERE org_id=$1 AND name=$2`, [B, name]);
    ok(`${name}: every value round-trips BY KEY (money to the cent, dates civil, arrays intact)`,
      JSON.stringify(aRow.custom_fields) === JSON.stringify(bRow.custom_fields),
      { a: aRow.custom_fields, b: bRow.custom_fields });
  }

  // ── §4 · gift values ride the same loop ──────────────────────────────────
  console.log("\n— §4 · gift values: rendered per 1.3, re-imported, matched by key —");
  const { renderCustomValue } = cf;
  const gDefs = manifest.custom_field_defs.filter(d => d.entity === "gift");
  for (const def of gDefs) await api("POST", "/custom-fields", tokB, { entity: "gift", label: def.label, type: def.type, options: def.options });
  const bGiftDefs = (await api("GET", "/custom-fields?entity=gift", tokB)).body;
  const exGifts = manifest.gifts.filter(g => g.custom_fields && Object.keys(g.custom_fields).length);
  ok("the JSON export carries typed gift values", exGifts.length === 2, exGifts.length);
  for (const g of exGifts) {
    // render per 1.3 (the export rule), then hand the RAW strings to the seam
    const raw = {};
    for (const def of gDefs) { const v = g.custom_fields[def.key]; if (v !== null && v !== undefined) raw[def.key] = renderCustomValue(def, v); }
    const [bDonor] = await q(`SELECT id FROM donors WHERE org_id=$1 AND name=$2`, [B, g.donor_name]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,$4,$5,'cash')`,
      [`g_b_${g.id}`, B, bDonor.id, g.amount, g.date]);
    const wr = await api("PUT", `/gifts/g_b_${g.id}/custom-fields`, tokB, { values: raw });
    ok(`gift ${g.id}: rendered values re-coerce cleanly`, wr.status === 200, wr.body);
    const [bg] = await q(`SELECT custom_fields FROM gifts WHERE id=$1`, [`g_b_${g.id}`]);
    // the JSON export writes an explicit null for a live field with no value
    // (the column exists; the cell is empty); the re-import stores no key at
    // all — both mean "no value", so nulls are dropped before comparing.
    const dropNulls = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined));
    ok(`gift ${g.id}: typed values match by key (cents exact)`,
      JSON.stringify(dropNulls(bg.custom_fields)) === JSON.stringify(dropNulls(g.custom_fields)), { a: g.custom_fields, b: bg.custom_fields });
  }

  await summary();
  await closeDb();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });

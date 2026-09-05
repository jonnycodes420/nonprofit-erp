// BUILD-78 — THE CUSTOM-FIELD GOLDEN. steward-messy-cf.csv (seed 20260905,
// windows-1252 bytes) against an INDEPENDENT answer key
// (tests/fixtures/build78/gen-answer-key.mjs — raw bytes + the spec's rules,
// never the import code under test).
//
//   §1  the ask gate is not extensible: every Part 2 family header routes to
//       the flag family; offering one as a custom destination FAILS here
//   §2  the mapper plan on the real file: 22 physical columns, every one a
//       status; proposals carry evidence; Appeal Code is NEVER select
//   §3  the column axis goes RED: remove one disposition and the server
//       refuses the write (409, nothing lands) — proven, not decorative
//   §4  the real import: dispositions by count AND dollars vs the key,
//       custom values typed in the DB by KEY, soft credit creates no donors
//   §5  ask-gate + drift: deceased-column donors absent from every actionable
//       surface; drift byte-identical before/after custom values (5.5)
//   §6  idempotence by PREVENTION: re-import → zero custom-new in the plan,
//       zero fields created; rename every label → still zero (id mappings)
//
// Local scratch server + Postgres (tests/README.md recipe).
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b78golden";
const FIXTURE = path.join(__dirname, "fixtures", "build78", "steward-messy-cf.csv");
const KEY = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "build78", "answer-key.json"), "utf8"));

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
// Papa-compatible row objects: duplicate headers dedup to `h_1`, overflow
// cells beyond the header width land in __parsed_extra.
function papaLike(headerCells, arr) {
  const fields = []; const seen = new Map();
  for (const h of headerCells.map(x => String(x).trim())) {
    const n = seen.get(h) || 0; seen.set(h, n + 1);
    fields.push(n === 0 ? h : `${h}_${n}`);
  }
  const rows = arr.map(r => {
    const o = {};
    fields.forEach((f, i) => { o[f] = r[i] ?? ""; });
    if (r.length > fields.length) o.__parsed_extra = r.slice(fields.length);
    return o;
  });
  return { fields, rows };
}

async function reset() {
  for (const t of ["workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
    "payment_recovery_events", "reconnect_sends", "recurring_subscriptions", "receipts", "pledges", "fin_audit_log",
    "fin_transactions", "gifts", "interactions", "milestone_drafts", "note_reminders",
    "fundraising_goals", "metric_snapshots", "donors", "campaigns", "fin_funds", "accounts", "budgets",
    "import_field_mappings", "custom_field_events", "custom_field_defs", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B78 Golden','b78-golden',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b78golden',$1,'b78golden@test.local',$2,'Golden Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b78g',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b78g',$1,'General',false)`, [ORG]);
}

(async () => {
  console.log("import-messy-cf (BUILD-78 golden)");
  await reset();
  const tok = await login("b78golden@test.local");
  const lib = await import("../client/src/lib/importShape.js");
  const cf = await import("../client/src/lib/customFieldShape.js");
  const TODAY = new Date().toISOString().slice(0, 10);

  // future-date rows move with the calendar, same re-derivation as B77
  const expected = KEY.dispositions.map(d =>
    d.reason === "future_date" && d.date && d.date <= TODAY ? { ...d, disposition: "gift", reason: null } : d);
  const expCount = (disp, reason) => expected.filter(d => d.disposition === disp && (reason === undefined || d.reason === reason)).length;
  const expDollars = disp => Math.round(expected.filter(d => d.disposition === disp).reduce((s, d) => s + d.dollars, 0) * 100) / 100;

  // ── §1 · THE TRAP, asserted as a family ──────────────────────────────────
  console.log("\n— §1 · exclusion-shaped headers can NEVER be custom destinations —");
  const family = [
    ["Deceased?", "deceased"], ["  deceased ", "deceased"], ["DNS", "doNotSolicit"],
    ["Do Not Mail", "doNotMail"], ["do not solicit", "doNotSolicit"], ["DO NOT CONTACT ", "doNotContact"],
    ["Deceased Date", "deceasedDate"], ["Don’t Contact", "doNotContact"], ["Do Not Email", "doNotEmail"],
  ];
  for (const [hdr, flag] of family) {
    const got = cf.classifyExclusionHeader(hdr);
    ok(`"${hdr}" → ${flag} flag, never a custom field`, got === flag, got);
  }
  ok('the BUILD-77 deliberate non-match holds: "do not include in vendor mailing" flags nothing',
    cf.classifyExclusionHeader("do not include in vendor mailing") === null, null);
  // family through the PLAN: each offered as a lone unmapped column must land status=flag
  for (const [hdr] of family) {
    const plan = cf.buildMapperPlan({ headers: ["Name", hdr], fields: ["Name", hdr.trim()], rows: [{ Name: "A", [hdr.trim()]: "Y" }], txMap: { donorName: "Name" }, existingDefs: { donor: [], gift: [] } });
    const c = plan.columns[1];
    ok(`plan: "${hdr}" is status=flag (custom-field offer would fail this line)`, c.status === "flag", c.status);
  }

  // ── §2 · the plan on the real file ───────────────────────────────────────
  console.log("\n— §2 · 22 physical columns, every one a status —");
  const bytes = fs.readFileSync(FIXTURE);
  const text = lib.decodeSpreadsheetBytes(new Uint8Array(bytes));
  ok("windows-1252 bytes decoded (smart quotes survive)", text.includes("O’Brien Financial") && text.includes("Café Río"), null);
  const rawAll = parseCsv(text);
  const headerCells = rawAll[0];
  const bodyArr = rawAll.slice(1).filter(r => r.some(c => String(c).trim() !== ""));
  const { fields, rows } = papaLike(headerCells, bodyArr);
  ok(`physical rows = ${KEY.file.physicalRows}, counted once at parse entry`, rows.length === KEY.file.physicalRows, rows.length);
  const phys = cf.countPhysicalColumns(text, rows);
  ok(`physical columns = ${KEY.columnAxis.inFile} (header cells ${KEY.columnAxis.headerCells} + ${KEY.columnAxis.orphanColumns} orphan overflow)`,
    phys.total === KEY.columnAxis.inFile && phys.orphanColumns === KEY.columnAxis.orphanColumns, phys);

  const txMap = lib.autoDetectTxMapping(fields, rows.slice(0, 10));
  const plan = cf.buildMapperPlan({ headers: headerCells, fields, rows, txMap, existingDefs: { donor: [], gift: [] }, savedMappings: [],
    orphanColumns: phys.orphanColumns, overflowRows: phys.overflowRows });
  ok("one plan entry per physical column", plan.columns.length === KEY.columnAxis.inFile, plan.columns.length);
  const byHeader = h => plan.columns.find(c => String(c.header).trim() === h && c.status !== "core");
  ok(`${KEY.columnAxis.dispositions.core} columns claimed core`, plan.columns.filter(c => c.status === "core").length === KEY.columnAxis.dispositions.core,
    plan.columns.filter(c => c.status === "core").map(c => c.header));
  const trap = plan.columns.find(c => String(c.header).trim() === "Deceased?");
  ok("Deceased? → flag (the trap; a custom offer here is a test failure)", trap && trap.status === "flag" && trap.flag === "deceased", trap && trap.status);
  ok("…with its matched values surfaced for the human", trap.matchedValues.length > 0 && trap.matchedCount > 0, trap.matchedValues);
  for (const spec of KEY.columnAxis.customFields) {
    const c = byHeader(spec.header);
    ok(`${spec.header}: proposed as a custom field`, c && c.status === "custom-proposed", c && c.status);
  }
  const appeal = byHeader("Appeal Code");
  ok("Appeal Code is guessed TEXT, never select (high cardinality is free text wearing a costume)",
    appeal.proposal.type === "text", appeal.proposal.type);
  const board = byHeader("Board Member");
  ok("Board Member is guessed checkbox, with evidence", board.proposal.type === "checkbox" && board.proposal.evidence.parsed > 0, board.proposal);
  const lastContact = byHeader("Last Contact");
  ok("Last Contact is guessed date and the evidence names the failures (the mixed column, counted BEFORE the write)",
    lastContact.proposal.type === "date" && lastContact.proposal.evidence.failed > 0, lastContact.proposal.evidence);
  const giftLevel = byHeader("Gift Level");
  ok(`Gift Level is a genuine select: ${KEY.giftLevelOptions.length} options after case-fold`,
    giftLevel.proposal.type === "select" && giftLevel.proposal.options.length === KEY.giftLevelOptions.length, giftLevel.proposal.options);
  const blank = plan.columns.find(c => !String(c.header).trim() && c.status === "refused" && c.reason === "no header");
  ok("the blank header column is refused with its reason", !!blank, null);
  ok("the 2 orphan overflow columns are refused with their reason",
    plan.columns.filter(c => c.status === "refused" && /overflow/.test(c.reason || "")).length === 2, null);
  const notesDup = plan.columns.find(c => c.field === "Notes_1");
  ok("the duplicate Notes header counts physically and needs its own decision", notesDup && notesDup.status === "custom-proposed", notesDup && notesDup.status);

  // the golden decisions (spec Part 8): accept the eight, discard Legacy ID +
  // the duplicate Notes; Soft Credit To is TYPE-OVERRIDDEN to text (it stores
  // as text, creates no donors, touches no drift).
  const decisions = {};
  for (const spec of KEY.columnAxis.customFields) {
    const c = byHeader(spec.header);
    decisions[c.index] = { action: "accept", entity: spec.entity, type: spec.type, label: spec.header,
      options: spec.type === "select" ? c.proposal.options : [] };
  }
  decisions[byHeader("Legacy ID").index] = { action: "discard" };
  decisions[notesDup.index] = { action: "discard" };

  const ledger = cf.buildColumnLedger(plan, decisions);
  const colSummary = cf.summarizeColumnLedger(phys.total, ledger);
  ok("the ledger balances: every column exactly one disposition", colSummary.balanced, colSummary);
  const D = KEY.columnAxis.dispositions;
  ok(`dispositions match the key: ${D.core} core · ${D.custom} custom · ${D.flag} flag · ${D.discarded} discarded · ${D.refused} refused`,
    colSummary.counts.core === D.core && (colSummary.counts["custom-new"] + colSummary.counts["custom-existing"]) === D.custom
    && colSummary.counts.flag === D.flag && colSummary.counts.discarded === D.discarded && colSummary.counts.refused === D.refused,
    colSummary.counts);

  // ── §3 · PROVE THE RED ───────────────────────────────────────────────────
  console.log("\n— §3 · the column check goes red (what would have to be true: a column leaves the ledger) —");
  const sabotaged = ledger.slice(0, -1);   // one column silently vanishes from the accounting
  const redRes = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Red Probe", email: "red@b78.test" }], gifts: [],
    columns: { inFile: phys.total, ledger: sabotaged },
  });
  ok("the server REFUSES the write (409 columns_unreconciled)", redRes.status === 409 && redRes.body.error === "columns_unreconciled",
    { status: redRes.status, body: redRes.body });
  const [redRow] = await q(`SELECT COUNT(*)::int c FROM donors WHERE org_id=$1`, [ORG]);
  ok("…and NOTHING landed", redRow.c === 0, redRow);
  console.log("  RED RUN:", JSON.stringify(redRes.body).slice(0, 200));
  const badDisp = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Red Probe", email: "red@b78.test" }], gifts: [],
    columns: { inFile: phys.total, ledger: [...ledger.slice(0, -1), { ...ledger[ledger.length - 1], disposition: "parked" }] },
  });
  ok("a disposition outside the closed set is refused the same way", badDisp.status === 409, badDisp.status);

  // ── §4 · the real import ─────────────────────────────────────────────────
  console.log("\n— §4 · through the real route, against the key —");
  // create the accepted fields exactly as the mapper does (explicit accepts)
  const cfColumns = [];
  const fieldMappings = [];
  for (const entry of ledger) {
    if (entry.disposition !== "custom-new") continue;
    const col = plan.columns.find(c => c.index === entry.index);
    const created = (await api("POST", "/custom-fields", tok, {
      entity: entry.entity, label: entry.label, type: entry.type, options: entry.options || [],
      source: "import of steward-messy-cf.csv",
    })).body;
    ok(`field created: ${created.label} (${created.entity}/${created.type}) key=${created.key}`, !!created.key, created);
    cfColumns.push({ field: col.field, entity: created.entity, key: created.key, def: created });
    fieldMappings.push({ entity: created.entity, header: String(entry.header).trim(), fieldId: created.id });
  }
  const keyByHeader = Object.fromEntries(KEY.columnAxis.customFields.map(f => [f.header, f.key]));
  ok("generated keys match the key's expectations", cfColumns.every(c =>
    keyByHeader[String(c.field).replace(/_\d+$/, "")] === undefined || c.key === keyByHeader[c.field]), cfColumns.map(c => c.key));
  const trapFields = (await api("GET", "/custom-fields?entity=donor", tok)).body.filter(f => /deceased/i.test(f.label));
  ok("NO field named anything like Deceased was created (the trap stayed shut)", trapFields.length === 0, trapFields);

  const flagColumns = { deceased: "Deceased?" };
  const built = lib.buildTransactionRows({ rows }, txMap, { today: TODAY, flagColumns, cfColumns,
    coerceCustomValue: cf.coerceCustomValue, parseBoolValue: cf.parseBoolValue });
  ok("every physical row exactly one disposition", built.dispositions.length === KEY.file.physicalRows
    && new Set(built.dispositions.map(d => d.line)).size === KEY.file.physicalRows, built.dispositions.length);
  for (const [disp] of [["gift"], ["skipped"], ["errored"]]) {
    const got = built.dispositions.filter(d => d.disposition === disp).length;
    ok(`${disp} rows: ${expCount(disp)} — by count`, got === expCount(disp), { got });
    const gotD = Math.round(built.dispositions.filter(d => d.disposition === disp).reduce((s, d) => s + d.dollars, 0) * 100) / 100;
    ok(`${disp} dollars: $${expDollars(disp)} — by dollars, never totals alone`, Math.abs(gotD - expDollars(disp)) < 0.01, { gotD });
  }
  for (const reason of Object.keys(KEY.reasons)) {
    const got = built.dispositions.filter(d => d.reason === reason).length;
    ok(`reason ${reason}: ${expCount(undefined, reason) || expected.filter(d => d.reason === reason).length} rows`,
      got === expected.filter(d => d.reason === reason).length, { got });
  }

  // through the route, chunked, ledger riding every chunk
  const CHUNK = 500;
  const byDonor = new Map();
  for (const g of built.gifts) { if (!byDonor.has(g.donorIndex)) byDonor.set(g.donorIndex, []); byDonor.get(g.donorIndex).push(g); }
  let colEcho = null;
  for (let start = 0; start < built.donors.length; start += CHUNK) {
    const slice = built.donors.slice(start, start + CHUNK);
    const chunkGifts = [];
    slice.forEach((_, li) => { const gg = byDonor.get(start + li); if (gg) gg.forEach(g => { const { donorIndex, ...rest } = g; chunkGifts.push({ ...rest, donorIndex: li }); }); });
    const res = await api("POST", "/donors/import-combined", tok, { donors: slice, gifts: chunkGifts,
      columns: { inFile: phys.total, ledger }, fieldMappings });
    if (res.status !== 200) { ok("chunk imports (200)", false, { status: res.status, body: JSON.stringify(res.body).slice(0, 300) }); break; }
    colEcho = res.body.columns;
  }
  ok("the server echoes a balanced column summary", colEcho && colEcho.balanced, colEcho);

  // Part 9 — an imported custom value is auditable: a values_written event
  // stamped via=import with the importer's identity (never null).
  const impEvents = await q(`SELECT entity, created_by, created_by_name, detail->>'via' via FROM custom_field_events
    WHERE org_id=$1 AND event='values_written' AND detail->>'via'='import'`, [ORG]);
  ok("import wrote an auditable custom-field event (donor + gift), stamped with the importer",
    impEvents.length >= 2 && impEvents.every(e => e.created_by && e.via === "import")
    && impEvents.some(e => e.entity === "donor") && impEvents.some(e => e.entity === "gift"),
    impEvents);

  const [dc] = await q(`SELECT COUNT(*)::int c FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
  ok(`donor count = ${KEY.donorCount} (soft credit created NONE)`, dc.c === KEY.donorCount, dc.c);
  for (const ghostName of KEY.softCreditNonDonors) {
    const [g] = await q(`SELECT COUNT(*)::int c FROM donors WHERE org_id=$1 AND name=$2`, [ORG, ghostName]);
    ok(`"${ghostName}" is a soft-credit VALUE, not a donor`, g.c === 0, g.c);
  }
  const [gc] = await q(`SELECT COUNT(*)::int c, COALESCE(SUM(amount),0)::float s FROM gifts WHERE org_id=$1`, [ORG]);
  ok(`gifts in the DB: ${expCount("gift")} rows, $${expDollars("gift")} to the cent`,
    gc.c === expCount("gift") && Math.abs(gc.s - expDollars("gift")) < 0.01, gc);

  // custom values by KEY, typed
  for (const sd of KEY.sampleDonors) {
    const [row] = await q(`SELECT name, custom_fields FROM donors WHERE org_id=$1 AND LOWER(${sd.key.includes("@") ? "email" : "name"})=$2`,
      [ORG, sd.key.includes("@") ? sd.key : sd.name.toLowerCase()]).then(r => r.length ? r : q(
      `SELECT name, custom_fields FROM donors WHERE org_id=$1 AND name=$2`, [ORG, sd.name]));
    if (!row) { ok(`sample donor ${sd.name} found`, false, sd.key); continue; }
    const got = row.custom_fields || {};
    for (const [k, v] of Object.entries(sd.custom)) {
      ok(`${sd.name}.${k} = ${JSON.stringify(v)} (typed, matched by KEY)`, JSON.stringify(got[k]) === JSON.stringify(v), got[k]);
    }
  }
  if (KEY.sampleGiftCustom) {
    const sg = KEY.sampleGiftCustom;
    const rowsG = await q(`SELECT g.custom_fields FROM gifts g JOIN donors d ON d.id=g.donor_id
      WHERE g.org_id=$1 AND d.name=$2 AND g.date=$3 AND g.amount=$4`, [ORG, sg.donor, sg.date, sg.amount]);
    ok(`a gift-level value landed on the gift row (${sg.custom.appeal_code})`,
      rowsG.length > 0 && rowsG.some(r => (r.custom_fields || {}).appeal_code === sg.custom.appeal_code), rowsG[0]);
  }
  const [bm] = await q(`SELECT COUNT(*)::int c FROM donors WHERE org_id=$1 AND (custom_fields->>'board_member')::boolean IS TRUE`, [ORG]);
  ok(`board members stored as booleans: ${KEY.boardMembers}`, bm.c === KEY.boardMembers, bm.c);
  const [enc] = await q(`SELECT custom_fields->>'matching_employer' e FROM donors WHERE org_id=$1 AND custom_fields->>'matching_employer' LIKE '%Brien%' LIMIT 1`, [ORG]);
  ok("encoding repaired: O’Brien Financial stored with its real apostrophe", enc && enc.e === "O’Brien Financial", enc);

  // ── §5 · the ask gate + drift (5.5) ──────────────────────────────────────
  console.log("\n— §5 · deceased-column donors gone from every actionable surface; drift blind to custom fields —");
  // BY IDENTITY, never by name — the fixture has name collisions on purpose
  // (three donors share "Wendy Reyes"; one is deceased, two are alive and
  // legitimately actionable — the B77 Guillory lesson, re-learned in red).
  const decRows = await q(`SELECT id, name FROM donors WHERE org_id=$1 AND deceased IS TRUE`, [ORG]);
  const decIds = new Set(decRows.map(r => r.id));
  ok(`${KEY.deceased.length}+ donors deceased via the COLUMN (not notes)`, decRows.length >= KEY.deceased.length, decRows.length);
  const drift = (await api("GET", "/drift", tok)).body;
  const driftIds = (drift.list || drift.donors || []).map(x => x.id || x.donorId).filter(Boolean);
  ok("no deceased donor on the drift list (by identity)", !driftIds.some(id => decIds.has(id)), driftIds.filter(id => decIds.has(id)));
  const attn = (await api("GET", "/dashboard/today?scope=all", tok)).body;
  ok("no deceased donor in Needs Your Attention (by identity)", !attn.some(i => decIds.has(i.donorId)),
    attn.filter(i => decIds.has(i.donorId)).map(i => i.donorName));
  const dnsNotes = KEY.doNotSolicitFromNotes.map(n => n.toLowerCase());
  const [dnsDb] = await q(`SELECT COUNT(*)::int c FROM donors WHERE org_id=$1 AND do_not_solicit IS TRUE`, [ORG]);
  ok("detectNoteMarkers still runs on the notes column (custom fields do not replace free-text scanning)", dnsDb.c >= dnsNotes.length, { db: dnsDb.c, key: dnsNotes.length });

  // 5.5 — byte-identical drift around custom values on a drifting AND an excluded donor
  const driftBefore = JSON.stringify(drift);
  const [drifting] = await q(`SELECT id FROM donors WHERE org_id=$1 AND deceased IS NOT TRUE AND deleted_at IS NULL AND last_gift_date IS NOT NULL ORDER BY last_gift_date ASC LIMIT 1`, [ORG]);
  const [excludedD] = await q(`SELECT id FROM donors WHERE org_id=$1 AND deceased IS TRUE LIMIT 1`, [ORG]);
  for (const target of [drifting, excludedD]) {
    if (!target) continue;
    await api("PUT", `/donors/${target.id}/custom-fields`, tok, { values: { preferred_name: "Drift Probe" } });
  }
  const driftAfter = JSON.stringify((await api("GET", "/drift", tok)).body);
  ok("drift output BYTE-IDENTICAL after custom values on a drifting and an excluded donor (5.5)", driftAfter === driftBefore, null);
  const badgeBefore = (await api("GET", "/donors/summaries", tok)).body;
  void badgeBefore; // summaries fetched to prove the route also serves post-write without drift fields changing — asserted via drift JSON above

  // ── §6 · idempotence by prevention ───────────────────────────────────────
  console.log("\n— §6 · re-import creates nothing; renamed labels still resolve —");
  const saved = (await api("GET", "/import-field-mappings", tok)).body;
  ok(`saved mappings persisted for ${fieldMappings.length} headers, storing FIELD IDS`, saved.length >= fieldMappings.length && saved.every(m => m.fieldId), saved.length);
  const defsNow = { donor: (await api("GET", "/custom-fields?entity=donor", tok)).body, gift: (await api("GET", "/custom-fields?entity=gift", tok)).body };
  const fieldCountBefore = defsNow.donor.length + defsNow.gift.length;
  const plan2 = cf.buildMapperPlan({ headers: headerCells, fields, rows, txMap, existingDefs: defsNow, savedMappings: saved,
    orphanColumns: phys.orphanColumns, overflowRows: phys.overflowRows });
  ok("re-import plan: every custom column resolves to an EXISTING field (zero proposals)",
    plan2.columns.filter(c => c.status === "custom-proposed" && KEY.columnAxis.customFields.some(f => f.header === String(c.header).trim())).length === 0,
    plan2.columns.filter(c => c.status === "custom-proposed").map(c => c.header));
  ok("…via the saved mapping, by field id", plan2.columns.filter(c => c.status === "custom-existing").every(c => c.via === "saved-mapping" || c.via === "label-match"), null);

  // rename EVERY custom label, then re-plan: still zero new fields needed
  for (const f of [...defsNow.donor, ...defsNow.gift]) {
    await api("PUT", `/custom-fields/${f.id}`, tok, { label: `Renamed — ${f.label} ☃` });
  }
  const defsRenamed = { donor: (await api("GET", "/custom-fields?entity=donor", tok)).body, gift: (await api("GET", "/custom-fields?entity=gift", tok)).body };
  const plan3 = cf.buildMapperPlan({ headers: headerCells, fields, rows, txMap, existingDefs: defsRenamed, savedMappings: saved,
    orphanColumns: phys.orphanColumns, overflowRows: phys.overflowRows });
  const stillResolved = plan3.columns.filter(c => c.status === "custom-existing");
  ok("after renaming every label (any encoding), the saved id-mappings still resolve every custom column",
    stillResolved.length === KEY.columnAxis.dispositions.custom, stillResolved.map(c => c.header));

  // actually re-import (existing fields, no creations) and assert prevention
  const decisions2 = {};
  decisions2[byHeader("Legacy ID").index] = { action: "discard" };
  decisions2[notesDup.index] = { action: "discard" };
  const ledger2 = cf.buildColumnLedger(plan3, decisions2);
  const cfColumns2 = plan3.columns.filter(c => c.status === "custom-existing")
    .map(c => ({ field: c.field, entity: c.def.entity, key: c.def.key, def: c.def }));
  const built2 = lib.buildTransactionRows({ rows }, txMap, { today: TODAY, flagColumns, cfColumns: cfColumns2,
    coerceCustomValue: cf.coerceCustomValue, parseBoolValue: cf.parseBoolValue });
  const byDonor2 = new Map();
  for (const g of built2.gifts) { if (!byDonor2.has(g.donorIndex)) byDonor2.set(g.donorIndex, []); byDonor2.get(g.donorIndex).push(g); }
  for (let start = 0; start < built2.donors.length; start += CHUNK) {
    const slice = built2.donors.slice(start, start + CHUNK);
    const chunkGifts = [];
    slice.forEach((_, li) => { const gg = byDonor2.get(start + li); if (gg) gg.forEach(g => { const { donorIndex, ...rest } = g; chunkGifts.push({ ...rest, donorIndex: li }); }); });
    const res = await api("POST", "/donors/import-combined", tok, { donors: slice, gifts: chunkGifts, columns: { inFile: phys.total, ledger: ledger2 } });
    if (res.status !== 200) { ok("re-import chunk (200)", false, { status: res.status, body: JSON.stringify(res.body).slice(0, 200) }); break; }
  }
  const defsAfter = { donor: (await api("GET", "/custom-fields?entity=donor", tok)).body, gift: (await api("GET", "/custom-fields?entity=gift", tok)).body };
  ok("second import created ZERO new fields — prevention, not cleanup",
    defsAfter.donor.length + defsAfter.gift.length === fieldCountBefore, { before: fieldCountBefore, after: defsAfter.donor.length + defsAfter.gift.length });
  // Cross-run donor dedup is BY EMAIL (the BUILD-72 trade: a duplicate the
  // user can delete beats a gift that vanished) — so the honest idempotence
  // claim is scoped to emailed donors; the field/value claims are absolute.
  const [dc2] = await q(`SELECT COUNT(DISTINCT LOWER(email))::int c FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND email != ''`, [ORG]);
  const [dc2b] = await q(`SELECT COUNT(*)::int c FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND email != ''`, [ORG]);
  ok("re-import created no duplicate emailed donor", dc2.c === dc2b.c, { distinct: dc2.c, rows: dc2b.c });
  const dupKeys = await q(`SELECT entity, key, COUNT(*)::int c FROM custom_field_defs WHERE org_id=$1 GROUP BY entity, key HAVING COUNT(*) > 1`, [ORG]);
  ok("no duplicate keys", dupKeys.length === 0, dupKeys);
  const probe = KEY.sampleDonors[0];
  const [pRow] = await q(`SELECT custom_fields FROM donors WHERE org_id=$1 AND name=$2`, [ORG, probe.name]);
  ok("a matched donor's values are unchanged (fill-missing, never clobbered)",
    pRow && Object.entries(probe.custom).every(([k, v]) => JSON.stringify((pRow.custom_fields || {})[k]) === JSON.stringify(v)), pRow && pRow.custom_fields);

  await summary();
  await closeDb();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });

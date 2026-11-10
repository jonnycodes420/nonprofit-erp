// tests/wealth1.test.js · WEALTH-1. A WEALTH SCORE ON EVERY PERSON: SET IT,
// FILTER IT, SORT IT, REPORT ON IT, AND ONLY THE RIGHT PEOPLE SEE IT.
//
//   §1  set, change and clear on the profile; each change writes an audit row
//       with the old value and the new
//   §2  the Donors list: "equals 5" and "at least 4"; the sort both ways with
//       blanks last; a saved view keeps the filter and the sort; a group by rule
//   §3  the starter report "Donors by Wealth Score" and both CSVs carry it
//   §4  an import column maps it (header to field, and the file to the row);
//       the bulk set works and audits each person
//   §5  a suggestion is shown beside an empty score and NEVER written until
//       clicked; accepting it is one click
//   §6  Atlas answers "show me my 5s who haven't given this year"
//   §7  a staff member without the permission gets 403 everywhere and never
//       sees the column or the stored value; the team switch opens it; no
//       donor-facing merge field can carry it
//
// HOW IT GOES RED (both planted and watched red before trusting the green):
//   - blanks sorting first: change `NULLS LAST` to `NULLS FIRST` in
//     donorList.js sortSql → §2's "blanks last" checks go red
//   - a suggestion saved without a click: have GET /donors/:id/wealth-score
//     write its suggestion → §5's "nothing written" checks go red
//
// Standard scratch stack (tests/README.md). Never reaches the network. Sets
// its own dates relative to the org's today.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_wealth1t";
const P = (k) => `d_w1t_${k}`;

async function reset() {
  for (const t of ["fin_audit_log", "audiences", "donor_list_views", "saved_reports", "screening_results", "gifts", "donor_scores"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Wealth One Test','wealth-one-test',1,'active','team')
           ON CONFLICT (id) DO UPDATE SET wealth_scores_team=false`, [ORG]);
  await q(`UPDATE orgs SET wealth_scores_team=false WHERE id=$1`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [id, role] of [["admin", "admin"], ["staff", "member"]]) {
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,can_major_gifts) VALUES ($1,$2,$3,$4,$5,$6,false)
             ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, can_major_gifts=false`,
      [`u_${ORG}_${id}`, ORG, `${id}@${ORG}.test`, hash, id === "admin" ? "Wren Admin" : "Tam Staff", role]);
  }
  // Made-up people. Juno 5 (no gift this year), Pell 5 (gave this year), Odo 4, Ash 1, Bly blank, Cato blank (the suggestion).
  const people = [["juno", "Juno Ferris", 5], ["pell", "Pell Arbor", 5], ["odo", "Odo Vance", 4], ["ash", "Ash Lindqvist", 1], ["bly", "Bly Okafor", null], ["cato", "Cato Merriweather", null]];
  for (const [k, name, s] of people)
    await q(`INSERT INTO donors (id,org_id,name,email,address,city,state,zip,kind,stage,wealth_rating,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'1 Elm St','Bath','ME','04530','individual','cultivate',$5,$6,'Wren Admin')`,
      [P(k), ORG, name, `${k}@wealth1.test`, s, `u_${ORG}_admin`]);
}
async function token(who) {
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${who}@${ORG}.test`, password: "loadtest1234" }) });
  return (await r.json()).token;
}
const call = async (tok, method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, text, body: json || {} };
};
const enc = o => encodeURIComponent(JSON.stringify(o));
const stored = async k => { const [r] = await q(`SELECT wealth_rating FROM donors WHERE id=$1`, [P(k)]); return r.wealth_rating == null ? null : Number(r.wealth_rating); };
const ids = r => (r.body.donors || []).map(d => d.id);
// The audit row is written as the response finishes; give it a moment.
const settle = async (fn, want) => { let rows = []; for (let i = 0; i < 20; i++) { rows = await fn(); if (rows.length >= want) break; await new Promise(r => setTimeout(r, 100)); } return rows; };

(async () => {
  console.log("WEALTH-1: a Wealth Score on every person\n");
  await reset();
  const admin = await token("admin"), staff = await token("staff");
  ok("both sign in", !!admin && !!staff);
  const [{ t }] = await q(`SELECT CURRENT_DATE::text AS t`);
  const year = Number(t.slice(0, 4));
  // Pell gave this year (well inside any fiscal year that began this calendar year or last);
  // Cato gave $12,000 last calendar year and nothing since.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,created_by,created_by_name) VALUES
             ('g_w1t_pell',$1,$2,250,$3,'cash','Check',$4,'Wren Admin'),
             ('g_w1t_cato',$1,$5,12000,$6,'cash','Check',$4,'Wren Admin')`,
    [ORG, P("pell"), t, `u_${ORG}_admin`, P("cato"), `${year - 1}-01-15`]);

  // ── §1 the profile ────────────────────────────────────────────────────────
  const auditRows = async () => q(`SELECT before_fields, after_fields, changes, user_id FROM fin_audit_log WHERE org_id=$1 AND entity_id=$2 ORDER BY created_at`, [ORG, P("bly")]);
  let r = await call(admin, "PATCH", `/donors/${P("bly")}/wealth-score`, { score: 3 });
  ok("§1 set: Bly's Wealth Score is 3", r.status === 200 && r.body.score === 3 && (await stored("bly")) === 3 && r.body.setByName === "Wren Admin", r.body);
  r = await call(admin, "PATCH", `/donors/${P("bly")}/wealth-score`, { score: 2 });
  ok("§1 change: 3 to 2", r.status === 200 && r.body.score === 2 && (await stored("bly")) === 2, r.body);
  r = await call(admin, "PATCH", `/donors/${P("bly")}/wealth-score`, { score: null });
  ok("§1 clear: Not set", r.status === 200 && r.body.score === null && (await stored("bly")) === null, r.body);
  r = await call(admin, "PATCH", `/donors/${P("bly")}/wealth-score`, { score: 6 });
  ok("§1 a 6 is refused and nothing changes", r.status === 400 && (await stored("bly")) === null, r.body);
  const aud = (await settle(auditRows, 3)).map(a => [JSON.stringify(a.before_fields || {}), JSON.stringify(a.after_fields || {}), a.user_id].join(" | "));
  ok("§1 three audit rows: who, and old to new each time (none to 3, 3 to 2, 2 to none)", aud.length === 3
    && /"wealth_score":null/.test(aud[0].split(" | ")[0]) && /"wealth_score":3/.test(aud[0].split(" | ")[1])
    && /"wealth_score":3/.test(aud[1].split(" | ")[0]) && /"wealth_score":2/.test(aud[1].split(" | ")[1])
    && /"wealth_score":2/.test(aud[2].split(" | ")[0]) && /"wealth_score":null/.test(aud[2].split(" | ")[1])
    && aud.every(a => a.endsWith(`u_${ORG}_admin`)), aud);

  // ── §2 the Donors list ────────────────────────────────────────────────────
  const eq5 = { join: "and", conditions: [{ field: "wealth_score", op: "eq", value: 5 }] };
  r = await call(admin, "GET", `/donors?where=${enc(eq5)}&cols=wealth_score`);
  ok("§2 equals 5: Juno and Pell, nobody else", r.status === 200 && ids(r).sort().join() === [P("juno"), P("pell")].sort().join()
    && r.body.donors.every(d => d.cells && d.cells.wealth_score === 5), ids(r));
  const gte4 = { join: "and", conditions: [{ field: "wealth_score", op: "gte", value: 4 }] };
  r = await call(admin, "GET", `/donors?where=${enc(gte4)}`);
  ok("§2 at least 4: Juno, Pell and Odo", r.status === 200 && ids(r).sort().join() === [P("juno"), P("pell"), P("odo")].sort().join(), ids(r));
  const unset = { join: "and", conditions: [{ field: "wealth_score", op: "blank", value: null }] };
  r = await call(admin, "GET", `/donors?where=${enc(unset)}`);
  ok("§2 is not set: Bly and Cato", r.status === 200 && ids(r).sort().join() === [P("bly"), P("cato")].sort().join(), ids(r));
  const scores = r2 => (r2.body.donors || []).map(d => d.cells.wealth_score);
  const asc = await call(admin, "GET", `/donors?sort=wealth_score&dir=asc&cols=wealth_score&limit=50`);
  const desc = await call(admin, "GET", `/donors?sort=wealth_score&dir=desc&cols=wealth_score&limit=50`);
  ok("§2 ascending 1, 4, 5, 5, then the blanks last", JSON.stringify(scores(asc)) === JSON.stringify([1, 4, 5, 5, null, null]), scores(asc));
  ok("§2 descending 5, 5, 4, 1, then the blanks last", JSON.stringify(scores(desc)) === JSON.stringify([5, 5, 4, 1, null, null]), scores(desc));
  const v = await call(admin, "POST", "/donors/list-views", { name: "My fives", columns: ["name", "wealth_score"], filters: eq5, sort: "wealth_score", sortDir: "asc" });
  const setup = await call(admin, "GET", "/donors/list-setup");
  const kept = (setup.body.views || []).find(x => x.id === (v.body.view || {}).id) || {};
  ok("§2 a saved view keeps the filter, the sort and the column", v.status === 200 && kept.sort === "wealth_score" && kept.sortDir === "asc"
    && JSON.stringify(kept.filters).includes("wealth_score") && (kept.columns || []).includes("wealth_score"), kept);
  const field = (setup.body.fields || []).find(f => f.key === "wealth_score");
  ok("§2 the field reads Wealth Score, sortable, with equals / at least / at most / is not set",
    field && field.label === "Wealth Score" && field.sortable && JSON.stringify(field.filter.ops.map(o => o.label)) === JSON.stringify(["equals", "at least", "at most", "is not set"]), field);
  const g = await call(admin, "POST", "/groups", { name: "Our fives", kind: "dynamic", rules: { where: JSON.stringify(eq5) } });
  const gm = g.body.id ? await q(`SELECT 1`) : null; void gm;
  const gids = g.body.id ? await call(admin, "GET", `/donors/ids?groupId=${g.body.id}`) : { body: {} };
  ok("§2 a group rule can use it", g.status === 201 && (gids.body.ids || []).sort().join() === [P("juno"), P("pell")].sort().join(), { g: g.body, ids: gids.body });

  // ── §3 reports and CSV ────────────────────────────────────────────────────
  const rep = await call(admin, "GET", "/saved-reports/std:donors-by-wealth/run");
  const labels = (rep.body.columns || []).map(c => c.label);
  const wcol = (rep.body.columns || []).find(c => c.label === "Wealth Score");
  const order = (rep.body.rows || []).map(x => x[wcol && wcol.key]);
  ok("§3 the starter report: name, Wealth Score, lifetime, last gift, owner", rep.status === 200
    && JSON.stringify(labels) === JSON.stringify(["Name", "Wealth Score", "Lifetime giving", "Last gift date", "Assigned to"]), labels);
  ok("§3 sorted by Wealth Score, blanks last", JSON.stringify(order) === JSON.stringify([5, 5, 4, 1, null, null]), order);
  const repCsv = await call(admin, "GET", "/saved-reports/std:donors-by-wealth/csv");
  ok("§3 the report's CSV carries it", repCsv.status === 200 && /Wealth Score/.test(repCsv.text.split("\n")[0]), repCsv.text.slice(0, 200));
  const built = await call(admin, "POST", "/report-builder/run", { definition: { entity: "people", columns: ["name", "wealth_score"], filter: { op: "and", rules: [{ field: "wealth_score", cmp: "eq", value: 5 }] } } });
  ok("§3 a Donors report can filter on it (equals 5: two rows)", built.status === 200 && built.body.totals.count === 2, built.body);
  const exp = await call(admin, "GET", "/donors/export/csv");
  const lines = exp.text.split(/\r?\n/);
  const head = lines[0].split(",");
  const wi = head.indexOf("Wealth Score");
  const juno = lines.find(l => l.startsWith("Juno Ferris")) || "";
  ok("§3 the Donors CSV export has a Wealth Score column with Juno's 5", exp.status === 200 && wi >= 0 && juno.split(",")[wi] === "5", { head, juno });

  // ── §4 import and bulk ───────────────────────────────────────────────────
  const IS = await import("../shared/importShape.js");
  const m1 = IS.autoDetectTxMapping(["Name", "Email", "Wealth Score"], [{ Name: "A", Email: "a@x.test", "Wealth Score": "4" }]);
  const m2 = IS.autoDetectTxMapping(["Name", "Email", "DS Rating"], [{ Name: "A", Email: "a@x.test", "DS Rating": "DS2-3" }]);
  ok("§4 a \"Wealth Score\" column maps to the Wealth Score; a vendor's rating still maps to the screen",
    m1.wealthScore === "Wealth Score" && !m1.wealthRating && m2.wealthRating === "DS Rating" && !m2.wealthScore, { m1: m1.wealthScore, m2: m2.wealthRating });
  ok("§4 only a whole 1 to 5 is read from a cell", IS.wealthScoreOf("4") === 4 && IS.wealthScoreOf("5.0") === 5 && IS.wealthScoreOf("6") === null && IS.wealthScoreOf("high") === null && IS.wealthScoreOf("") === null);
  const imp = await call(admin, "POST", "/donors/import-combined", { donors: [
    { name: "Ivo Quarry", email: "ivo@wealth1.test", wealthScore: 4 },
    { name: "Cato Merriweather", email: "cato@wealth1.test", wealthScore: 2 },     // matched, no score: filled
    { name: "Juno Ferris", email: "juno@wealth1.test", wealthScore: 1 },           // matched, already 5: kept
    { name: "Rue Sable", email: "rue@wealth1.test", wealthScore: 9 }], gifts: [] });
  const [ivo] = await q(`SELECT wealth_rating, wealth_rating_set_by_name FROM donors WHERE org_id=$1 AND email='ivo@wealth1.test'`, [ORG]);
  const [rue] = await q(`SELECT wealth_rating FROM donors WHERE org_id=$1 AND email='rue@wealth1.test'`, [ORG]);
  ok("§4 the import sets a new person's score (by the person importing), fills a matched blank, keeps a score already set, refuses a 9",
    imp.status === 200 && ivo && Number(ivo.wealth_rating) === 4 && ivo.wealth_rating_set_by_name === "Wren Admin"
      && (await stored("cato")) === 2 && (await stored("juno")) === 5 && rue && rue.wealth_rating == null, { imp: imp.status, ivo, rue });
  await q(`UPDATE donors SET wealth_rating=NULL WHERE id=$1`, [P("cato")]);   // back to blank for §5
  const bulk = await call(admin, "POST", "/donors/bulk-wealth-score", { ids: [P("ash"), P("bly"), P("odo")], score: 3 });
  const bulkAudit = await settle(() => q(`SELECT entity_id, before_fields, after_fields FROM fin_audit_log WHERE org_id=$1 AND request_path='/donors/bulk-wealth-score' ORDER BY entity_id`, [ORG]), 3);
  ok("§4 bulk set: three people to 3, one audit row each with old and new",
    bulk.status === 200 && bulk.body.changed === 3 && (await stored("ash")) === 3 && (await stored("bly")) === 3 && (await stored("odo")) === 3
      && bulkAudit.length === 3 && bulkAudit.every(a => JSON.stringify(a.after_fields).includes('"wealth_score":3'))
      && JSON.stringify(bulkAudit.find(a => a.entity_id === P("odo")).before_fields).includes('"wealth_score":4'), { bulk: bulk.body, n: bulkAudit.length });

  // ── §5 the suggestion ─────────────────────────────────────────────────────
  const sg = await call(admin, "GET", `/donors/${P("cato")}/wealth-score`);
  ok("§5 beside an empty score: \"Steward suggests 4: gave $12,000 in last year\"", sg.status === 200 && sg.body.score === null && sg.body.suggestion
    && sg.body.suggestion.score === 4 && sg.body.suggestion.sentence === `Steward suggests 4: gave $12,000 in ${year - 1}.`, sg.body);
  await call(admin, "GET", `/donors/${P("cato")}/wealth-score`);
  ok("§5 reading it twice wrote nothing", (await stored("cato")) === null);
  const notCounted = await call(admin, "GET", `/donors?where=${enc({ join: "and", conditions: [{ field: "wealth_score", op: "eq", value: 4 }] })}`);
  ok("§5 a suggested 4 is not counted as a 4", !ids(notCounted).includes(P("cato")), ids(notCounted));
  const acc = await call(admin, "PATCH", `/donors/${P("cato")}/wealth-score`, { score: 4, fromSuggestion: true });
  ok("§5 one click accepts it", acc.status === 200 && (await stored("cato")) === 4 && acc.body.suggestion === null, acc.body);

  // ── §6 Atlas ──────────────────────────────────────────────────────────────
  const at = await call(admin, "POST", "/ask", { text: "show me my 5s who haven't given this year" });
  const atIds = (at.body.people || []).map(p => p.donorId);
  ok("§6 Atlas: my 5s who haven't given this year is Juno (Pell gave)", at.status === 200 && at.body.answered === true && atIds.join() === P("juno"), { sentence: at.body.sentence, atIds });

  // ── §7 who sees it ────────────────────────────────────────────────────────
  const no = [
    await call(staff, "GET", `/donors/${P("juno")}/wealth-score`),
    await call(staff, "PATCH", `/donors/${P("juno")}/wealth-score`, { score: 1 }),
    await call(staff, "POST", "/donors/bulk-wealth-score", { ids: [P("juno")], score: 1 }),
    await call(staff, "GET", `/donors?where=${enc(eq5)}`),
    await call(staff, "GET", `/donors?cols=wealth_score`),
    await call(staff, "GET", `/donors?sort=wealth_score&dir=asc`),
    await call(staff, "GET", `/donors/ids?where=${enc(eq5)}`),
    await call(staff, "POST", "/donors/list-views", { name: "x", columns: ["name"], filters: eq5 }),
    await call(staff, "POST", "/groups", { name: "Sneaky fives", kind: "dynamic", rules: { where: JSON.stringify(eq5) } }),
    await call(staff, "GET", "/saved-reports/std:donors-by-wealth/run"),
    await call(staff, "POST", "/report-builder/run", { definition: { entity: "people", columns: ["name", "wealth_score"] } }),
  ];
  ok("§7 without the permission: 403 from every route that reads or writes it", no.every(x => x.status === 403), no.map(x => x.status));
  ok("§7 and nothing was written", (await stored("juno")) === 5);
  const sSetup = await call(staff, "GET", "/donors/list-setup");
  const sList = await call(staff, "GET", "/donors?limit=50");
  const sCsv = await call(staff, "GET", "/donors/export/csv");
  const sReps = await call(staff, "GET", "/saved-reports");
  const sAtlas = await call(staff, "POST", "/ask", { text: "show me my 5s who haven't given this year" });
  ok("§7 they don't see the column, the stored value, the CSV column, the starter report or Atlas's answer",
    !(sSetup.body.fields || []).some(f => f.key === "wealth_score") && sList.status === 200 && !/wealth_rating/.test(sList.text)
      && !/Wealth Score/.test(sCsv.text.split("\n")[0]) && !(sReps.body.standard || []).some(x => x.id === "std:donors-by-wealth")
      && sAtlas.body.answered !== true && !(sAtlas.body.people || []).length,
    { list: /wealth_rating/.test(sList.text), csv: sCsv.text.split("\n")[0], atlas: sAtlas.body.sentence });
  const aList = await call(admin, "GET", "/donors?limit=50");
  ok("§7 the stored column rides on no row, even for an admin (it leaves only under the routes that check)", !/wealth_rating/.test(aList.text));
  const flip = await call(staff, "PUT", "/org/wealth-scores", { team: true });
  ok("§7 only an admin turns on the team switch", flip.status === 403);
  await call(admin, "PUT", "/org/wealth-scores", { team: true });
  const seen = await call(staff, "GET", `/donors/${P("juno")}/wealth-score`);
  const me = await call(staff, "GET", "/me");
  ok("§7 with \"Everyone on the team can see Wealth Scores\" on, staff see it", seen.status === 200 && seen.body.score === 5 && me.body.user.canWealthScores === true, seen.body);
  await call(admin, "PUT", "/org/wealth-scores", { team: false });
  ok("§7 and off again, it's gone (read live)", (await call(staff, "GET", `/donors/${P("juno")}/wealth-score`)).status === 403);
  const merge = [
    ...(await import("../shared/emailTemplates.js")).MERGE_FIELDS, ...(await import("../shared/sequenceShape.js")).MERGE_FIELDS,
    ...(await import("../shared/ackLetter.js")).ACK_MERGE_FIELDS, ...(await import("../shared/emailBlocks.js")).EMAIL_MERGE_FIELDS,
    ...(await import("../shared/brandKit.js")).MERGE_FIELDS];
  ok("§7 no donor-facing template can merge it (no merge field names wealth)", merge.length > 10 && !/wealth/i.test(JSON.stringify(merge)), merge.length);

  summary();
  await closeDb();
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });

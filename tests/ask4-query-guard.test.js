// tests/ask4-query-guard.test.js — ASK-4. ANY QUESTION, AND NOTHING ELSE.
//
//     The query layer (askQuery.js) answers about any record the org keeps,
//     and only the org's own: a plan reads no other org's rows, a value is
//     never SQL, and a field, entity or operator outside the catalog is
//     refused before a row is read.
//
// Two invented orgs, each with a person, a gift, a conversation and a volunteer
// shift (never the demo). No model is asked: the plans are written here, as
// the model would hand them over, and run through validateQuery and runQuery.
//   §1 every entity, counted for org A, sees only org A's rows (and B the same).
//   §2 a related condition reads the person's OWN other records, in their org.
//   §3 values that look like SQL are matched as text and change nothing.
//   §4 an unknown field, entity, operator or measure is refused.
//   §5 the figure rows behind an answer foot to the answer and are all org A's.
//
// HOW IT WOULD GO RED: drop the org condition from one entity (§1 counts the
// other org), or let a related sub-query reuse the outer aliases (§2 matches
// everybody), or splice a value into the SQL (§3). Proven able to fail:
// removing `E.org` from whereFor's parts turned §1 red with org B's rows counted.
const { ok, summary, q, closeDb } = require("./helpers");
const AQ = require("../askQuery");

const A = "org_ask4a", B = "org_ask4b";
const today = new Date().toISOString().slice(0, 10);
const yr = today.slice(0, 4);

(async () => {
  for (const o of [A, B]) {
    for (const t of ["volunteer_shifts", "interactions", "gifts", "donors"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','UTC')`, [o, "Ask Four " + o, o.replace(/_/g, "-")]);
  }
  // A: two people in Maine (one volunteers), B: one person in Maine. Same names on purpose.
  const P = [[A, "p1", "Ada Lovell", "ME", true], [A, "p2", "Bo Quist", "ME", false], [B, "p1", "Ada Lovell", "ME", true]];
  for (const [o, k, name, st] of P)
    await q(`INSERT INTO donors (id,org_id,name,state,city,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'Bath','active','system:test','test')`, [`d_${o}_${k}`, o, name, st]);
  const Gs = [[A, "p1", 100], [A, "p2", 250], [B, "p1", 9999]];
  let i = 0;
  for (const [o, k, amt] of Gs) await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'Check','system:test','test')`,
    [`g_${o}_${++i}`, o, `d_${o}_${k}`, amt, `${yr}-01-15`]);
  for (const [o, k, , , vol] of P) {
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by) VALUES ($1,$2,$3,'call',$4,'hello','system:test')`, [`i_${o}_${k}`, o, `d_${o}_${k}`, `${yr}-02-01`]);
    if (vol) await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'usher','system:test','test')`, [`s_${o}_${k}`, o, `d_${o}_${k}`, `${yr}-03-01`, o === A ? 4 : 12]);
  }
  try {
    const runA = async raw => { const v = AQ.validateQuery(raw); if (!v.ok) throw new Error("refused " + v.refused); return AQ.runQuery(A, v.plan, today); };

    // §1
    const counts = {
      people: [2, 1], gifts: [2, 1], conversations: [2, 1], volunteer_hours: [1, 1],
    };
    for (const [ent, [a, b]] of Object.entries(counts)) {
      const v = AQ.validateQuery({ entity: ent });
      const ra = await AQ.runQuery(A, v.plan, today), rb = await AQ.runQuery(B, v.plan, today);
      ok(`§1 ${ent} for org A counts only A's rows (${ra.value}) and B only B's (${rb.value})`, ra.value === a && rb.value === b, { a: ra.value, b: rb.value });
    }
    const sumA = await runA({ entity: "gifts", measure: { fn: "sum", field: "amount" } });
    ok("§1 a total for org A never includes org B's $9,999", Number(sumA.value) === 350, sumA.value);

    // §2
    const vol = await runA({ entity: "people", related: [{ entity: "volunteer_hours" }], list: true });
    ok("§2 people with their own volunteer shifts: Ada in A, once, not B's Ada", vol.value === 1 && vol.list.length === 1 && vol.list[0].id === `d_${A}_p1`, vol.list);
    const many = await runA({ entity: "people", related: [{ entity: "volunteer_hours", minSum: 10 }] });
    ok("§2 B's twelve hours do not count toward A's Ada", many.value === 0, many.value);
    const noVol = await runA({ entity: "people", related: [{ entity: "volunteer_hours", none: true }], list: true });
    ok("§2 people with no shifts is Bo alone", noVol.value === 1 && noVol.list[0].id === `d_${A}_p2`, noVol.list);

    // §3
    for (const evil of ["x'); DELETE FROM donors; --", "' OR '1'='1", "%' OR 1=1 --", "Ada Lovell' --"]) {
      const r = await runA({ entity: "people", where: [{ field: "name", op: "eq", value: evil }] });
      ok(`§3 "${evil}" is a name that matches nobody`, r.value === 0, r.value);
    }
    const like = await runA({ entity: "people", where: [{ field: "name", op: "contains", value: "%" }] });
    ok("§3 a % in contains is a literal %, not a wildcard", like.value === 0, like.value);
    const [still] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id = ANY($1)`, [[A, B]]);
    ok("§3 every row is still there", still.n === 3, still.n);

    // §4
    const refused = [
      { entity: "people", where: [{ field: "password_hash", op: "eq", value: "x" }] },
      { entity: "users" },
      { entity: "people", where: [{ field: "name", op: "regex", value: ".*" }] },
      { entity: "gifts", measure: { fn: "sum", field: "date" } },
      { entity: "gifts", measure: { fn: "drop" } },
      { entity: "people", related: [{ entity: "orgs" }] },
      { entity: "people", groupBy: { field: "lifetime_giving" } },
      { entity: "people", sort: { by: "1; DROP TABLE donors" } },
    ];
    for (const raw of refused) ok(`§4 refused: ${JSON.stringify(raw).slice(0, 70)}`, AQ.validateQuery(raw).ok === false);

    // §5
    const v = AQ.validateQuery({ entity: "gifts", where: [{ field: "payment_method", op: "eq", value: "check" }], measure: { fn: "sum", field: "amount" } });
    const r = await AQ.runQuery(A, v.plan, today);
    const rows = await AQ.figureRows(A, v.plan, "value");
    const total = rows.reduce((s, x) => s + Math.round(Number(x.amount) * 100), 0);
    ok("§5 the rows behind a total foot to it, to the cent", total === Math.round(Number(r.value) * 100) && rows.length === 2, { total, value: r.value });
    ok("§5 and every one of them is org A's", rows.every(x => String(x.donor_id).startsWith(`d_${A}_`)), rows.map(x => x.donor_id));
  } finally {
    for (const o of [A, B]) {
      for (const t of ["volunteer_shifts", "interactions", "gifts", "donors"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
      await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
    }
    await closeDb();
  }
  summary();
  process.exit(0);
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
